-- =====================================================================
-- LUMA · 06 · Estampado: recetas por diseño y órdenes de estampado
-- =====================================================================

-- Receta: material que gasta una camiseta de un diseño. talla_id nula = todas las tallas.
create table public.diseno_materiales (
  id uuid primary key default gen_random_uuid(),
  diseno_id uuid not null references public.disenos (id) on delete cascade,
  material_id uuid not null references public.variantes (id),
  talla_id uuid references public.tallas (id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  constraint diseno_materiales_uk unique nulls not distinct (diseno_id, material_id, talla_id)
);

create function app.diseno_materiales_validar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.variantes where id = new.material_id and clase = 'material') then
    raise exception 'La receta solo admite variantes de clase material.';
  end if;
  return new;
end $$;

create trigger diseno_materiales_validar
  before insert or update on public.diseno_materiales
  for each row execute function app.diseno_materiales_validar();

-- Orden de estampado: en borrador planea; al terminar mueve el inventario en una sola transacción
create table public.ordenes_estampado (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  bodega_id uuid not null references public.bodegas (id),
  venta_id uuid references public.ventas (id),
  estado text not null default 'borrador' check (estado in ('borrador', 'terminada', 'anulada')),
  costos_adicionales numeric(14,2) not null default 0 check (costos_adicionales >= 0),
  observaciones text,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  terminado_por uuid,
  terminado_en timestamptz
);
create index ordenes_estampado_estado_idx on public.ordenes_estampado (estado, bodega_id);
create index ordenes_estampado_venta_idx on public.ordenes_estampado (venta_id);

create table public.orden_estampado_lineas (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_estampado (id) on delete cascade,
  variante_id uuid not null references public.variantes (id),
  cantidad_planeada numeric(12,3) not null check (cantidad_planeada > 0),
  cantidad_buenas numeric(12,3),
  cantidad_danadas numeric(12,3),
  venta_linea_id uuid references public.venta_lineas (id),
  constraint orden_lineas_resultado_chk check (
    (cantidad_buenas is null and cantidad_danadas is null)
    or (cantidad_buenas >= 0 and cantidad_danadas >= 0 and cantidad_buenas + cantidad_danadas > 0))
);
create index orden_lineas_orden_idx on public.orden_estampado_lineas (orden_id);
create index orden_lineas_venta_linea_idx on public.orden_estampado_lineas (venta_linea_id)
  where venta_linea_id is not null;

-- Consumo de cada línea: la camiseta base y los materiales. Las cantidades no llevan costo;
-- el costo queda en el kardex, que es restringido.
create table public.orden_estampado_consumos (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null references public.orden_estampado_lineas (id) on delete cascade,
  variante_id uuid not null references public.variantes (id),
  cantidad_teorica numeric(12,3) not null check (cantidad_teorica >= 0),
  cantidad_real numeric(12,3) check (cantidad_real is null or cantidad_real >= 0),
  unique (linea_id, variante_id)
);

-- Descuentos y órdenes que dependen de ventas
create index descuentos_venta_idx on public.descuentos_autorizados (venta_id);
