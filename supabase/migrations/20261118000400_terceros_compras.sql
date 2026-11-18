-- =====================================================================
-- LUMA · 04 · Clientes, proveedores y compras
-- =====================================================================

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) > 0),
  documento text,
  telefono text,
  whatsapp text,
  correo text,
  ciudad text,
  direccion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid()
);
create index clientes_nombre_idx on public.clientes (lower(nombre));
create unique index clientes_documento_uk on public.clientes (documento) where documento is not null;

create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) > 0),
  identificacion_tributaria text,
  contacto text,
  telefono text,
  correo text,
  direccion text,
  observaciones text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index proveedores_nit_uk on public.proveedores (identificacion_tributaria)
  where identificacion_tributaria is not null;

-- El inventario sube al recibir, no al confirmar
create table public.compras (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  proveedor_id uuid not null references public.proveedores (id),
  bodega_id uuid not null references public.bodegas (id),
  fecha date not null default ((now() at time zone 'America/Bogota')::date),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'confirmada', 'recibida_parcial', 'recibida', 'anulada')),
  forma_pago text,
  observaciones text,
  subtotal numeric(14,2) not null default 0,
  descuentos numeric(14,2) not null default 0,
  impuestos numeric(14,2) not null default 0,
  costos_adicionales numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  confirmado_por uuid,
  confirmado_en timestamptz
);
create index compras_proveedor_idx on public.compras (proveedor_id, fecha desc);
create index compras_estado_idx on public.compras (estado);

create table public.compra_lineas (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id) on delete cascade,
  variante_id uuid not null references public.variantes (id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  cantidad_recibida numeric(12,3) not null default 0,
  cantidad_devuelta numeric(12,3) not null default 0,
  costo_unitario numeric(14,4) not null check (costo_unitario >= 0),
  descuento numeric(14,2) not null default 0 check (descuento >= 0),
  impuesto_pct numeric(5,2) not null default 0 check (impuesto_pct >= 0),
  -- Costo por unidad con descuento, impuesto no descontable y su parte de los costos adicionales
  costo_neto_unitario numeric(14,4),
  unique (compra_id, variante_id),
  constraint compra_lineas_recibido_chk check (cantidad_recibida >= 0 and cantidad_recibida <= cantidad),
  constraint compra_lineas_devuelto_chk check (cantidad_devuelta >= 0 and cantidad_devuelta <= cantidad_recibida),
  constraint compra_lineas_descuento_chk check (descuento <= cantidad * costo_unitario)
);
create index compra_lineas_variante_idx on public.compra_lineas (variante_id);

create table public.compra_costos_adicionales (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id) on delete cascade,
  concepto text not null,
  valor numeric(14,2) not null check (valor > 0)
);

create table public.devoluciones_proveedor (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  compra_id uuid not null references public.compras (id),
  bodega_id uuid not null references public.bodegas (id),
  fecha date not null default ((now() at time zone 'America/Bogota')::date),
  motivo text not null check (length(btrim(motivo)) > 0),
  valor_total numeric(14,2) not null default 0,
  clave uuid unique,
  registrado_por uuid default auth.uid(),
  registrado_en timestamptz not null default now()
);

create table public.devolucion_proveedor_lineas (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references public.devoluciones_proveedor (id) on delete cascade,
  compra_linea_id uuid not null references public.compra_lineas (id),
  variante_id uuid not null references public.variantes (id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  costo_unitario numeric(14,4) not null check (costo_unitario >= 0)
);
