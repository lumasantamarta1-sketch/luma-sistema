-- =====================================================================
-- LUMA · 05 · Ventas, descuentos autorizados y devoluciones de clientes
-- =====================================================================

-- Al confirmar, la venta aparta las unidades; al entregar, salen del inventario
create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  numero_cotizacion text unique,
  bodega_id uuid not null references public.bodegas (id),
  cliente_id uuid references public.clientes (id),
  vendedor_id uuid not null default auth.uid() references public.perfiles (id),
  estado text not null default 'cotizacion' check (estado in ('cotizacion', 'confirmada', 'cancelada')),
  estado_entrega text not null default 'pendiente'
    check (estado_entrega in ('pendiente', 'por_estampar', 'en_preparacion', 'entregada')),
  subtotal numeric(14,2) not null default 0,
  descuentos numeric(14,2) not null default 0,
  impuestos numeric(14,2) not null default 0,      -- IVA incluido en el precio, si aplica
  total numeric(14,2) not null default 0,
  observaciones text,
  clave_confirmacion uuid unique,
  creado_en timestamptz not null default now(),
  confirmada_en timestamptz,
  entregada_en timestamptz,
  entregada_por uuid,
  cancelada_en timestamptz,
  cancelada_por uuid,
  motivo_cancelacion text,
  constraint ventas_numero_chk check (estado = 'cotizacion' or numero is not null or cancelada_en is not null)
);
create index ventas_bodega_idx on public.ventas (bodega_id, creado_en desc);
create index ventas_vendedor_idx on public.ventas (vendedor_id, creado_en desc);
create index ventas_cliente_idx on public.ventas (cliente_id);
create index ventas_entrega_idx on public.ventas (entregada_en) where entregada_en is not null;

-- Descuentos que el administrador autoriza antes: promociones o uno puntual para una venta
create table public.descuentos_autorizados (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('promocion', 'puntual')),
  nombre text not null,
  porcentaje numeric(5,2) check (porcentaje is null or (porcentaje > 0 and porcentaje <= 100)),
  valor_por_unidad numeric(14,2) check (valor_por_unidad is null or valor_por_unidad > 0),
  -- Solo para descuentos puntuales: un valor fijo para la venta, repartido entre sus líneas
  valor_total numeric(14,2) check (valor_total is null or valor_total > 0),
  producto_id uuid references public.productos (id),
  variante_id uuid references public.variantes (id),
  venta_id uuid references public.ventas (id),
  vigente_desde date,
  vigente_hasta date,
  activo boolean not null default true,
  autorizado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now(),
  constraint descuentos_forma_chk check (num_nonnulls(porcentaje, valor_por_unidad, valor_total) = 1),
  constraint descuentos_valor_total_chk check (valor_total is null or tipo = 'puntual'),
  constraint descuentos_puntual_chk check (tipo <> 'puntual' or venta_id is not null),
  constraint descuentos_vigencia_chk check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);

create table public.venta_lineas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas (id) on delete cascade,
  variante_id uuid not null references public.variantes (id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  descuento numeric(14,2) not null default 0 check (descuento >= 0),
  descuento_autorizado_id uuid references public.descuentos_autorizados (id),
  impuesto_pct numeric(5,2) not null default 0,
  impuesto numeric(14,2) not null default 0,
  personalizacion text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'apartada', 'por_estampar', 'entregada')),
  -- Unidades ya reservadas para esta línea en el punto de la venta
  cantidad_apartada numeric(12,3) not null default 0,
  constraint venta_lineas_descuento_chk check (descuento <= cantidad * precio_unitario),
  constraint venta_lineas_apartada_chk check (cantidad_apartada >= 0 and cantidad_apartada <= cantidad)
);
create index venta_lineas_venta_idx on public.venta_lineas (venta_id);
create index venta_lineas_variante_idx on public.venta_lineas (variante_id);

-- Costo congelado al entregar: no cambia aunque el promedio cambie después
create table public.venta_linea_costos (
  venta_linea_id uuid primary key references public.venta_lineas (id),
  costo_unitario numeric(14,4) not null check (costo_unitario >= 0),
  registrado_en timestamptz not null default now()
);

create table public.devoluciones_venta (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  venta_id uuid not null references public.ventas (id),
  bodega_id uuid not null references public.bodegas (id),
  motivo text not null check (length(btrim(motivo)) > 0),
  valor_total numeric(14,2) not null default 0,
  clave uuid unique,
  registrado_por uuid default auth.uid(),
  registrado_en timestamptz not null default now()
);
create index devoluciones_venta_idx on public.devoluciones_venta (venta_id);

create table public.devolucion_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references public.devoluciones_venta (id) on delete cascade,
  venta_linea_id uuid not null references public.venta_lineas (id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  condicion text not null check (condicion in ('buena', 'danada')),
  valor numeric(14,2) not null check (valor >= 0)
);
create index devolucion_venta_lineas_linea_idx on public.devolucion_venta_lineas (venta_linea_id);
