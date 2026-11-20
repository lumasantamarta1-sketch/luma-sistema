-- =====================================================================
-- Pruebas · 07 · Agregar inventario en un paso: saldo inicial o compra recibida, sin duplicar
-- =====================================================================
select pruebas.como('admin@luma.test');
set role authenticated;
insert into public.productos (codigo, nombre, clase, se_vende) values ('ENT', 'Camiseta para entradas', 'terminado', true);
insert into public.variantes (producto_id, sku, precio_venta) select id, 'ENT-1', 40000 from public.productos where codigo = 'ENT';

-- 1. Lo que ya se tenía: entra con su costo y no se duplica si llega dos veces
create temporary table claves (nombre text primary key, clave uuid, id uuid);
grant all on claves to authenticated;
insert into claves values ('saldo', gen_random_uuid(), null), ('compra', gen_random_uuid(), null), ('fiada', gen_random_uuid(), null);
update claves set id = public.entrada_inventario(jsonb_build_object(
  'bodega_id', pruebas.bod('Tienda Norte'), 'tipo', 'saldo_inicial', 'motivo', 'Inventario que ya tenía',
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 10, 'costo_unitario', 15000))), clave)
 where nombre = 'saldo';
select pruebas.igual(pruebas.existencia('ENT-1', 'Tienda Norte'), 10, 'entran las 10 camisetas que ya se tenían');
select pruebas.afirmar(public.entrada_inventario(jsonb_build_object(
  'bodega_id', pruebas.bod('Tienda Norte'), 'tipo', 'saldo_inicial', 'motivo', 'Inventario que ya tenía',
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 10, 'costo_unitario', 15000))),
  (select clave from claves where nombre = 'saldo')) = (select id from claves where nombre = 'saldo'),
  'la misma operación repetida devuelve el mismo ajuste');
select pruebas.igual(pruebas.existencia('ENT-1', 'Tienda Norte'), 10, 'repetirla no suma otra vez');
select pruebas.igual(pruebas.promedio('ENT-1'), 15000, 'el costo promedio queda en $ 15.000');
select pruebas.afirmar((select estado = 'aprobado' and tipo = 'saldo_inicial' from public.ajustes_inventario
                         where id = (select id from claves where nombre = 'saldo')), 'el ajuste queda aprobado como saldo inicial');

-- 2. Lo que se compró y ya se pagó: compra recibida, pagada, y sin duplicar
update claves set id = public.compra_recibida(jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Norte'),
  'forma_pago', 'Contado', 'observaciones', 'Agregada desde Agregar inventario',
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 10, 'costo_unitario', 17000))),
  clave, jsonb_build_object('cuenta_id', pruebas.cuenta('Cuenta bancaria'))) where nombre = 'compra';
select pruebas.igual(pruebas.existencia('ENT-1', 'Tienda Norte'), 20, 'entran las 10 camisetas compradas');
select pruebas.igual(pruebas.promedio('ENT-1'), 16000, 'el costo promedio pondera la compra');
select pruebas.afirmar((select estado = 'recibida' from public.compras where id = (select id from claves where nombre = 'compra')),
                       'la compra queda recibida');
reset role;
select pruebas.igual((select app.saldo_compra(id) from public.compras where id = (select id from claves where nombre = 'compra')), 0,
                     'y pagada por completo');
set role authenticated;
select pruebas.afirmar(public.compra_recibida(jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Norte'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 10, 'costo_unitario', 17000))),
  (select clave from claves where nombre = 'compra'), jsonb_build_object('cuenta_id', pruebas.cuenta('Cuenta bancaria')))
  = (select id from claves where nombre = 'compra'), 'la misma compra repetida devuelve la misma compra');
select pruebas.igual(pruebas.existencia('ENT-1', 'Tienda Norte'), 20, 'repetirla no recibe otra vez');
select pruebas.igual((select count(*) from public.pagos_compra where compra_id = (select id from claves where nombre = 'compra')), 1,
                     'ni paga otra vez');

-- 3. Compra sin pagar: queda la deuda con el proveedor
update claves set id = public.compra_recibida(jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Norte'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 2, 'costo_unitario', 16000))),
  clave) where nombre = 'fiada';
reset role;
select pruebas.igual((select app.saldo_compra(id) from public.compras where id = (select id from claves where nombre = 'fiada')), 32000,
                     'la compra sin pagar queda debiendo $ 32.000');
set role authenticated;

-- 4. Si algo falla, no queda nada a medias
select pruebas.falla($$select public.compra_recibida(jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Norte'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 1, 'costo_unitario', 1000))),
  gen_random_uuid(), jsonb_build_object('cuenta_id', gen_random_uuid()))$$, '', 'un pago a una cuenta que no existe se rechaza');
select pruebas.igual(pruebas.existencia('ENT-1', 'Tienda Norte'), 22, 'y la compra fallida no movió el inventario');
reset role;

-- 5. Permisos: el vendedor no agrega inventario
select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.falla($$select public.entrada_inventario(jsonb_build_object(
  'bodega_id', pruebas.bod('Tienda Centro'), 'tipo', 'saldo_inicial', 'motivo', 'x',
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ENT-1'), 'cantidad', 1, 'costo_unitario', 1))), gen_random_uuid())$$,
  'inventario.ajustar', 'el vendedor no agrega inventario');
select pruebas.falla($$select public.compra_recibida('{}'::jsonb, gen_random_uuid())$$, 'compras.gestionar', 'ni registra compras');
reset role;
