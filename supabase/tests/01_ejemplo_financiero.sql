-- =====================================================================
-- Pruebas · 01 · El ejemplo de la sección 9 de la propuesta, de punta a punta.
-- Cifras ficticias. Debe dar: ventas netas 260.000, costo 93.000, utilidad bruta 167.000,
-- gastos operativos 65.500, resultado 101.500, flujo −260.000 e inventario 356.500.
-- =====================================================================
select pruebas.como('admin@luma.test');
set role authenticated;

-- Catálogo mínimo
insert into public.proveedores (nombre) values ('Proveedor de prueba');
insert into public.tipos_camiseta (nombre) values ('Cuello redondo');
insert into public.colores (nombre, hex) values ('Blanco', '#FFFFFF');
insert into public.productos (codigo, nombre, clase) values ('BASE-CR', 'Camiseta base cuello redondo', 'base');
insert into public.productos (codigo, nombre, clase, unidad_medida) values ('MAT-TR', 'Transfer de estampado', 'material', 'hoja');
insert into public.productos (codigo, nombre, clase, se_vende) values ('NAV', 'Camiseta Navidad', 'terminado', true);
insert into public.disenos (codigo, nombre) values ('NAV', 'Navidad');

-- La camiseta terminada se crea antes que su base: el sistema las enlaza solo
insert into public.variantes (producto_id, sku, tipo_id, talla_id, color_id, diseno_id, precio_venta)
select p.id, 'NAV-CR-M-BLA', t.id, ta.id, c.id, d.id, 45000
  from public.productos p, public.tipos_camiseta t, public.tallas ta, public.colores c, public.disenos d
 where p.codigo = 'NAV' and t.nombre = 'Cuello redondo' and ta.nombre = 'M' and c.nombre = 'Blanco' and d.codigo = 'NAV';
insert into public.variantes (producto_id, sku, tipo_id, talla_id, color_id)
select p.id, 'BASE-CR-M-BLA', t.id, ta.id, c.id
  from public.productos p, public.tipos_camiseta t, public.tallas ta, public.colores c
 where p.codigo = 'BASE-CR' and t.nombre = 'Cuello redondo' and ta.nombre = 'M' and c.nombre = 'Blanco';
insert into public.variantes (producto_id, sku) select id, 'MAT-TR' from public.productos where codigo = 'MAT-TR';
select pruebas.afirmar((select variante_base_id from public.variantes where sku = 'NAV-CR-M-BLA') = pruebas.var('BASE-CR-M-BLA'),
                       'la camiseta terminada queda enlazada con su camiseta base');
insert into public.diseno_materiales (diseno_id, material_id, cantidad)
select d.id, pruebas.var('MAT-TR'), 1 from public.disenos d where d.codigo = 'NAV';

-- 1. Compra de 30 camisetas base a $ 12.000, recibida y pagada
select public.guardar_compra(null, jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('BASE-CR-M-BLA'), 'cantidad', 30, 'costo_unitario', 12000))));
select public.confirmar_compra((select id from public.compras where numero = 'C-00001'), true);
select public.registrar_pago_compra((select id from public.compras where numero = 'C-00001'),
                                    pruebas.cuenta('Cuenta bancaria'), 360000, null, gen_random_uuid());

-- 2. Compra de material para 30 camisetas a $ 3.500, recibida y sin pagar
select public.guardar_compra(null, jsonb_build_object(
  'proveedor_id', (select id from public.proveedores limit 1), 'bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('MAT-TR'), 'cantidad', 30, 'costo_unitario', 3500))));
select public.confirmar_compra((select id from public.compras where numero = 'C-00002'), true);
select pruebas.igual(pruebas.existencia('BASE-CR-M-BLA', 'Tienda Centro'), 30, 'camisetas base recibidas');
select pruebas.igual(pruebas.promedio('BASE-CR-M-BLA'), 12000, 'costo promedio de la camiseta base');

-- 3. Estampado de 20 camisetas: 19 buenas y 1 dañada
select public.guardar_orden_estampado(null, jsonb_build_object(
  'bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 20))));
select public.registrar_estampado((select id from public.ordenes_estampado where numero = 'E-00001'),
  jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
    'linea_id', (select l.id from public.orden_estampado_lineas l join public.ordenes_estampado o on o.id = l.orden_id
                  where o.numero = 'E-00001'),
    'buenas', 19, 'danadas', 1))));
select pruebas.igual(pruebas.promedio('NAV-CR-M-BLA'), 15500, 'costo unitario del estampado');
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro'), 19, 'camisetas terminadas buenas');
select pruebas.igual(pruebas.existencia('BASE-CR-M-BLA', 'Tienda Centro'), 10, 'camisetas base que quedan');
select pruebas.igual(pruebas.existencia('MAT-TR', 'Tienda Centro'), 10, 'material que queda');

-- 4. Venta de 6 camisetas a $ 45.000 con $ 10.000 de descuento; el cliente paga $ 150.000
select public.guardar_cotizacion(null, jsonb_build_object(
  'bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 6, 'descuento', 10000))));
select public.confirmar_venta((select id from public.ventas where numero_cotizacion = 'COT-00001'), gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('metodo_pago_id', pruebas.metodo('Efectivo'), 'valor', 150000, 'clave', gen_random_uuid())));
select pruebas.igual(pruebas.apartada('NAV-CR-M-BLA', 'Tienda Centro'), 6, 'confirmar aparta las unidades');
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro'), 19, 'confirmar no saca del inventario');
select public.entregar_venta((select id from public.ventas where numero = 'V-00001'));
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro'), 13, 'entregar saca del inventario');
select pruebas.igual(pruebas.apartada('NAV-CR-M-BLA', 'Tienda Centro'), 0, 'entregar libera lo apartado');

-- 5. Gasto de publicidad pagado
select public.registrar_gasto(jsonb_build_object(
  'categoria_id', (select id from public.categorias_gasto where nombre = 'Publicidad'),
  'descripcion', 'Pauta de prueba', 'valor', 50000, 'pagado', true, 'metodo_pago_id', pruebas.metodo('Transferencia')));

-- Resultado del periodo
create temporary table r as select public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) as j;
select pruebas.igual((j #>> '{calculado,ventas_netas}')::numeric, 260000, 'ventas netas') from r;
select pruebas.igual((j #>> '{calculado,costo_mercancia_vendida}')::numeric, 93000, 'costo de mercancía vendida') from r;
select pruebas.igual((j #>> '{calculado,utilidad_bruta}')::numeric, 167000, 'utilidad bruta') from r;
select pruebas.igual((j #>> '{calculado,margen_bruto}')::numeric, 0.6423, 'margen bruto') from r;
select pruebas.igual((j #>> '{calculado,perdidas_inventario}')::numeric, 15500, 'pérdida en estampado') from r;
select pruebas.igual((j #>> '{calculado,gastos_operativos}')::numeric, 65500, 'gastos operativos con pérdidas') from r;
select pruebas.igual((j #>> '{calculado,resultado_operativo}')::numeric, 101500, 'resultado operativo') from r;
select pruebas.igual((j #>> '{calculado,compras_recibidas}')::numeric, 465000, 'compras recibidas') from r;
select pruebas.igual((j #>> '{dinero_real,flujo_de_caja}')::numeric, -260000, 'flujo de caja') from r;
select pruebas.igual((j #>> '{saldos,cuentas_por_cobrar}')::numeric, 110000, 'cuentas por cobrar') from r;
select pruebas.igual((j #>> '{saldos,cuentas_por_pagar}')::numeric, 105000, 'cuentas por pagar') from r;
select pruebas.igual((j #>> '{saldos,valor_inventario,total}')::numeric, 356500, 'valor del inventario') from r;

-- El costo de la venta quedó congelado y el kardex cuadra con las existencias
select pruebas.igual((select costo_unitario from public.venta_linea_costos), 15500, 'costo congelado de la línea vendida');
select pruebas.afirmar(jsonb_array_length(public.salud_datos() -> 'existencias_vs_kardex') = 0,
                       'existencias y kardex coinciden');
reset role;
