-- =====================================================================
-- LUMA · 15 · Índices de claves foráneas y de consultas por punto y fecha
-- =====================================================================

-- Informes por punto de venta y periodo
create index movimientos_inventario_bodega_fecha_idx on public.movimientos_inventario (bodega_id, ocurrido_en);

-- Claves foráneas sin índice propio
create index ajuste_lineas_variante_id_idx on public.ajuste_lineas (variante_id);
create index compra_costos_adicionales_compra_id_idx on public.compra_costos_adicionales (compra_id);
create index compras_bodega_id_idx on public.compras (bodega_id);
create index descuentos_autorizados_producto_id_idx on public.descuentos_autorizados (producto_id);
create index descuentos_autorizados_variante_id_idx on public.descuentos_autorizados (variante_id);
create index devolucion_proveedor_lineas_compra_linea_id_idx on public.devolucion_proveedor_lineas (compra_linea_id);
create index devolucion_proveedor_lineas_devolucion_id_idx on public.devolucion_proveedor_lineas (devolucion_id);
create index devolucion_proveedor_lineas_variante_id_idx on public.devolucion_proveedor_lineas (variante_id);
create index devolucion_venta_lineas_devolucion_id_idx on public.devolucion_venta_lineas (devolucion_id);
create index devoluciones_proveedor_bodega_id_idx on public.devoluciones_proveedor (bodega_id);
create index devoluciones_proveedor_compra_id_idx on public.devoluciones_proveedor (compra_id);
create index devoluciones_venta_bodega_id_idx on public.devoluciones_venta (bodega_id);
create index diseno_materiales_material_id_idx on public.diseno_materiales (material_id);
create index diseno_materiales_talla_id_idx on public.diseno_materiales (talla_id);
create index gastos_bodega_id_idx on public.gastos (bodega_id);
create index gastos_cuenta_id_idx on public.gastos (cuenta_id);
create index gastos_metodo_pago_id_idx on public.gastos (metodo_pago_id);
create index gastos_proveedor_id_idx on public.gastos (proveedor_id);
create index gastos_recurrentes_categoria_id_idx on public.gastos_recurrentes (categoria_id);
create index gastos_recurrentes_proveedor_id_idx on public.gastos_recurrentes (proveedor_id);
create index metodos_pago_cuenta_id_idx on public.metodos_pago (cuenta_id);
create index orden_estampado_consumos_variante_id_idx on public.orden_estampado_consumos (variante_id);
create index orden_estampado_lineas_variante_id_idx on public.orden_estampado_lineas (variante_id);
create index ordenes_estampado_bodega_id_idx on public.ordenes_estampado (bodega_id);
create index pagos_compra_cuenta_id_idx on public.pagos_compra (cuenta_id);
create index pagos_venta_cuenta_id_idx on public.pagos_venta (cuenta_id);
create index pagos_venta_metodo_pago_id_idx on public.pagos_venta (metodo_pago_id);
create index rol_permisos_permiso_codigo_idx on public.rol_permisos (permiso_codigo);
create index traslados_destino_id_idx on public.traslados (destino_id);
create index traslados_origen_id_idx on public.traslados (origen_id);
create index variantes_color_id_idx on public.variantes (color_id);
create index variantes_talla_id_idx on public.variantes (talla_id);
create index venta_lineas_descuento_autorizado_id_idx on public.venta_lineas (descuento_autorizado_id);
