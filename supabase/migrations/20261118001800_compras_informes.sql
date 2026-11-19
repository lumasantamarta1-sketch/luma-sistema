-- =====================================================================
-- LUMA · 18 · Compras por recibir (sin costos) e informe de ventas
-- =====================================================================

-- Compras con mercancía pendiente, para quien recibe sin ver costos
create function public.compras_por_recibir(p_bodega uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.tiene_permiso('compras.recibir') or app.tiene_permiso('compras.gestionar')) then
    raise exception 'No tienes permiso para esta acción (compras.recibir).' using errcode = '42501';
  end if;
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'compra_id', c.id, 'numero', c.numero, 'fecha', c.fecha, 'estado', c.estado,
             'proveedor', pr.nombre, 'bodega', b.nombre,
             'unidades_pendientes', (select coalesce(sum(l.cantidad - l.cantidad_recibida), 0)
                                       from public.compra_lineas l where l.compra_id = c.id),
             'productos_pendientes', (select count(*) from public.compra_lineas l
                                       where l.compra_id = c.id and l.cantidad > l.cantidad_recibida))
           order by c.fecha, c.numero)
      from public.compras c
      join public.proveedores pr on pr.id = c.proveedor_id
      join public.bodegas b on b.id = c.bodega_id
     where c.estado in ('confirmada', 'recibida_parcial')
       and (p_bodega is null or c.bodega_id = p_bodega)
       and app.puede_ver_bodega(c.bodega_id)), '[]'::jsonb);
end $$;

-- Ventas entregadas en el periodo: totales, por día, producto, vendedor y punto, y el dinero
-- recibido por medio de pago. Solo con permiso de costos agrega costo y utilidad bruta.
create function public.informe_ventas(p_desde date, p_hasta date, p_bodega uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := app.desde_ts(p_desde);
  v_hasta timestamptz := app.hasta_ts(p_hasta);
  v_bodegas uuid[];
  v_costos boolean := app.tiene_permiso('costos.ver');
  v_r jsonb;
begin
  perform app.exigir_permiso('informes.ver');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Indica un periodo válido.';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'El periodo máximo es de un año.';
  end if;
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
    v_bodegas := array[p_bodega];
  else
    select array_agg(id) into v_bodegas from public.bodegas where app.puede_ver_bodega(id);
  end if;
  v_bodegas := coalesce(v_bodegas, '{}');

  with v as (
    select id, bodega_id, vendedor_id, subtotal, descuentos, total, entregada_en
      from public.ventas
     where estado = 'confirmada' and estado_entrega = 'entregada'
       and entregada_en >= v_desde and entregada_en < v_hasta and bodega_id = any (v_bodegas)
  ),
  l as (
    select l.variante_id, l.cantidad, l.cantidad * l.precio_unitario - l.descuento as neto,
           coalesce(c.costo_unitario, 0) * l.cantidad as costo
      from public.venta_lineas l
      join v on v.id = l.venta_id
      left join public.venta_linea_costos c on c.venta_linea_id = l.id
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'bodega_id', p_bodega),
    'con_costos', v_costos,
    'totales', jsonb_build_object(
      'ventas', (select count(*) from v),
      'unidades', (select coalesce(sum(cantidad), 0) from l),
      'bruto', (select coalesce(sum(subtotal), 0) from v),
      'descuentos', (select coalesce(sum(descuentos), 0) from v),
      'valor', (select coalesce(sum(total), 0) from v),
      'costo', case when v_costos then (select round(coalesce(sum(costo), 0), 2) from l) end,
      'devoluciones', (select coalesce(sum(d.valor_total), 0) from public.devoluciones_venta d
                        where d.registrado_en >= v_desde and d.registrado_en < v_hasta and d.bodega_id = any (v_bodegas))),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', d.fecha, 'ventas', d.ventas, 'valor', d.valor) order by d.fecha)
        from (select (entregada_en at time zone 'America/Bogota')::date as fecha, count(*) as ventas, sum(total) as valor
                from v group by 1) d), '[]'::jsonb),
    'por_producto', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto', d.producto, 'sku', d.sku, 'detalle', d.detalle, 'unidades', d.unidades, 'valor', d.valor,
               'costo', case when v_costos then d.costo end,
               'utilidad', case when v_costos then d.valor - d.costo end) order by d.valor desc, d.sku)
        from (select p.nombre as producto, va.sku, concat_ws(' · ', ta.nombre, co.nombre) as detalle,
                     sum(l.cantidad) as unidades, sum(l.neto) as valor, round(sum(l.costo), 2) as costo
                from l
                join public.variantes va on va.id = l.variante_id
                join public.productos p on p.id = va.producto_id
                left join public.tallas ta on ta.id = va.talla_id
                left join public.colores co on co.id = va.color_id
               group by p.nombre, va.sku, ta.nombre, co.nombre) d), '[]'::jsonb),
    'por_vendedor', coalesce((
      select jsonb_agg(jsonb_build_object('vendedor', d.nombre, 'ventas', d.ventas, 'valor', d.valor) order by d.valor desc)
        from (select coalesce(pe.nombre, 'Sin nombre') as nombre, count(*) as ventas, sum(v.total) as valor
                from v left join public.perfiles pe on pe.id = v.vendedor_id
               group by pe.nombre) d), '[]'::jsonb),
    'por_punto', coalesce((
      select jsonb_agg(jsonb_build_object('punto', d.nombre, 'ventas', d.ventas, 'valor', d.valor) order by d.valor desc)
        from (select b.nombre, count(*) as ventas, sum(v.total) as valor
                from v join public.bodegas b on b.id = v.bodega_id
               group by b.nombre) d), '[]'::jsonb),
    'recibido_por_metodo', coalesce((
      select jsonb_agg(jsonb_build_object('metodo', d.nombre, 'valor', d.valor) order by d.valor desc)
        from (select m.nombre, sum(case when p.tipo = 'pago' then p.valor else -p.valor end) as valor
                from public.pagos_venta p
                join public.ventas x on x.id = p.venta_id
                join public.metodos_pago m on m.id = p.metodo_pago_id
               where p.fecha >= v_desde and p.fecha < v_hasta and x.bodega_id = any (v_bodegas)
               group by m.nombre) d), '[]'::jsonb))
    into v_r;
  return v_r;
end $$;

revoke execute on function public.compras_por_recibir(uuid), public.informe_ventas(date, date, uuid) from public, anon;
grant execute on function public.compras_por_recibir(uuid), public.informe_ventas(date, date, uuid) to authenticated;
