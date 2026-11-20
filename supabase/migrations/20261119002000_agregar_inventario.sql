-- =====================================================================
-- LUMA · 20 · Agregar inventario en un paso, sin duplicar
-- La pantalla «Agregar inventario» registra, en una sola transacción:
--   · lo que ya se tenía (saldo inicial, con su costo), o
--   · lo que se compró: compra confirmada y recibida, y su pago si ya se hizo.
-- Cada operación lleva una clave: si llega dos veces (doble toque o reintento),
-- se devuelve el documento ya registrado en vez de crear otro.
-- =====================================================================

create table app.operaciones_unicas (
  clave uuid primary key,
  tipo text not null check (tipo in ('ajuste', 'compra')),
  documento_id uuid not null,
  usuario_id uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
revoke all on app.operaciones_unicas from public, anon, authenticated;

-- p_datos: el mismo formato de solicitar_ajuste
create function public.entrada_inventario(p_datos jsonb, p_clave uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_clave is null then
    raise exception 'Falta la clave de la operación.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
  select documento_id into v_id from app.operaciones_unicas where clave = p_clave and tipo = 'ajuste';
  if v_id is not null then
    return v_id;
  end if;
  v_id := public.solicitar_ajuste(p_datos);
  insert into app.operaciones_unicas (clave, tipo, documento_id) values (p_clave, 'ajuste', v_id);
  return v_id;
end $$;

-- p_datos: el mismo formato de guardar_compra. p_pago: {cuenta_id, referencia} si ya se pagó todo.
create function public.compra_recibida(p_datos jsonb, p_clave uuid, p_pago jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_total numeric;
begin
  if p_clave is null then
    raise exception 'Falta la clave de la operación.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
  select documento_id into v_id from app.operaciones_unicas where clave = p_clave and tipo = 'compra';
  if v_id is not null then
    return v_id;
  end if;
  v_id := public.guardar_compra(null, p_datos);
  perform public.confirmar_compra(v_id, true, p_clave);
  if p_pago is not null then
    select total into v_total from public.compras where id = v_id;
    if v_total > 0 then
      perform public.registrar_pago_compra(v_id, nullif(p_pago ->> 'cuenta_id', '')::uuid, v_total,
                                           nullif(btrim(coalesce(p_pago ->> 'referencia', '')), ''),
                                           md5(p_clave::text || ':pago')::uuid, 'pago');
    end if;
  end if;
  insert into app.operaciones_unicas (clave, tipo, documento_id) values (p_clave, 'compra', v_id);
  return v_id;
end $$;

revoke execute on function public.entrada_inventario(jsonb, uuid) from public, anon;
grant execute on function public.entrada_inventario(jsonb, uuid) to authenticated;
revoke execute on function public.compra_recibida(jsonb, uuid, jsonb) from public, anon;
grant execute on function public.compra_recibida(jsonb, uuid, jsonb) to authenticated;
