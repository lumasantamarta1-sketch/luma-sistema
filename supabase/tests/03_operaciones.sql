-- =====================================================================
-- Pruebas · 03 · Devoluciones, anulaciones, venta bajo pedido, pedidos personalizados,
-- traslados, compras parciales, estampados anulados, gastos y cierre de caja
-- =====================================================================
create temporary table ids (nombre text primary key, id uuid);
grant all on ids to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from ids where nombre = p $$;

select pruebas.como('admin@luma.test');
set role authenticated;

-- ---------------------------------------------------------------------
-- A. Devolución de cliente: una en buen estado y una dañada, sin reembolso
-- ---------------------------------------------------------------------
create temporary table antes as select public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) as j;
insert into ids values ('V1', (select id from public.ventas where numero = 'V-00001'));
insert into ids values ('V1L', (select id from public.venta_lineas where venta_id = pg_temp.id('V1')));
select public.registrar_devolucion_venta(pg_temp.id('V1'), jsonb_build_object(
  'motivo', 'Talla equivocada y una con defecto', 'clave', '20000000-0000-0000-0000-000000000001',
  'lineas', jsonb_build_array(
    jsonb_build_object('venta_linea_id', pg_temp.id('V1L'), 'cantidad', 1, 'condicion', 'buena'),
    jsonb_build_object('venta_linea_id', pg_temp.id('V1L'), 'cantidad', 1, 'condicion', 'danada'))));
select public.registrar_devolucion_venta(pg_temp.id('V1'), jsonb_build_object(
  'motivo', 'Repetida', 'clave', '20000000-0000-0000-0000-000000000001',
  'lineas', jsonb_build_array(jsonb_build_object('venta_linea_id', pg_temp.id('V1L'), 'cantidad', 1))));
select pruebas.igual((select count(*) from public.devoluciones_venta), 1, 'la misma devolución no se registra dos veces');
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro'), 11, 'solo la devuelta en buen estado vuelve');
create temporary table despues as select public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) as j;
select pruebas.igual((d.j #>> '{calculado,ventas_netas}')::numeric - (a.j #>> '{calculado,ventas_netas}')::numeric,
                     -86666.66, 'la devolución resta ventas') from antes a, despues d;
select pruebas.igual((d.j #>> '{calculado,costo_mercancia_vendida}')::numeric - (a.j #>> '{calculado,costo_mercancia_vendida}')::numeric,
                     -31000, 'las dos unidades devueltas salen del costo de lo vendido') from antes a, despues d;
select pruebas.igual((d.j #>> '{calculado,perdidas_inventario}')::numeric - (a.j #>> '{calculado,perdidas_inventario}')::numeric,
                     15500, 'la dañada pasa a pérdida a su costo') from antes a, despues d;
select pruebas.igual((d.j #>> '{saldos,cuentas_por_cobrar}')::numeric, 23333.34, 'la devolución baja lo por cobrar') from despues d;
select pruebas.falla($$select public.registrar_devolucion_venta(pg_temp.id('V1'), jsonb_build_object('motivo', 'x',
                       'lineas', jsonb_build_array(jsonb_build_object('venta_linea_id', pg_temp.id('V1L'), 'cantidad', 5))))$$,
                     'máximo 4', 'no se devuelve más de lo vendido');

-- ---------------------------------------------------------------------
-- B. Sin sobreventa; venta bajo pedido; anulación con reembolso del anticipo
-- ---------------------------------------------------------------------
select pruebas.falla($$select public.confirmar_venta(public.guardar_cotizacion(null, jsonb_build_object(
                         'bodega_id', pruebas.bod('Tienda Centro'), 'lineas', jsonb_build_array(
                         jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 50)))), gen_random_uuid())$$,
                     'No hay existencias suficientes', 'no se confirma una venta sin existencias');
update public.configuracion_negocio set permite_venta_bajo_pedido = true;
insert into ids select 'VB', public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 15))));
select public.confirmar_venta(pg_temp.id('VB'), gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('metodo_pago_id', pruebas.metodo('Efectivo'), 'valor', 10000)));
select pruebas.afirmar((select estado = 'pendiente' and cantidad_apartada = 11 from public.venta_lineas
                         where venta_id = pg_temp.id('VB')), 'bajo pedido aparta lo que hay y deja pendiente el resto');
-- Se estampan 5 más y se surte el pedido
insert into ids select 'E2', public.guardar_orden_estampado(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 5))));
select public.registrar_estampado(pg_temp.id('E2'), jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
  'linea_id', (select id from public.orden_estampado_lineas where orden_id = pg_temp.id('E2')), 'buenas', 5, 'danadas', 0))));
select pruebas.afirmar((public.pedidos_por_preparar() -> 0 -> 'lineas' -> 0 ->> 'se_puede_apartar')::boolean,
                       'el pedido avisa que ya se puede surtir');
select pruebas.igual(public.apartar_venta(pg_temp.id('VB')), 1, 'el pedido pendiente queda apartado');
select pruebas.afirmar((select estado_entrega = 'en_preparacion' from public.ventas where id = pg_temp.id('VB')),
                       'el pedido pasa a preparación');
select public.anular_venta(pg_temp.id('VB'), 'El cliente desistió');
select pruebas.igual(pruebas.apartada('NAV-CR-M-BLA', 'Tienda Centro'), 0, 'anular antes de entregar libera lo apartado');
select public.registrar_pago_venta(pg_temp.id('VB'), pruebas.metodo('Efectivo'), 10000, 'Devolución del anticipo',
                                   gen_random_uuid(), 'reembolso');
select pruebas.falla($$select public.registrar_pago_venta(pg_temp.id('VB'), pruebas.metodo('Efectivo'), 1, null, null, 'reembolso')$$,
                     'saldo a favor', 'no se reembolsa más de lo pagado');
update public.configuracion_negocio set permite_venta_bajo_pedido = false;

-- ---------------------------------------------------------------------
-- C. Pedido personalizado con anticipo mínimo; una dañada obliga a otra orden
-- ---------------------------------------------------------------------
insert into public.productos (codigo, nombre, clase, se_vende, por_pedido)
values ('PER', 'Camiseta personalizada', 'terminado', true, true);
insert into public.variantes (producto_id, sku, tipo_id, talla_id, color_id, precio_venta)
select p.id, 'PER-CR-M-BLA', t.id, ta.id, c.id, 60000
  from public.productos p, public.tipos_camiseta t, public.tallas ta, public.colores c
 where p.codigo = 'PER' and t.nombre = 'Cuello redondo' and ta.nombre = 'M' and c.nombre = 'Blanco';
update public.configuracion_negocio set anticipo_minimo_pct = 50;
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
insert into ids select 'VP', public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('PER-CR-M-BLA'), 'cantidad', 2,
                                                 'personalizacion', 'Nombre «Ana» en el pecho'))));
select pruebas.falla($$select public.confirmar_venta(pg_temp.id('VP'), gen_random_uuid())$$, 'anticipo mínimo de 60000',
                     'el pedido personalizado exige anticipo');
select public.confirmar_venta(pg_temp.id('VP'), gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('metodo_pago_id', pruebas.metodo('Efectivo'), 'valor', 60000)));
select pruebas.afirmar((select estado_entrega = 'por_estampar' from public.ventas where id = pg_temp.id('VP')),
                       'el pedido queda por estampar');
reset role;

select pruebas.como('inventario@luma.test');
set role authenticated;
insert into ids select 'EP1', o.id from public.ordenes_estampado o where o.venta_id = pg_temp.id('VP');
select public.registrar_estampado(pg_temp.id('EP1'), jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
  'linea_id', (select id from public.orden_estampado_lineas where orden_id = pg_temp.id('EP1')), 'buenas', 1, 'danadas', 1))));
reset role;  -- el encargado no ve valores de ventas; se verifica como postgres
select pruebas.afirmar((select l.cantidad_apartada = 1 and l.estado = 'por_estampar' from public.venta_lineas l
                          join public.ordenes_estampado o on o.venta_id = l.venta_id
                         where o.id = pg_temp.id('EP1')), 'la camiseta buena queda apartada para su venta');
set role authenticated;
insert into ids select 'EP2', public.ordenar_estampado_venta((select venta_id from public.ordenes_estampado where id = pg_temp.id('EP1')));
select pruebas.igual((select cantidad_planeada from public.orden_estampado_lineas where orden_id = pg_temp.id('EP2')), 1,
                     'la nueva orden estampa solo la que falta');
select public.registrar_estampado(pg_temp.id('EP2'), jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
  'linea_id', (select id from public.orden_estampado_lineas where orden_id = pg_temp.id('EP2')), 'buenas', 1, 'danadas', 0))));
select pruebas.falla($$select public.detalle_costos('estampado', pg_temp.id('EP2'))$$, 'costos.ver',
                     'el encargado no ve el costo del estampado');
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.afirmar((select estado_entrega = 'en_preparacion' from public.ventas where id = pg_temp.id('VP')),
                       'con todo estampado el pedido pasa a preparación');
select public.registrar_pago_venta(pg_temp.id('VP'), pruebas.metodo('Efectivo'), 60000);
select public.entregar_venta(pg_temp.id('VP'));
select pruebas.igual(pruebas.existencia('PER-CR-M-BLA', 'Tienda Centro'), 0, 'el pedido personalizado se entregó');
reset role;

-- ---------------------------------------------------------------------
-- D. Traslado entre puntos: sale al enviar, entra al recibir, el costo no cambia
-- ---------------------------------------------------------------------
select pruebas.como('inventario@luma.test');
set role authenticated;
insert into ids select 'T1', public.guardar_traslado(null, jsonb_build_object(
  'origen_id', pruebas.bod('Tienda Centro'), 'destino_id', pruebas.bod('Tienda Norte'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 2))));
reset role;
create temporary table prom as select pruebas.promedio('NAV-CR-M-BLA') as p;
select pruebas.como('inventario@luma.test');
set role authenticated;
select public.enviar_traslado(pg_temp.id('T1'));
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Norte'), 0, 'en tránsito aún no entra al destino');
select public.recibir_traslado(pg_temp.id('T1'));
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Norte'), 2, 'al recibir entra al destino');
reset role;
select pruebas.igual(pruebas.promedio('NAV-CR-M-BLA'), (select p from prom), 'el traslado no cambia el costo promedio');

-- ---------------------------------------------------------------------
-- E. Compra con flete, recepción parcial idempotente y devolución al proveedor
-- ---------------------------------------------------------------------
select pruebas.como('admin@luma.test');
set role authenticated;
insert into ids select 'C3', public.guardar_compra(null, jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('BASE-CR-M-BLA'), 'cantidad', 10, 'costo_unitario', 12000)),
  'costos_adicionales', jsonb_build_array(jsonb_build_object('concepto', 'Flete', 'valor', 20000))));
select public.confirmar_compra(pg_temp.id('C3'));
select pruebas.igual((select costo_neto_unitario from public.compra_lineas where compra_id = pg_temp.id('C3')), 14000,
                     'el flete se reparte en el costo de las unidades');
create temporary table base0 as select pruebas.existencia('BASE-CR-M-BLA', 'Tienda Centro') as n;
select public.recibir_compra(pg_temp.id('C3'), '30000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('compra_linea_id', (select id from public.compra_lineas where compra_id = pg_temp.id('C3')), 'cantidad', 4)));
select public.recibir_compra(pg_temp.id('C3'), '30000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('compra_linea_id', (select id from public.compra_lineas where compra_id = pg_temp.id('C3')), 'cantidad', 4)));
select pruebas.igual(pruebas.existencia('BASE-CR-M-BLA', 'Tienda Centro') - (select n from base0), 4,
                     'repetir la misma recepción no duplica la entrada');
select pruebas.afirmar((select estado = 'recibida_parcial' from public.compras where id = pg_temp.id('C3')), 'recepción parcial');
select public.recibir_compra(pg_temp.id('C3'), gen_random_uuid());
select pruebas.afirmar((select estado = 'recibida' from public.compras where id = pg_temp.id('C3')), 'recepción completa');
select public.registrar_devolucion_proveedor(pg_temp.id('C3'), jsonb_build_object('motivo', 'Dos con costura abierta',
  'lineas', jsonb_build_array(jsonb_build_object('compra_linea_id', (select id from public.compra_lineas where compra_id = pg_temp.id('C3')), 'cantidad', 2))));
select pruebas.igual((select app_saldo from (select (public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{saldos,compras_por_pagar}')::numeric as app_saldo) x),
                     105000 + 140000 - 28000, 'la devolución al proveedor baja lo que se le debe');

-- ---------------------------------------------------------------------
-- F. Estampado anulado: vuelve todo como estaba
-- ---------------------------------------------------------------------
create temporary table inv0 as
select pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro') as nav, pruebas.existencia('BASE-CR-M-BLA', 'Tienda Centro') as base,
       pruebas.existencia('MAT-TR', 'Tienda Centro') as mat,
       (public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{saldos,valor_inventario,total}')::numeric as valor,
       (public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{calculado,perdidas_inventario}')::numeric as perdidas;
insert into ids select 'E9', public.guardar_orden_estampado(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 2))));
select public.registrar_estampado(pg_temp.id('E9'), jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
  'linea_id', (select id from public.orden_estampado_lineas where orden_id = pg_temp.id('E9')), 'buenas', 1, 'danadas', 1))));
select public.anular_estampado(pg_temp.id('E9'), 'Registrada por error');
select pruebas.afirmar(i.nav = pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro')
                       and i.base = pruebas.existencia('BASE-CR-M-BLA', 'Tienda Centro')
                       and i.mat = pruebas.existencia('MAT-TR', 'Tienda Centro'),
                       'anular el estampado devuelve las existencias') from inv0 i;
select pruebas.igual((public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{saldos,valor_inventario,total}')::numeric,
                     (select valor from inv0), 'anular el estampado devuelve el valor del inventario');
select pruebas.igual((public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{calculado,perdidas_inventario}')::numeric,
                     (select perdidas from inv0), 'anular el estampado reversa su pérdida');

-- El costo histórico de una venta no cambia aunque cambie el promedio
select pruebas.igual((select costo_unitario from public.venta_linea_costos where venta_linea_id = pg_temp.id('V1L')), 15500,
                     'el costo congelado de la venta se conserva');
select pruebas.afirmar((select count(*) from public.historial_costos where variante_id = pruebas.var('BASE-CR-M-BLA')) >= 2,
                       'cada cambio de costo queda en el historial');

-- ---------------------------------------------------------------------
-- G. Gastos: mercancía va a Compras, recurrentes una vez por periodo, anulación con reverso
-- ---------------------------------------------------------------------
select pruebas.falla($$select public.registrar_gasto(jsonb_build_object('categoria_id',
                         (select id from public.categorias_gasto where nombre = 'Compra de camisetas'),
                         'descripcion', 'x', 'valor', 1000))$$, 'regístrala en Compras', 'la mercancía no se registra como gasto');
insert into public.gastos_recurrentes (nombre, categoria_id, valor, frecuencia, dia)
select 'Arriendo local', id, 500000, 'mensual', 5 from public.categorias_gasto where nombre = 'Arriendo';
select pruebas.igual(public.generar_gastos_recurrentes(), 1, 'la plantilla crea el gasto del periodo');
select pruebas.igual(public.generar_gastos_recurrentes(), 0, 'y no lo repite');
insert into ids select 'G2', public.registrar_gasto(jsonb_build_object(
  'categoria_id', (select id from public.categorias_gasto where nombre = 'Transporte'), 'descripcion', 'Domicilio',
  'valor', 8000, 'bodega_id', pruebas.bod('Tienda Centro'), 'pagado', true, 'metodo_pago_id', pruebas.metodo('Efectivo')));
create temporary table caja0 as select (select saldo from public.saldos_cuentas() where nombre = 'Caja Tienda Centro') as s;
select public.anular_gasto(pg_temp.id('G2'), 'Duplicado');
select pruebas.igual((select saldo from public.saldos_cuentas() where nombre = 'Caja Tienda Centro') - (select s from caja0), 8000,
                     'anular un gasto pagado devuelve el dinero a su caja');

-- ---------------------------------------------------------------------
-- H. Cierre de caja: la diferencia exige justificación y queda registrada
-- ---------------------------------------------------------------------
create temporary table caja1 as select (select saldo from public.saldos_cuentas() where nombre = 'Caja Tienda Centro') as s;
select pruebas.falla($$select public.cerrar_caja(pruebas.cuenta('Caja Tienda Centro'), (select s - 1000 from caja1))$$,
                     'justificación', 'una diferencia sin justificar no se acepta');
select public.cerrar_caja(pruebas.cuenta('Caja Tienda Centro'), (select s - 1000 from caja1), 'Faltó un billete en el conteo');
select pruebas.igual((select saldo from public.saldos_cuentas() where nombre = 'Caja Tienda Centro'), (select s - 1000 from caja1),
                     'tras el cierre el saldo es lo contado');
reset role;
select pruebas.afirmar(jsonb_array_length(public.salud_datos() -> 'existencias_vs_kardex') = 0
                       and jsonb_array_length(public.salud_datos() -> 'apartado_vs_ventas') = 0
                       and (public.salud_datos() ->> 'pagos_sin_movimiento_caja')::int = 0,
                       'la salud de datos no encuentra diferencias')
  from (select pruebas.como('admin@luma.test')) x;
