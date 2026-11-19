-- =====================================================================
-- Pruebas · 06 · Informe de ventas y compras por recibir, con sus permisos
-- =====================================================================
select pruebas.como('admin@luma.test');
set role authenticated;
select pruebas.igual(
  (public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy()) #>> '{totales,ventas}')::numeric,
  (select count(*) from public.ventas where estado = 'confirmada' and estado_entrega = 'entregada'
      and entregada_en >= ((pruebas.hoy() - 30)::timestamp at time zone 'America/Bogota')),
  'el informe cuenta las ventas entregadas del periodo');
select pruebas.igual(
  (public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy()) #>> '{totales,valor}')::numeric,
  (select coalesce(sum(total), 0) from public.ventas where estado = 'confirmada' and estado_entrega = 'entregada'
      and entregada_en >= ((pruebas.hoy() - 30)::timestamp at time zone 'America/Bogota')),
  'el informe suma el valor de las ventas entregadas');
select pruebas.afirmar((public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy()) ->> 'con_costos')::boolean,
                       'el administrador ve costos en el informe');
select pruebas.falla($$select public.informe_ventas(pruebas.hoy(), pruebas.hoy() - 1)$$, 'periodo válido',
                     'un periodo al revés se rechaza');
select pruebas.afirmar(jsonb_typeof(public.compras_por_recibir()) = 'array', 'compras por recibir responde una lista');
reset role;

-- Consulta ve el informe sin costos; el vendedor no lo ve
insert into auth.users (id, email, raw_user_meta_data)
select '00000000-0000-0000-0000-0000000000c1', 'consulta@luma.test', '{"nombre": "Consulta Prueba"}'
 where not exists (select 1 from auth.users where email = 'consulta@luma.test');
select pruebas.como('admin@luma.test');
set role authenticated;
select public.asignar_usuario('00000000-0000-0000-0000-0000000000c1',
  jsonb_build_object('rol_id', (select id from public.roles where codigo = 'consulta'), 'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'))));
reset role;

select pruebas.como('consulta@luma.test');
set role authenticated;
select pruebas.afirmar(not (public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy()) ->> 'con_costos')::boolean,
                       'consulta ve el informe de ventas sin costos');
select pruebas.afirmar((public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy()) #>> '{totales,costo}') is null,
                       'sin permiso de costos el costo llega vacío');
select pruebas.falla($$select public.compras_por_recibir()$$, 'compras.recibir', 'consulta no ve compras por recibir');
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.falla($$select public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy())$$, 'informes.ver',
                     'el vendedor no ve el informe de ventas');
reset role;

select pruebas.como('inventario@luma.test');
set role authenticated;
select pruebas.afirmar(jsonb_typeof(public.compras_por_recibir()) = 'array', 'quien recibe mercancía ve las compras por recibir');
reset role;
