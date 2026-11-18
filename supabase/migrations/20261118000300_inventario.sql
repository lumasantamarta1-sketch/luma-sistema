-- =====================================================================
-- LUMA · 03 · Inventario: puntos de venta, existencias, kardex, ajustes y traslados
-- =====================================================================

-- Cada bodega es un punto de venta, el taller de estampado o un depósito
create table public.bodegas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null unique,
  tipo text not null default 'punto_venta' check (tipo in ('punto_venta', 'taller', 'bodega')),
  direccion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.usuario_bodegas (
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  bodega_id uuid not null references public.bodegas (id),
  primary key (usuario_id, bodega_id)
);
create index usuario_bodegas_bodega_idx on public.usuario_bodegas (bodega_id);

create function app.puede_ver_bodega(p_bodega uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.tiene_permiso('bodegas.todas')
      or exists (select 1
                   from public.usuario_bodegas ub
                   join public.perfiles p on p.id = ub.usuario_id and p.activo
                  where ub.usuario_id = auth.uid() and ub.bodega_id = p_bodega)
$$;

-- Existencias por variante y bodega. "apartada" son unidades reservadas por ventas confirmadas.
create table public.existencias (
  variante_id uuid not null references public.variantes (id),
  bodega_id uuid not null references public.bodegas (id),
  cantidad numeric(12,3) not null default 0,
  apartada numeric(12,3) not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (variante_id, bodega_id),
  constraint existencias_validas_chk check (cantidad >= 0 and apartada >= 0 and apartada <= cantidad)
);
create index existencias_bodega_idx on public.existencias (bodega_id);

-- Kardex: libro único de entradas y salidas. No se modifica ni se borra.
create table public.movimientos_inventario (
  id bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  variante_id uuid not null references public.variantes (id),
  bodega_id uuid not null references public.bodegas (id),
  tipo text not null check (tipo in (
    'saldo_inicial', 'entrada_compra', 'devolucion_proveedor',
    'consumo_estampado', 'entrada_estampado', 'perdida_estampado',
    'salida_venta', 'devolucion_cliente', 'perdida_devolucion',
    'ajuste_entrada', 'ajuste_salida', 'perdida',
    'traslado_salida', 'traslado_entrada',
    'reverso_consumo', 'reverso_perdida', 'reverso_entrada')),
  cantidad numeric(12,3) not null check (cantidad <> 0),
  costo_unitario numeric(14,4) not null check (costo_unitario >= 0),
  saldo_resultante numeric(12,3) not null,
  costo_promedio_resultante numeric(14,4) not null,
  motivo text,
  documento_tipo text not null,
  documento_id uuid not null,
  linea_id uuid,
  usuario_id uuid default auth.uid(),
  constraint movimientos_signo_chk check (
    (tipo in ('saldo_inicial', 'entrada_compra', 'entrada_estampado', 'devolucion_cliente',
              'ajuste_entrada', 'traslado_entrada', 'reverso_consumo', 'reverso_perdida') and cantidad > 0)
    or
    (tipo in ('devolucion_proveedor', 'consumo_estampado', 'perdida_estampado', 'salida_venta',
              'perdida_devolucion', 'ajuste_salida', 'perdida', 'traslado_salida', 'reverso_entrada')
     and cantidad < 0))
);
-- Una línea de un documento no puede mover dos veces el mismo tipo: evita descuentos duplicados
create unique index movimientos_linea_uk
  on public.movimientos_inventario (documento_tipo, linea_id, tipo, variante_id)
  where linea_id is not null;
create index movimientos_variante_idx on public.movimientos_inventario (variante_id, bodega_id, ocurrido_en);
create index movimientos_documento_idx on public.movimientos_inventario (documento_tipo, documento_id);
create index movimientos_fecha_idx on public.movimientos_inventario (ocurrido_en);

create trigger movimientos_inventario_inmutable
  before update or delete on public.movimientos_inventario
  for each row execute function app.bloquear_cambios();

-- Ajustes, pérdidas y saldo inicial: se aprueban antes de mover el inventario
create table public.ajustes_inventario (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  bodega_id uuid not null references public.bodegas (id),
  tipo text not null check (tipo in ('ajuste', 'perdida', 'saldo_inicial')),
  motivo text not null check (length(btrim(motivo)) > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  valor_estimado numeric(14,2) not null default 0,
  solicitado_por uuid not null default auth.uid(),
  solicitado_en timestamptz not null default now(),
  resuelto_por uuid,
  resuelto_en timestamptz,
  observacion text
);
create index ajustes_bodega_idx on public.ajustes_inventario (bodega_id, estado);

create table public.ajuste_lineas (
  id uuid primary key default gen_random_uuid(),
  ajuste_id uuid not null references public.ajustes_inventario (id) on delete cascade,
  variante_id uuid not null references public.variantes (id),
  cantidad numeric(12,3) not null check (cantidad <> 0),
  costo_unitario numeric(14,4) check (costo_unitario is null or costo_unitario >= 0),
  unique (ajuste_id, variante_id)
);

-- Traslados entre puntos: salen del origen al enviarse y entran al destino al recibirse
create table public.traslados (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  origen_id uuid not null references public.bodegas (id),
  destino_id uuid not null references public.bodegas (id),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviado', 'recibido', 'anulado')),
  observaciones text,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  enviado_por uuid,
  enviado_en timestamptz,
  recibido_por uuid,
  recibido_en timestamptz,
  constraint traslados_distintos_chk check (origen_id <> destino_id)
);
create index traslados_estado_idx on public.traslados (estado);

create table public.traslado_lineas (
  id uuid primary key default gen_random_uuid(),
  traslado_id uuid not null references public.traslados (id) on delete cascade,
  variante_id uuid not null references public.variantes (id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  unique (traslado_id, variante_id)
);
create index traslado_lineas_variante_idx on public.traslado_lineas (variante_id);
