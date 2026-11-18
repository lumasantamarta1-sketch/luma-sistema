-- =====================================================================
-- Pruebas · 02 · Permisos por rol, RLS, reglas fijas, libros inmutables y auditoría
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vendedor: no ve costos ni ventas ajenas, solo opera en su punto
-- ---------------------------------------------------------------------
select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.igual((select count(*) from public.variante_costos), 0, 'vendedor no ve costos de productos');
select pruebas.igual((select count(*) from public.venta_linea_costos), 0, 'vendedor no ve costos de ventas');
select pruebas.igual((select count(*) from public.movimientos_inventario), 0, 'vendedor no lee el kardex valorizado');
select pruebas.igual((select count(*) from public.compras), 0, 'vendedor no ve compras');
select pruebas.igual((select count(*) from public.ventas), 0, 'vendedor no ve ventas ajenas');
select pruebas.afirmar((select count(*) from public.existencias_detalle where bodega = 'Tienda Centro') > 0,
                       'vendedor ve existencias de su punto');
select pruebas.falla($$select * from public.kardex()$$, 'inventario.kardex', 'vendedor no consulta el kardex');
select pruebas.falla($$select public.resumen_financiero(current_date, current_date)$$, 'informes.financieros',
                     'vendedor no ve finanzas');
select pruebas.falla($$insert into public.existencias (variante_id, bodega_id, cantidad)
                       values (pruebas.var('NAV-CR-M-BLA'), pruebas.bod('Tienda Centro'), 100)$$,
                     'permission denied', 'nadie escribe existencias directamente');
select pruebas.falla($$update public.ventas set total = 1$$, 'permission denied', 'nadie edita ventas directamente');
select pruebas.falla($$select public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Norte'),
                       'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 1))))$$,
                     'acceso a este punto', 'vendedor no vende en un punto que no tiene asignado');
select pruebas.falla($$select public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
                       'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 1,
                                                                      'descuento', 5000))))$$,
                     'descuentos autorizados', 'vendedor no inventa descuentos');
update public.variantes set precio_venta = 1000 where sku = 'NAV-CR-M-BLA';
select pruebas.igual((select precio_venta from public.variantes where sku = 'NAV-CR-M-BLA'), 45000,
                     'vendedor no cambia precios');
select pruebas.falla($$insert into public.rol_permisos (rol_id, permiso_codigo)
                       select id, 'costos.ver' from public.roles where codigo = 'vendedor'$$,
                     'row-level security', 'vendedor no se asigna permisos');
reset role;

-- El administrador autoriza una promoción del 10 % sobre la camiseta Navidad
select pruebas.como('admin@luma.test');
set role authenticated;
insert into public.descuentos_autorizados (tipo, nombre, porcentaje, producto_id, autorizado_por)
select 'promocion', 'Navidad 10 %', 10, id, auth.uid() from public.productos where codigo = 'NAV';
reset role;

select pruebas.como('vendedor@luma.test');
set role authenticated;
create temporary table k (venta uuid, clave uuid);
grant all on k to authenticated;
insert into k select public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 2,
            'descuento_autorizado_id', (select id from public.descuentos_autorizados where nombre = 'Navidad 10 %'))))),
  gen_random_uuid();
select pruebas.igual((select total from public.ventas where id = (select venta from k)), 81000,
                     'la promoción autorizada se aplica sola');
select public.confirmar_venta((select venta from k), (select clave from k));
select public.confirmar_venta((select venta from k), (select clave from k));
select pruebas.igual(pruebas.apartada('NAV-CR-M-BLA', 'Tienda Centro'), 2, 'confirmar dos veces con la misma clave aparta una vez');
select pruebas.falla($$select public.confirmar_venta((select venta from k), gen_random_uuid())$$, 'ya fue confirmada',
                     'otra clave no vuelve a confirmar');
select pruebas.falla($$select public.entregar_venta((select venta from k))$$, 'saldo pendiente',
                     'sin permiso de crédito no se entrega con saldo');
select public.registrar_pago_venta((select venta from k), pruebas.metodo('Nequi'), 81000, 'REF-1',
                                   '10000000-0000-0000-0000-000000000001');
select public.registrar_pago_venta((select venta from k), pruebas.metodo('Nequi'), 81000, 'REF-1',
                                   '10000000-0000-0000-0000-000000000001');
select pruebas.igual((select count(*) from public.pagos_venta where venta_id = (select venta from k)), 1,
                     'el mismo pago repetido no se registra dos veces');
select pruebas.falla($$select public.registrar_pago_venta((select venta from k), pruebas.metodo('Nequi'), 1)$$,
                     'supera el saldo', 'no se cobra más del saldo');
select public.entregar_venta((select venta from k));
select pruebas.igual((select count(*) from public.ventas), 1, 'vendedor ve su propia venta');
select pruebas.falla($$select public.saldos_cuentas()$$, 'caja.ver', 'vendedor no ve saldos de cuentas');
reset role;

select pruebas.como('vendedor2@luma.test');
set role authenticated;
select pruebas.igual((select count(*) from public.ventas), 0, 'otro vendedor no ve esa venta');
select pruebas.falla($$select public.registrar_pago_venta((select venta from k), pruebas.metodo('Efectivo'), 1000)$$,
                     'propias ventas', 'otro vendedor no la opera');
reset role;

-- ---------------------------------------------------------------------
-- Encargado de inventario: recibe y ajusta sin ver costos
-- ---------------------------------------------------------------------
select pruebas.como('inventario@luma.test');
set role authenticated;
select pruebas.igual((select count(*) from public.compras), 0, 'encargado no ve compras con costos');
select pruebas.afirmar((select bool_and(costo_unitario is null) from public.kardex()), 'el kardex llega sin costos');
select pruebas.falla($$select costo_unitario from public.ajuste_lineas$$, 'permission denied',
                     'el costo de los ajustes no se lee desde la tabla');
select pruebas.falla($$select public.solicitar_ajuste(jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
                       'tipo', 'saldo_inicial', 'motivo', 'x',
                       'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('MAT-TR'), 'cantidad', 1, 'costo_unitario', 1))))$$,
                     'costos', 'el saldo inicial lo registra quien ve costos');
create temporary table aj as
select public.solicitar_ajuste(jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'), 'tipo', 'perdida',
  'motivo', 'Camiseta manchada en vitrina',
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 1)))) as id;
grant all on aj to authenticated;
select pruebas.afirmar((select estado = 'pendiente' from public.ajustes_inventario where id = (select id from aj)),
                       'la pérdida queda pendiente de aprobación');
select pruebas.falla($$select public.resolver_ajuste((select id from aj), true)$$, 'inventario.aprobar_ajuste',
                     'el encargado no aprueba ajustes');
reset role;
-- El número de la compra se toma como postgres; la consulta la hace el encargado
create temporary table compra1 as select id from public.compras where numero = 'C-00001';
grant all on compra1 to authenticated;
set role authenticated;
select pruebas.afirmar(j ?& array['compra_linea_id', 'pendiente'] and not j ?| array['costo_unitario', 'costo_neto_unitario'],
                       'la compra para recibir no trae costos')
  from (select public.compra_para_recibir((select id from compra1)) -> 'lineas' -> 0 as j) x;
reset role;

-- ---------------------------------------------------------------------
-- Gerente: ve todo, aprueba ajustes, no vende
-- ---------------------------------------------------------------------
select pruebas.como('gerente@luma.test');
set role authenticated;
select pruebas.igual((select count(*) from public.ventas), 2, 'gerente ve todas las ventas de sus puntos');
select public.resolver_ajuste((select id from aj), true, 'Revisado');
select pruebas.igual(pruebas.existencia('NAV-CR-M-BLA', 'Tienda Centro'), 10, 'la pérdida aprobada sale del inventario');
select pruebas.falla($$select public.guardar_cotizacion(null, '{}'::jsonb)$$, 'ventas.crear', 'gerente no registra ventas');
select pruebas.afirmar((public.resumen_financiero(pruebas.hoy(), pruebas.hoy()) #>> '{calculado,perdidas_inventario}')::numeric = 31000,
                       'la pérdida aprobada suma a las pérdidas del periodo');
reset role;

-- Nadie aprueba su propio ajuste, salvo el administrador
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'supervisor@luma.test');
select pruebas.como('admin@luma.test');
set role authenticated;
insert into public.roles (codigo, nombre) values ('supervisor', 'Supervisor');
insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, p from public.roles r, unnest(array['catalogo.ver', 'inventario.ver', 'inventario.ajustar', 'inventario.aprobar_ajuste']) p
 where r.codigo = 'supervisor';
select public.asignar_usuario('00000000-0000-0000-0000-000000000010', jsonb_build_object(
  'rol_id', (select id from public.roles where codigo = 'supervisor'), 'bodegas', jsonb_build_array(pruebas.bod('Tienda Centro'))));
reset role;
select pruebas.como('supervisor@luma.test');
set role authenticated;
truncate aj;
insert into aj select public.solicitar_ajuste(jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'), 'tipo', 'ajuste',
  'motivo', 'Conteo físico', 'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('MAT-TR'), 'cantidad', -1))));
select pruebas.falla($$select public.resolver_ajuste((select id from aj), true)$$, 'propio ajuste',
                     'nadie aprueba su propio ajuste');
reset role;

-- ---------------------------------------------------------------------
-- Reglas fijas del administrador
-- ---------------------------------------------------------------------
select pruebas.como('admin@luma.test');
set role authenticated;
select pruebas.falla($$select public.asignar_usuario('00000000-0000-0000-0000-00000000000a', '{"activo": false}')$$,
                     'al menos un administrador', 'siempre queda un administrador activo');
select pruebas.falla($$insert into public.rol_permisos (rol_id, permiso_codigo)
                       select id, 'ventas.credito' from public.roles where codigo = 'vendedor'$$,
                     'Solo el Administrador', 'la venta a crédito es solo del administrador');
select pruebas.falla($$delete from public.rol_permisos where permiso_codigo = 'costos.ver'
                        and rol_id = (select id from public.roles where codigo = 'administrador')$$,
                     'conserva todos', 'el administrador conserva todos sus permisos');
select public.resolver_ajuste((select id from aj), true, 'Aprobado por el administrador');
select pruebas.igual(pruebas.existencia('MAT-TR', 'Tienda Centro'), 9, 'el administrador aprueba ajustes ajenos');
select pruebas.afirmar((public.detalle_costos('ajuste', (select id from aj)) ->> 'valor_estimado')::numeric = 3500,
                       'quien ve costos lee el valor del ajuste por función');
reset role;

-- ---------------------------------------------------------------------
-- Sin sesión no hay acceso; los libros no se modifican; todo queda auditado
-- ---------------------------------------------------------------------
set role anon;
select pruebas.falla($$select * from public.productos$$, 'permission denied', 'sin sesión no se lee nada');
select pruebas.falla($$select public.mis_permisos()$$, 'permission denied', 'sin sesión no se llama ninguna función');
reset role;

select pruebas.falla($$update public.movimientos_inventario set cantidad = 99$$, 'no se modifican', 'el kardex no se edita');
select pruebas.falla($$delete from public.movimientos_caja$$, 'no se modifican', 'el libro de caja no se borra');
select pruebas.falla($$delete from public.auditoria$$, 'no se modifican', 'la auditoría no se borra');
select pruebas.afirmar(exists (select 1 from public.auditoria
                                where tabla = 'ventas' and accion = 'actualizar'
                                  and usuario_id = '00000000-0000-0000-0000-00000000000b'
                                  and valor_nuevo ->> 'estado' = 'confirmada'),
                       'la confirmación del vendedor quedó en la auditoría');
select pruebas.afirmar(exists (select 1 from public.auditoria where tabla = 'rol_permisos' and accion = 'insertar'
                                  and usuario_id = '00000000-0000-0000-0000-00000000000a'),
                       'los cambios de permisos quedan en la auditoría');
