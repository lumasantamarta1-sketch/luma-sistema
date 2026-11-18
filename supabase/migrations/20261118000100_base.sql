-- =====================================================================
-- LUMA · 01 · Base: configuración, roles, perfiles, consecutivos y auditoría
-- =====================================================================

create schema if not exists app;
comment on schema app is 'Funciones internas de LUMA. No se expone por la API.';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Configuración del negocio: una sola fila
-- ---------------------------------------------------------------------
create table public.configuracion_negocio (
  id smallint primary key default 1 check (id = 1),
  nombre_comercial text not null default 'LUMA',
  eslogan text not null default 'Ideas que cobran vida',
  logo_ruta text,
  colores jsonb not null default jsonb_build_object(
    'principal', '#2D0A72', 'destacado', '#FEBD5B', 'complementario', '#11CFDB',
    'acento', '#FF4D81', 'secundario', '#FE701E', 'fondo', '#FBF8FF'),
  moneda text not null default 'COP',
  zona_horaria text not null default 'America/Bogota',
  metodo_costeo text not null default 'promedio_ponderado'
    check (metodo_costeo = 'promedio_ponderado'),
  -- Si LUMA no es responsable de IVA, el IVA de las compras se suma al costo
  -- y las ventas no discriminan impuesto.
  responsable_iva boolean not null default false,
  -- Porcentaje de IVA incluido en el precio de venta cuando responsable_iva = true
  impuesto_venta_pct numeric(5,2) not null default 0 check (impuesto_venta_pct >= 0),
  permite_venta_bajo_pedido boolean not null default false,
  anticipo_minimo_pct numeric(5,2) not null default 0 check (anticipo_minimo_pct between 0 and 100),
  -- Ajustes cuyo valor supere este umbral quedan pendientes de aprobación
  umbral_aprobacion_ajuste numeric(14,2) not null default 0 check (umbral_aprobacion_ajuste >= 0),
  umbral_pocas_unidades numeric(12,3) not null default 3 check (umbral_pocas_unidades >= 0),
  dias_sin_movimiento integer not null default 60 check (dias_sin_movimiento > 0),
  minutos_inactividad integer not null default 30 check (minutos_inactividad > 0),
  actualizado_en timestamptz not null default now()
);
insert into public.configuracion_negocio (id) values (1);

-- ---------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z_]+$'),
  nombre text not null,
  descripcion text,
  es_sistema boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.permisos (
  codigo text primary key check (codigo ~ '^[a-z_]+\.[a-z_]+$'),
  modulo text not null,
  descripcion text not null
);

create table public.rol_permisos (
  rol_id uuid not null references public.roles (id) on delete cascade,
  permiso_codigo text not null references public.permisos (codigo) on delete cascade,
  primary key (rol_id, permiso_codigo)
);

-- ---------------------------------------------------------------------
-- Perfiles: uno por usuario de Supabase Auth
-- ---------------------------------------------------------------------
create table public.perfiles (
  id uuid primary key references auth.users (id) on delete restrict,
  nombre text not null default '',
  correo text,
  rol_id uuid references public.roles (id),
  activo boolean not null default true,
  debe_cambiar_clave boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index perfiles_rol_idx on public.perfiles (rol_id);

-- ---------------------------------------------------------------------
-- Consecutivos sin saltos: se asignan dentro de la transacción del documento
-- ---------------------------------------------------------------------
create table public.consecutivos (
  tipo text primary key,
  prefijo text not null,
  siguiente bigint not null default 1 check (siguiente > 0)
);

-- ---------------------------------------------------------------------
-- Auditoría: solo admite inserciones
-- ---------------------------------------------------------------------
create table public.auditoria (
  id bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  usuario_id uuid,
  accion text not null,
  tabla text not null,
  registro_id text,
  valor_anterior jsonb,
  valor_nuevo jsonb
);
create index auditoria_registro_idx on public.auditoria (tabla, registro_id);
create index auditoria_fecha_idx on public.auditoria (ocurrido_en desc);
create index auditoria_usuario_idx on public.auditoria (usuario_id, ocurrido_en desc);

-- ---------------------------------------------------------------------
-- Funciones de apoyo
-- ---------------------------------------------------------------------
create function app.usuario_activo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo)
$$;

create function app.tiene_permiso(p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.perfiles p
      join public.roles r on r.id = p.rol_id and r.activo
      join public.rol_permisos rp on rp.rol_id = p.rol_id
     where p.id = auth.uid() and p.activo and rp.permiso_codigo = p_permiso)
$$;

create function app.exigir_permiso(p_permiso text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.tiene_permiso(p_permiso) then
    raise exception 'No tienes permiso para esta acción (%).', p_permiso using errcode = '42501';
  end if;
end $$;

create function app.siguiente_numero(p_tipo text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_prefijo text;
  v_numero bigint;
begin
  update public.consecutivos
     set siguiente = siguiente + 1
   where tipo = p_tipo
  returning prefijo, siguiente - 1 into v_prefijo, v_numero;
  if not found then
    raise exception 'El consecutivo "%" no está configurado.', p_tipo;
  end if;
  return v_prefijo || '-' || lpad(v_numero::text, 5, '0');
end $$;

create function app.auditar(p_accion text, p_tabla text, p_registro_id text, p_detalle jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, valor_nuevo)
  values (auth.uid(), p_accion, p_tabla, p_registro_id, p_detalle)
$$;

-- Disparador genérico: guarda solo los campos que cambiaron
create function app.registrar_auditoria() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ant jsonb;
  v_nue jsonb;
  v_reg jsonb;
  v_id text;
begin
  if tg_op = 'INSERT' then
    v_reg := to_jsonb(new);
    v_nue := v_reg;
  elsif tg_op = 'DELETE' then
    v_reg := to_jsonb(old);
    v_ant := v_reg;
  else
    v_reg := to_jsonb(new);
    select jsonb_object_agg(o.key, o.value) into v_ant
      from jsonb_each(to_jsonb(old)) o
     where to_jsonb(new) -> o.key is distinct from o.value;
    select jsonb_object_agg(n.key, n.value) into v_nue
      from jsonb_each(to_jsonb(new)) n
     where to_jsonb(old) -> n.key is distinct from n.value;
    if v_ant is null and v_nue is null then
      return new;
    end if;
  end if;
  v_id := coalesce(v_reg ->> 'id', v_reg ->> 'venta_linea_id', v_reg ->> 'variante_id',
                   v_reg ->> 'usuario_id', v_reg ->> 'rol_id', v_reg ->> 'codigo', v_reg ->> 'tipo');
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, valor_anterior, valor_nuevo)
  values (auth.uid(),
          case tg_op when 'INSERT' then 'insertar' when 'UPDATE' then 'actualizar' else 'eliminar' end,
          tg_table_name, v_id, v_ant, v_nue);
  return coalesce(new, old);
end $$;

-- Libros que no se modifican ni se borran
create function app.bloquear_cambios() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Los registros de "%" no se modifican ni se borran; se corrigen con un nuevo movimiento.', tg_table_name
    using errcode = '42501';
end $$;

create trigger auditoria_inmutable
  before update or delete on public.auditoria
  for each row execute function app.bloquear_cambios();

-- Cada usuario nuevo de Supabase Auth recibe un perfil sin rol (sin permisos)
create function app.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre, correo)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'nombre', ''), split_part(coalesce(new.email, ''), '@', 1)),
          new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function app.crear_perfil();
