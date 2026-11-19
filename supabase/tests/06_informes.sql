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

-- Serie mensual y ventas por cliente
select pruebas.como('admin@luma.test');
set role authenticated;
select pruebas.igual(jsonb_array_length(public.serie_mensual(12)), 12, 'la serie mensual trae 12 meses');
select pruebas.igual(
  (public.serie_mensual(1) -> 0 ->> 'ventas_netas')::numeric,
  (public.resumen_financiero(date_trunc('month', now() at time zone 'America/Bogota')::date, pruebas.hoy()) #>> '{calculado,ventas_netas}')::numeric,
  'las ventas netas del mes coinciden con el resumen financiero');
select pruebas.igual(
  (public.serie_mensual(1) -> 0 ->> 'resultado')::numeric,
  (public.resumen_financiero(date_trunc('month', now() at time zone 'America/Bogota')::date, pruebas.hoy()) #>> '{calculado,resultado_operativo}')::numeric,
  'el resultado del mes coincide con el resumen financiero');
select pruebas.afirmar(jsonb_typeof(public.informe_ventas(pruebas.hoy() - 30, pruebas.hoy()) -> 'por_cliente') = 'array',
                       'el informe de ventas trae ventas por cliente');
reset role;

select pruebas.como('consulta@luma.test');
set role authenticated;
select pruebas.afirmar((public.serie_mensual(3) -> 0 ->> 'costo') is null and (public.serie_mensual(3) -> 0 ->> 'gastos') is null,
                       'consulta ve ventas por mes, sin costos ni gastos');
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.falla($$select public.serie_mensual(12)$$, 'informes.ver', 'el vendedor no ve la serie mensual');
reset role;

-- Cuentas por cobrar y por pagar: cuadran con los saldos del resumen financiero
select pruebas.como('admin@luma.test');
set role authenticated;
select pruebas.igual(
  (select coalesce(sum((x ->> 'saldo')::numeric), 0) from jsonb_array_elements(public.cuentas_pendientes() -> 'por_cobrar') x
    where (x ->> 'entregada')::boolean),
  (public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{saldos,cuentas_por_cobrar}')::numeric,
  'lo que deben los clientes cuadra con el resumen financiero');
select pruebas.igual(
  (select coalesce(sum((x ->> 'saldo')::numeric), 0) from jsonb_array_elements(public.cuentas_pendientes() -> 'por_pagar') x),
  (public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{saldos,compras_por_pagar}')::numeric,
  'lo que se debe a proveedores cuadra con el resumen financiero');
select pruebas.igual(
  (select coalesce(sum((x ->> 'valor')::numeric), 0) from jsonb_array_elements(public.cuentas_pendientes() -> 'gastos_por_pagar') x),
  (public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{saldos,gastos_por_pagar}')::numeric,
  'los gastos por pagar cuadran con el resumen financiero');
select pruebas.igual(
  (public.informe_compras_gastos(pruebas.hoy() - 30, pruebas.hoy()) #>> '{gastos,total}')::numeric,
  (select coalesce(sum((x ->> 'valor')::numeric), 0)
     from jsonb_array_elements(public.informe_compras_gastos(pruebas.hoy() - 30, pruebas.hoy()) -> 'gastos_por_categoria') x),
  'los gastos por categoría suman el total de gastos');
select pruebas.igual(
  (public.informe_compras_gastos(pruebas.hoy() - 30, pruebas.hoy()) #>> '{compras,total}')::numeric,
  (select coalesce(sum((x ->> 'valor')::numeric), 0)
     from jsonb_array_elements(public.informe_compras_gastos(pruebas.hoy() - 30, pruebas.hoy()) -> 'compras_por_proveedor') x),
  'las compras por proveedor suman el total comprado');
select pruebas.falla($$select public.informe_compras_gastos(pruebas.hoy(), pruebas.hoy() - 1)$$, 'periodo válido',
                     'el informe de compras y gastos rechaza un periodo al revés');
reset role;

select pruebas.como('consulta@luma.test');
set role authenticated;
select pruebas.falla($$select public.informe_compras_gastos(pruebas.hoy() - 30, pruebas.hoy())$$, 'informes.financieros',
                     'consulta no ve compras ni gastos');
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.falla($$select public.cuentas_pendientes()$$, 'informes.financieros', 'el vendedor no ve las cuentas pendientes');
reset role;

-- Resumen por cliente: lo que deben coincide con las cuentas por cobrar de los clientes registrados
select pruebas.como('admin@luma.test');
set role authenticated;
select pruebas.igual(
  (select coalesce(sum((x ->> 'saldo')::numeric), 0) from jsonb_array_elements(public.resumen_clientes()) x),
  (select coalesce(sum((x ->> 'saldo')::numeric), 0) from jsonb_array_elements(public.cuentas_pendientes() -> 'por_cobrar') x
    where x ->> 'cliente_id' is not null),
  'el saldo por cliente coincide con las cuentas por cobrar');
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.afirmar(jsonb_typeof(public.resumen_clientes()) = 'array', 'el vendedor ve el resumen de sus clientes');
reset role;

-- Quien maneja el inventario ve la evolución de las existencias, sin ventas
select pruebas.como('inventario@luma.test');
set role authenticated;
select pruebas.afirmar((public.serie_mensual(2) -> 1 ->> 'ventas') is null
                       and (public.serie_mensual(2) -> 1 ->> 'inventario_unidades') is not null,
                       'el encargado de inventario ve las unidades mes a mes, sin ventas');
reset role;

-- Ingresos y salidas quedan en la auditoría a nombre de quien entra
select pruebas.como('vendedor@luma.test');
set role authenticated;
select public.registrar_sesion('ingreso');
select public.registrar_sesion('otra cosa');
reset role;
select pruebas.igual(
  (select count(*) from public.auditoria where accion = 'ingreso' and tabla = 'sesiones'
      and usuario_id = (select id from auth.users where email = 'vendedor@luma.test')),
  1::bigint, 'el ingreso del vendedor quedó registrado una vez');
