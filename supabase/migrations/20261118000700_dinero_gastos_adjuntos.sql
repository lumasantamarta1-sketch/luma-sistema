-- =====================================================================
-- LUMA · 07 · Dinero, gastos y adjuntos
-- =====================================================================

-- Cada punto de venta tiene su propia cuenta de efectivo
create table public.cuentas_dinero (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text not null check (tipo in ('efectivo', 'nequi', 'banco', 'otro')),
  bodega_id uuid references public.bodegas (id),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint cuentas_efectivo_chk check (tipo <> 'efectivo' or bodega_id is not null)
);
create unique index cuentas_efectivo_punto_uk on public.cuentas_dinero (bodega_id)
  where tipo = 'efectivo' and activo;

-- El método "efectivo" usa la caja del punto de la venta; los demás, su cuenta fija
create table public.metodos_pago (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text not null check (tipo in ('efectivo', 'nequi', 'transferencia', 'otro')),
  cuenta_id uuid references public.cuentas_dinero (id),
  activo boolean not null default true,
  constraint metodos_cuenta_chk check (tipo = 'efectivo' or cuenta_id is not null)
);

create table public.impuestos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  porcentaje numeric(5,2) not null check (porcentaje >= 0),
  activo boolean not null default false
);

create table public.pagos_venta (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas (id),
  tipo text not null default 'pago' check (tipo in ('pago', 'reembolso')),
  fecha timestamptz not null default now(),
  metodo_pago_id uuid not null references public.metodos_pago (id),
  cuenta_id uuid not null references public.cuentas_dinero (id),
  valor numeric(14,2) not null check (valor > 0),
  referencia text,
  clave uuid unique,
  registrado_por uuid default auth.uid()
);
create index pagos_venta_venta_idx on public.pagos_venta (venta_id);
create index pagos_venta_fecha_idx on public.pagos_venta (fecha);

create table public.pagos_compra (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id),
  tipo text not null default 'pago' check (tipo in ('pago', 'reembolso')),
  fecha timestamptz not null default now(),
  cuenta_id uuid not null references public.cuentas_dinero (id),
  valor numeric(14,2) not null check (valor > 0),
  referencia text,
  clave uuid unique,
  registrado_por uuid default auth.uid()
);
create index pagos_compra_compra_idx on public.pagos_compra (compra_id);

-- Libro de caja: todo cobro y todo pago deja aquí su movimiento. No se modifica ni se borra.
create table public.movimientos_caja (
  id bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  cuenta_id uuid not null references public.cuentas_dinero (id),
  sentido text not null check (sentido in ('entrada', 'salida')),
  origen text not null check (origen in (
    'cobro_venta', 'reembolso_cliente', 'pago_compra', 'reembolso_proveedor', 'pago_gasto',
    'traslado', 'aporte', 'retiro', 'ajuste_cierre', 'saldo_inicial', 'anulacion')),
  valor numeric(14,2) not null check (valor > 0),
  documento_tipo text,
  documento_id uuid,
  descripcion text,
  clave uuid,
  usuario_id uuid default auth.uid()
);
create unique index movimientos_caja_clave_uk on public.movimientos_caja (clave, sentido) where clave is not null;
create index movimientos_caja_cuenta_idx on public.movimientos_caja (cuenta_id, ocurrido_en);
create index movimientos_caja_documento_idx on public.movimientos_caja (documento_tipo, documento_id);
create index movimientos_caja_fecha_idx on public.movimientos_caja (ocurrido_en);

create trigger movimientos_caja_inmutable
  before update or delete on public.movimientos_caja
  for each row execute function app.bloquear_cambios();

create table public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas_dinero (id),
  fecha date not null,
  saldo_esperado numeric(14,2) not null,
  saldo_contado numeric(14,2) not null check (saldo_contado >= 0),
  justificacion text,
  cerrado_por uuid default auth.uid(),
  cerrado_en timestamptz not null default now(),
  unique (cuenta_id, fecha),
  constraint cierres_justificacion_chk check (saldo_contado = saldo_esperado or length(btrim(coalesce(justificacion, ''))) > 0)
);

-- Gastos: las categorías de mercancía se registran en Compras, no aquí
create table public.categorias_gasto (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text not null check (tipo in ('operativo', 'mercancia')),
  activo boolean not null default true
);

create table public.gastos_recurrentes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria_id uuid not null references public.categorias_gasto (id),
  proveedor_id uuid references public.proveedores (id),
  beneficiario text,
  valor numeric(14,2) not null check (valor > 0),
  frecuencia text not null check (frecuencia in ('semanal', 'quincenal', 'mensual')),
  dia integer check (dia is null or dia between 1 and 31),
  activo boolean not null default true,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);

create table public.gastos (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  fecha date not null default ((now() at time zone 'America/Bogota')::date),
  categoria_id uuid not null references public.categorias_gasto (id),
  descripcion text not null check (length(btrim(descripcion)) > 0),
  proveedor_id uuid references public.proveedores (id),
  beneficiario text,
  valor numeric(14,2) not null check (valor > 0),
  bodega_id uuid references public.bodegas (id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'anulado')),
  metodo_pago_id uuid references public.metodos_pago (id),
  cuenta_id uuid references public.cuentas_dinero (id),
  pagado_en timestamptz,
  recurrente_id uuid references public.gastos_recurrentes (id),
  periodo text,
  clave uuid unique,
  registrado_por uuid default auth.uid(),
  registrado_en timestamptz not null default now(),
  anulado_por uuid,
  anulado_en timestamptz,
  motivo_anulacion text,
  constraint gastos_recurrente_uk unique (recurrente_id, periodo),
  constraint gastos_pagado_chk check (estado <> 'pagado' or (cuenta_id is not null and pagado_en is not null))
);
create index gastos_fecha_idx on public.gastos (fecha);
create index gastos_categoria_idx on public.gastos (categoria_id, fecha);
create index gastos_estado_idx on public.gastos (estado);

-- Adjuntos: la ruta apunta a Storage privado
create table public.adjuntos (
  id uuid primary key default gen_random_uuid(),
  documento_tipo text not null check (documento_tipo in (
    'producto', 'diseno', 'compra', 'venta', 'venta_linea', 'gasto', 'ajuste', 'devolucion_venta', 'devolucion_proveedor')),
  documento_id uuid not null,
  ruta text not null unique,
  nombre_archivo text not null,
  tipo_mime text not null,
  tamano_bytes integer not null check (tamano_bytes > 0 and tamano_bytes <= 52428800),
  subido_por uuid default auth.uid(),
  subido_en timestamptz not null default now()
);
create index adjuntos_documento_idx on public.adjuntos (documento_tipo, documento_id);
