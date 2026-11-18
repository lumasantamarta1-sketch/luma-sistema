-- =====================================================================
-- Pruebas · 00 · Utilidades y usuarios de prueba (solo en la base local)
-- =====================================================================
create schema pruebas;
grant usage on schema pruebas to authenticated, anon;

-- Actúa como el usuario de ese correo en las siguientes sentencias
create function pruebas.como(p_correo text) returns void language plpgsql as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_correo;
  if v is null then raise exception 'Usuario de prueba % no existe', p_correo; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, false);
end $$;

create function pruebas.afirmar(p_ok boolean, p_mensaje text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FALLÓ: %', p_mensaje; end if;
  raise notice 'ok · %', p_mensaje;
end $$;

create function pruebas.igual(p_real numeric, p_esperado numeric, p_mensaje text) returns void language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception 'FALLÓ: % (esperado %, obtenido %)', p_mensaje, p_esperado, p_real;
  end if;
  raise notice 'ok · % = %', p_mensaje, p_real;
end $$;

-- Ejecuta p_sql y exige que falle con un mensaje que contenga p_patron
create function pruebas.falla(p_sql text, p_patron text, p_mensaje text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_patron || '%' then
      raise notice 'ok · % (rechazado: %)', p_mensaje, sqlerrm;
      return;
    end if;
    raise exception 'FALLÓ: % — error inesperado: %', p_mensaje, sqlerrm;
  end;
  raise exception 'FALLÓ: % — debía rechazarse y se aceptó', p_mensaje;
end $$;

-- Identificadores por nombre, para escribir pruebas legibles
create function pruebas.var(p_sku text) returns uuid language sql as $$ select id from public.variantes where sku = p_sku $$;
create function pruebas.bod(p_nombre text) returns uuid language sql as $$ select id from public.bodegas where nombre = p_nombre $$;
create function pruebas.metodo(p_nombre text) returns uuid language sql as $$ select id from public.metodos_pago where nombre = p_nombre $$;
create function pruebas.cuenta(p_nombre text) returns uuid language sql as $$ select id from public.cuentas_dinero where nombre = p_nombre $$;
create function pruebas.existencia(p_sku text, p_bodega text) returns numeric language sql as $$
  select coalesce((select cantidad from public.existencias where variante_id = pruebas.var(p_sku) and bodega_id = pruebas.bod(p_bodega)), 0) $$;
create function pruebas.apartada(p_sku text, p_bodega text) returns numeric language sql as $$
  select coalesce((select apartada from public.existencias where variante_id = pruebas.var(p_sku) and bodega_id = pruebas.bod(p_bodega)), 0) $$;
create function pruebas.promedio(p_sku text) returns numeric language sql as $$
  select costo_promedio from public.variante_costos where variante_id = pruebas.var(p_sku) $$;
create function pruebas.hoy() returns date language sql as $$ select (now() at time zone 'America/Bogota')::date $$;
grant execute on all functions in schema pruebas to authenticated, anon;

-- Usuarios de prueba (en Supabase se crean desde Authentication)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@luma.test', '{"nombre": "Admin Prueba"}'),
  ('00000000-0000-0000-0000-00000000000b', 'vendedor@luma.test', '{"nombre": "Vendedor Prueba"}'),
  ('00000000-0000-0000-0000-00000000000c', 'inventario@luma.test', '{"nombre": "Inventario Prueba"}'),
  ('00000000-0000-0000-0000-00000000000d', 'gerente@luma.test', '{"nombre": "Gerente Prueba"}'),
  ('00000000-0000-0000-0000-00000000000e', 'contabilidad@luma.test', '{"nombre": "Contabilidad Prueba"}'),
  ('00000000-0000-0000-0000-00000000000f', 'vendedor2@luma.test', '{"nombre": "Vendedor Dos"}');

select pruebas.afirmar((select count(*) from public.perfiles) = 6, 'cada usuario de Auth recibe su perfil');
select pruebas.afirmar((select rol_id is null from public.perfiles where correo = 'vendedor@luma.test'),
                       'un perfil nuevo no tiene rol ni permisos');
select app.promover_administrador('admin@luma.test');

-- El administrador configura puntos de venta y usuarios
select pruebas.como('admin@luma.test');
set role authenticated;
insert into public.bodegas (codigo, nombre, tipo) values ('CEN', 'Tienda Centro', 'punto_venta'), ('NOR', 'Tienda Norte', 'punto_venta');
select pruebas.afirmar((select count(*) from public.cuentas_dinero where tipo = 'efectivo') = 2,
                       'cada punto de venta recibe su caja de efectivo');
select public.asignar_usuario('00000000-0000-0000-0000-00000000000b',
  jsonb_build_object('rol_id', (select id from public.roles where codigo = 'vendedor'), 'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'))));
select public.asignar_usuario('00000000-0000-0000-0000-00000000000f',
  jsonb_build_object('rol_id', (select id from public.roles where codigo = 'vendedor'), 'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'))));
select public.asignar_usuario('00000000-0000-0000-0000-00000000000c',
  jsonb_build_object('rol_id', (select id from public.roles where codigo = 'encargado_inventario'),
                     'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'), pruebas.bod('Tienda Norte'))));
select public.asignar_usuario('00000000-0000-0000-0000-00000000000d',
  jsonb_build_object('rol_id', (select id from public.roles where codigo = 'gerente'),
                     'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'), pruebas.bod('Tienda Norte'))));
select public.asignar_usuario('00000000-0000-0000-0000-00000000000e',
  jsonb_build_object('rol_id', (select id from public.roles where codigo = 'contabilidad'),
                     'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'), pruebas.bod('Tienda Norte'))));
select pruebas.afirmar(jsonb_array_length(public.mis_permisos() -> 'permisos') = (select count(*) from public.permisos),
                       'el administrador tiene todos los permisos');
reset role;
