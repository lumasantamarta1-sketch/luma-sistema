-- =====================================================================
-- LUMA · 14 · Datos iniciales de operación (no son datos de demostración):
-- roles, permisos, numeración, tallas, categorías de gasto y métodos de pago.
-- No crea productos, existencias, clientes, proveedores, ventas ni gastos.
-- =====================================================================

insert into public.roles (codigo, nombre, descripcion, es_sistema) values
  ('administrador', 'Administrador', 'Acceso completo. Crea usuarios, autoriza descuentos y ventas a crédito.', true),
  ('gerente', 'Gerente', 'Consulta ventas, inventario, gastos y finanzas. Aprueba ajustes, anulaciones y devoluciones.', true),
  ('vendedor', 'Vendedor', 'Registra sus ventas, cobra y entrega en sus puntos. No ve costos ni finanzas.', true),
  ('encargado_inventario', 'Encargado de inventario', 'Recibe compras, registra estampados, traslados y ajustes. No ve costos.', true),
  ('contabilidad', 'Contabilidad', 'Consulta ventas, compras e informes financieros. Registra y paga gastos.', true),
  ('consulta', 'Consulta', 'Solo lectura de productos, existencias y ventas, sin costos ni finanzas.', true);

-- Cada permiso nuevo queda asignado al administrador por el disparador
insert into public.permisos (codigo, modulo, descripcion) values
  ('configuracion.gestionar', 'Configuración', 'Configurar negocio, impuestos, métodos de pago, cuentas, numeración y puntos de venta'),
  ('usuarios.gestionar', 'Usuarios', 'Crear usuarios y asignar roles, permisos y puntos de venta'),
  ('auditoria.ver', 'Usuarios', 'Consultar la auditoría'),
  ('bodegas.todas', 'Inventario', 'Ver y operar en todos los puntos de venta'),
  ('catalogo.ver', 'Productos', 'Ver productos, variantes, precios, diseños y recetas'),
  ('catalogo.gestionar', 'Productos', 'Crear y editar productos, variantes, catálogos, diseños y recetas'),
  ('precios.gestionar', 'Productos', 'Cambiar precios de venta'),
  ('costos.ver', 'Productos', 'Ver costos, márgenes, kardex valorizado y utilidades'),
  ('inventario.ver', 'Inventario', 'Ver existencias'),
  ('inventario.kardex', 'Inventario', 'Ver movimientos de inventario'),
  ('inventario.ajustar', 'Inventario', 'Solicitar ajustes, pérdidas y saldos iniciales'),
  ('inventario.aprobar_ajuste', 'Inventario', 'Aprobar o rechazar ajustes'),
  ('traslados.ver', 'Inventario', 'Ver traslados entre puntos'),
  ('traslados.gestionar', 'Inventario', 'Crear, enviar, recibir y anular traslados'),
  ('compras.ver', 'Compras', 'Ver compras con sus costos'),
  ('compras.gestionar', 'Compras', 'Crear, confirmar, anular y devolver compras'),
  ('compras.recibir', 'Compras', 'Recibir mercancía sin ver costos'),
  ('compras.pagar', 'Compras', 'Registrar pagos a proveedores'),
  ('proveedores.ver', 'Compras', 'Ver proveedores'),
  ('proveedores.gestionar', 'Compras', 'Crear y editar proveedores'),
  ('estampado.ver', 'Estampado', 'Ver órdenes de estampado'),
  ('estampado.gestionar', 'Estampado', 'Crear órdenes y registrar estampados, dañadas y material usado'),
  ('estampado.anular', 'Estampado', 'Anular órdenes de estampado'),
  ('ventas.ver', 'Ventas', 'Ver todas las ventas de sus puntos'),
  ('ventas.ver_propias', 'Ventas', 'Ver solo sus propias ventas'),
  ('ventas.crear', 'Ventas', 'Crear cotizaciones y confirmar ventas'),
  ('ventas.entregar', 'Ventas', 'Ver pedidos por preparar y entregarlos'),
  ('ventas.cobrar', 'Ventas', 'Registrar pagos de ventas'),
  ('ventas.credito', 'Ventas', 'Entregar ventas con saldo pendiente'),
  ('ventas.anular', 'Ventas', 'Anular ventas confirmadas'),
  ('ventas.devolver', 'Ventas', 'Registrar devoluciones de clientes y reembolsos'),
  ('descuentos.autorizar', 'Ventas', 'Autorizar descuentos y aplicarlos sin autorización previa'),
  ('clientes.ver', 'Clientes', 'Ver clientes'),
  ('clientes.crear', 'Clientes', 'Registrar clientes'),
  ('clientes.gestionar', 'Clientes', 'Editar y desactivar clientes'),
  ('gastos.ver', 'Gastos', 'Ver gastos'),
  ('gastos.registrar', 'Gastos', 'Registrar gastos'),
  ('gastos.pagar', 'Gastos', 'Pagar gastos pendientes'),
  ('gastos.anular', 'Gastos', 'Anular gastos'),
  ('gastos.configurar', 'Gastos', 'Gestionar categorías y gastos recurrentes'),
  ('caja.ver', 'Caja', 'Ver cuentas, saldos y movimientos de caja'),
  ('caja.gestionar', 'Caja', 'Registrar traslados entre cuentas, aportes, retiros y saldos iniciales'),
  ('caja.cerrar', 'Caja', 'Hacer el cierre de caja'),
  ('informes.ver', 'Informes', 'Ver informes operativos'),
  ('informes.inventario', 'Informes', 'Ver informes de inventario y estampado'),
  ('informes.financieros', 'Informes', 'Ver resultados financieros y la pestaña Finanzas'),
  ('informes.exportar', 'Informes', 'Exportar informes');

-- Matriz de la sección 7 de la propuesta
insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, x.permiso
  from public.roles r
  join (values
    ('gerente', 'catalogo.ver'), ('gerente', 'costos.ver'), ('gerente', 'inventario.ver'),
    ('gerente', 'inventario.kardex'), ('gerente', 'inventario.aprobar_ajuste'), ('gerente', 'traslados.ver'),
    ('gerente', 'compras.ver'), ('gerente', 'proveedores.ver'), ('gerente', 'estampado.ver'),
    ('gerente', 'ventas.ver'), ('gerente', 'ventas.anular'), ('gerente', 'ventas.devolver'),
    ('gerente', 'clientes.ver'), ('gerente', 'gastos.ver'), ('gerente', 'caja.ver'),
    ('gerente', 'informes.ver'), ('gerente', 'informes.inventario'), ('gerente', 'informes.financieros'),
    ('gerente', 'auditoria.ver'),

    ('vendedor', 'catalogo.ver'), ('vendedor', 'inventario.ver'), ('vendedor', 'ventas.ver_propias'),
    ('vendedor', 'ventas.crear'), ('vendedor', 'ventas.cobrar'), ('vendedor', 'ventas.entregar'),
    ('vendedor', 'clientes.ver'), ('vendedor', 'clientes.crear'),

    ('encargado_inventario', 'catalogo.ver'), ('encargado_inventario', 'inventario.ver'),
    ('encargado_inventario', 'inventario.kardex'), ('encargado_inventario', 'inventario.ajustar'),
    ('encargado_inventario', 'traslados.gestionar'), ('encargado_inventario', 'compras.recibir'),
    ('encargado_inventario', 'proveedores.ver'), ('encargado_inventario', 'estampado.ver'),
    ('encargado_inventario', 'estampado.gestionar'), ('encargado_inventario', 'ventas.entregar'),
    ('encargado_inventario', 'informes.inventario'),

    ('contabilidad', 'catalogo.ver'), ('contabilidad', 'costos.ver'), ('contabilidad', 'inventario.ver'),
    ('contabilidad', 'inventario.kardex'), ('contabilidad', 'traslados.ver'), ('contabilidad', 'compras.ver'),
    ('contabilidad', 'proveedores.ver'), ('contabilidad', 'estampado.ver'), ('contabilidad', 'ventas.ver'),
    ('contabilidad', 'clientes.ver'), ('contabilidad', 'gastos.ver'), ('contabilidad', 'gastos.registrar'),
    ('contabilidad', 'gastos.pagar'), ('contabilidad', 'caja.ver'), ('contabilidad', 'informes.ver'),
    ('contabilidad', 'informes.inventario'), ('contabilidad', 'informes.financieros'),
    ('contabilidad', 'informes.exportar'),

    ('consulta', 'catalogo.ver'), ('consulta', 'inventario.ver'), ('consulta', 'ventas.ver'),
    ('consulta', 'informes.ver')
  ) as x (rol, permiso) on x.rol = r.codigo;

-- Numeración de documentos
insert into public.consecutivos (tipo, prefijo) values
  ('cotizacion', 'COT'), ('venta', 'V'), ('compra', 'C'), ('estampado', 'E'), ('traslado', 'T'),
  ('ajuste', 'A'), ('gasto', 'G'), ('devolucion_venta', 'DV'), ('devolucion_proveedor', 'DP');

-- Tallas del encargo; se pueden agregar más
insert into public.tallas (nombre, orden) values
  ('XS', 1), ('S', 2), ('M', 3), ('L', 4), ('XL', 5), ('XXL', 6);

-- Categorías del encargo. Las de mercancía se registran en Compras para no duplicar costos.
insert into public.categorias_gasto (nombre, tipo) values
  ('Compra de mercancía', 'mercancia'),
  ('Compra de camisetas', 'mercancia'),
  ('Estampados', 'mercancia'),
  ('Materiales e insumos', 'mercancia'),
  ('Empaques', 'operativo'),
  ('Transporte', 'operativo'),
  ('Envíos', 'operativo'),
  ('Publicidad', 'operativo'),
  ('Servicios públicos', 'operativo'),
  ('Arriendo', 'operativo'),
  ('Nómina y pagos al personal', 'operativo'),
  ('Comisiones', 'operativo'),
  ('Mantenimiento', 'operativo'),
  ('Otros gastos', 'operativo');

-- Medios de pago del encargo. Las cuentas guardan solo su nombre, nunca números.
-- Cada punto de venta recibe su caja de efectivo al crearse.
insert into public.cuentas_dinero (nombre, tipo) values ('Nequi', 'nequi'), ('Cuenta bancaria', 'banco');
insert into public.metodos_pago (nombre, tipo, cuenta_id) values
  ('Efectivo', 'efectivo', null),
  ('Nequi', 'nequi', (select id from public.cuentas_dinero where nombre = 'Nequi')),
  ('Transferencia', 'transferencia', (select id from public.cuentas_dinero where nombre = 'Cuenta bancaria'));

-- Los impuestos no vienen activos; se configuran cuando el contador confirme el régimen
insert into public.impuestos (nombre, porcentaje, activo) values ('IVA 19 %', 19, false);
