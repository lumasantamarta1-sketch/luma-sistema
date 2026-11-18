-- =====================================================================
-- LUMA · 02 · Catálogo: productos, variantes, costos y precios
-- =====================================================================

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.tallas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden integer not null default 0,
  activo boolean not null default true
);

create table public.colores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  hex text check (hex is null or hex ~ '^#[0-9A-Fa-f]{6}$'),
  activo boolean not null default true
);

create table public.tipos_camiseta (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);

create table public.disenos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  descripcion text,
  imagen_ruta text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- clase: terminado (se vende), base (camiseta lisa para estampar), material (insumo de estampado)
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  clase text not null check (clase in ('terminado', 'base', 'material')),
  categoria_id uuid references public.categorias (id),
  descripcion text,
  foto_ruta text,
  unidad_medida text not null default 'unidad'
    check (unidad_medida in ('unidad', 'metro', 'hoja', 'gramo', 'mililitro')),
  se_vende boolean not null default false,
  -- Camisetas personalizadas: se venden sin existencias y se estampan por pedido
  por_pedido boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  constraint productos_por_pedido_chk check (not por_pedido or clase = 'terminado'),
  constraint productos_unidad_chk check (clase = 'material' or unidad_medida = 'unidad')
);
create index productos_categoria_idx on public.productos (categoria_id);

create table public.variantes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos (id),
  clase text not null,                       -- copia de productos.clase, la fija un disparador
  sku text not null unique,
  referencia text,
  tipo_id uuid references public.tipos_camiseta (id),
  talla_id uuid references public.tallas (id),
  color_id uuid references public.colores (id),
  diseno_id uuid references public.disenos (id),
  variante_base_id uuid references public.variantes (id),
  precio_venta numeric(14,2) check (precio_venta is null or precio_venta >= 0),
  stock_minimo numeric(12,3) not null default 0 check (stock_minimo >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint variantes_combinacion_uk unique nulls not distinct (producto_id, tipo_id, talla_id, color_id, diseno_id),
  constraint variantes_base_chk check (clase <> 'base' or (diseno_id is null and variante_base_id is null)),
  constraint variantes_material_chk check (
    clase <> 'material'
    or (tipo_id is null and talla_id is null and color_id is null and diseno_id is null and variante_base_id is null))
);
-- Una sola camiseta base por tipo, talla y color
create unique index variantes_base_unica_idx
  on public.variantes (tipo_id, talla_id, color_id) nulls not distinct
  where clase = 'base';
create index variantes_producto_idx on public.variantes (producto_id);
create index variantes_base_idx on public.variantes (variante_base_id);
create index variantes_diseno_idx on public.variantes (diseno_id);

-- Costos restringidos: tabla aparte con su propia política
create table public.variante_costos (
  variante_id uuid primary key references public.variantes (id),
  costo_promedio numeric(14,4) not null default 0 check (costo_promedio >= 0),
  ultimo_costo numeric(14,4) check (ultimo_costo is null or ultimo_costo >= 0),
  actualizado_en timestamptz not null default now()
);

create table public.historial_costos (
  id bigint generated always as identity primary key,
  variante_id uuid not null references public.variantes (id),
  costo_anterior numeric(14,4) not null,
  costo_nuevo numeric(14,4) not null,
  movimiento_tipo text not null,
  documento_tipo text not null,
  documento_id uuid not null,
  ocurrido_en timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index historial_costos_variante_idx on public.historial_costos (variante_id, ocurrido_en desc);

create table public.historial_precios (
  id bigint generated always as identity primary key,
  variante_id uuid not null references public.variantes (id),
  precio_anterior numeric(14,2),
  precio_nuevo numeric(14,2),
  ocurrido_en timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index historial_precios_variante_idx on public.historial_precios (variante_id, ocurrido_en desc);

create trigger historial_costos_inmutable
  before update or delete on public.historial_costos
  for each row execute function app.bloquear_cambios();
create trigger historial_precios_inmutable
  before update or delete on public.historial_precios
  for each row execute function app.bloquear_cambios();

-- ---------------------------------------------------------------------
-- Disparadores del catálogo
-- ---------------------------------------------------------------------

-- La clase de un producto no cambia si ya tiene variantes
create function app.productos_validar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.clase <> old.clase
     and exists (select 1 from public.variantes where producto_id = new.id) then
    raise exception 'No se puede cambiar la clase de un producto que ya tiene variantes.';
  end if;
  return new;
end $$;

create trigger productos_validar
  before update on public.productos
  for each row execute function app.productos_validar();

-- Copia la clase y asigna la camiseta base de cada camiseta terminada
create function app.variantes_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not app.tiene_permiso('catalogo.gestionar')
     and (to_jsonb(new) - 'precio_venta') is distinct from (to_jsonb(old) - 'precio_venta') then
    raise exception 'Con tu permiso solo puedes cambiar el precio de venta.' using errcode = '42501';
  end if;
  select p.clase into new.clase from public.productos p where p.id = new.producto_id;
  if new.clase is null then
    raise exception 'Producto inexistente.';
  end if;
  if tg_op = 'UPDATE' and new.precio_venta is distinct from old.precio_venta
     and auth.uid() is not null and not app.tiene_permiso('precios.gestionar') then
    raise exception 'Solo quien gestiona precios puede cambiarlos.' using errcode = '42501';
  end if;
  if new.clase = 'terminado' and new.variante_base_id is null then
    select v.id into new.variante_base_id
      from public.variantes v
     where v.clase = 'base' and v.activo
       and v.tipo_id is not distinct from new.tipo_id
       and v.talla_id is not distinct from new.talla_id
       and v.color_id is not distinct from new.color_id
     limit 1;
  end if;
  return new;
end $$;

create trigger variantes_antes
  before insert or update on public.variantes
  for each row execute function app.variantes_antes();

create function app.variantes_despues() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.variante_costos (variante_id) values (new.id) on conflict do nothing;
    -- Una camiseta base nueva se enlaza con las terminadas que la esperaban
    if new.clase = 'base' then
      update public.variantes t
         set variante_base_id = new.id
       where t.clase = 'terminado' and t.variante_base_id is null
         and t.tipo_id is not distinct from new.tipo_id
         and t.talla_id is not distinct from new.talla_id
         and t.color_id is not distinct from new.color_id;
    end if;
  elsif new.precio_venta is distinct from old.precio_venta then
    insert into public.historial_precios (variante_id, precio_anterior, precio_nuevo)
    values (new.id, old.precio_venta, new.precio_venta);
  end if;
  return null;
end $$;

create trigger variantes_despues
  after insert or update on public.variantes
  for each row execute function app.variantes_despues();
