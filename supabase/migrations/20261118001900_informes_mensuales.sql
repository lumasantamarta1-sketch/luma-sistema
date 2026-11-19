-- =====================================================================
-- LUMA · 19 · Ventas por cliente en el informe, serie mensual para el panel
-- (ventas, utilidad, gastos, resultado y evolución del inventario mes a mes),
-- cuentas por cobrar y por pagar, compras y gastos por proveedor, categoría y usuario,
-- resumen por cliente e historial de ingresos y salidas de los usuarios
-- =====================================================================

create or replace function public.informe_ventas(p_desde date, p_hasta date, p_bodega uuid default null) returns jsonb
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
    select id, bodega_id, vendedor_id, cliente_id, subtotal, descuentos, total, entregada_en
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
    'por_cliente', coalesce((
      select jsonb_agg(jsonb_build_object('cliente', d.nombre, 'ventas', d.ventas, 'valor', d.valor) order by d.valor desc)
        from (select coalesce(c.nombre, 'Cliente mostrador') as nombre, count(*) as ventas, sum(v.total) as valor
                from v left join public.clientes c on c.id = v.cliente_id
               group by c.id, c.nombre
               order by sum(v.total) desc
               limit 100) d), '[]'::jsonb),
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

-- Mes a mes, con las mismas fórmulas del resumen financiero. Cada dato sale solo con su permiso:
-- costos.ver (costo, utilidad, valor del inventario), informes.financieros (gastos y resultado).
create function public.serie_mensual(p_meses int default 12) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bodegas uuid[];
  v_fin boolean := app.tiene_permiso('informes.financieros');
  v_ventas boolean := v_fin or app.tiene_permiso('informes.ver');
  v_costos boolean := app.tiene_permiso('costos.ver');
  v_inv boolean := app.tiene_permiso('inventario.ver') or app.tiene_permiso('informes.inventario');
  v_inicio date;
  v_actual date := date_trunc('month', now() at time zone 'America/Bogota')::date;
  v_r jsonb;
begin
  -- Quien solo ve el informe de inventario recibe únicamente la evolución de las existencias
  if not (v_ventas or app.tiene_permiso('informes.inventario')) then
    raise exception 'No tienes permiso para esta acción (informes.ver).' using errcode = '42501';
  end if;
  p_meses := least(greatest(coalesce(p_meses, 12), 1), 24);
  v_inicio := (v_actual - make_interval(months => p_meses - 1))::date;
  select array_agg(id) into v_bodegas from public.bodegas where app.puede_ver_bodega(id);
  v_bodegas := coalesce(v_bodegas, '{}');

  with meses as (
    select g::date as ini, (g + interval '1 month')::date as fin
      from generate_series(v_inicio::timestamp, v_actual::timestamp, interval '1 month') g
  ),
  calc as (
    select m.ini,
      (select count(*) from public.ventas v
        where v.estado = 'confirmada' and v.estado_entrega = 'entregada'
          and v.entregada_en >= app.desde_ts(m.ini) and v.entregada_en < app.desde_ts(m.fin) and v.bodega_id = any (v_bodegas)) as ventas,
      (select coalesce(sum(v.subtotal - v.descuentos - v.impuestos), 0) from public.ventas v
        where v.estado = 'confirmada' and v.estado_entrega = 'entregada'
          and v.entregada_en >= app.desde_ts(m.ini) and v.entregada_en < app.desde_ts(m.fin) and v.bodega_id = any (v_bodegas)) as netas,
      (select coalesce(sum(dl.valor - case when l.cantidad * l.precio_unitario - l.descuento > 0
                                           then round(dl.valor * l.impuesto / (l.cantidad * l.precio_unitario - l.descuento), 2)
                                           else 0 end), 0)
         from public.devoluciones_venta d
         join public.devolucion_venta_lineas dl on dl.devolucion_id = d.id
         join public.venta_lineas l on l.id = dl.venta_linea_id
        where d.registrado_en >= app.desde_ts(m.ini) and d.registrado_en < app.desde_ts(m.fin) and d.bodega_id = any (v_bodegas)) as devoluciones,
      (select coalesce(sum(-mi.cantidad * mi.costo_unitario), 0) from public.movimientos_inventario mi
        where mi.tipo in ('salida_venta', 'devolucion_cliente')
          and mi.ocurrido_en >= app.desde_ts(m.ini) and mi.ocurrido_en < app.desde_ts(m.fin) and mi.bodega_id = any (v_bodegas)) as cmv,
      (select coalesce(sum(g.valor), 0) from public.gastos g
         join public.categorias_gasto cg on cg.id = g.categoria_id and cg.tipo = 'operativo'
        where g.estado <> 'anulado' and g.fecha >= m.ini and g.fecha < m.fin
          and (g.bodega_id is null or g.bodega_id = any (v_bodegas))) as gastos,
      (select coalesce(sum(-mi.cantidad * mi.costo_unitario), 0) from public.movimientos_inventario mi
        where mi.tipo in ('perdida_estampado', 'perdida_devolucion', 'perdida', 'ajuste_salida', 'ajuste_entrada', 'reverso_perdida')
          and mi.ocurrido_en >= app.desde_ts(m.ini) and mi.ocurrido_en < app.desde_ts(m.fin) and mi.bodega_id = any (v_bodegas)) as perdidas,
      (select coalesce(sum(mi.cantidad * mi.costo_unitario), 0) from public.movimientos_inventario mi
        where mi.ocurrido_en < app.desde_ts(m.fin) and mi.bodega_id = any (v_bodegas)) as inventario_valor,
      (select coalesce(sum(mi.cantidad), 0) from public.movimientos_inventario mi
         join public.variantes va on va.id = mi.variante_id and va.clase in ('terminado', 'base')
        where mi.ocurrido_en < app.desde_ts(m.fin) and mi.bodega_id = any (v_bodegas)) as inventario_unidades
      from meses m
  )
  select jsonb_agg(jsonb_build_object(
           'mes', to_char(ini, 'YYYY-MM'),
           'ventas', case when v_ventas then ventas end,
           'ventas_netas', case when v_ventas then round(netas - devoluciones, 2) end,
           'costo', case when v_ventas and v_costos then round(cmv, 2) end,
           'utilidad_bruta', case when v_ventas and v_costos then round(netas - devoluciones - cmv, 2) end,
           'gastos', case when v_fin then round(gastos + case when v_costos then perdidas else 0 end, 2) end,
           'resultado', case when v_fin and v_costos then round(netas - devoluciones - cmv - gastos - perdidas, 2) end,
           'inventario_valor', case when v_costos then round(inventario_valor, 2) end,
           'inventario_unidades', case when v_inv then inventario_unidades end) order by ini)
    into v_r from calc;
  return coalesce(v_r, '[]'::jsonb);
end $$;

revoke execute on function public.serie_mensual(int) from public, anon;
grant execute on function public.serie_mensual(int) to authenticated;

-- ---------------------------------------------------------------------
-- Cuentas pendientes de hoy: lo que deben los clientes, lo que se debe a proveedores
-- y los gastos sin pagar. Cada lista sale solo con su permiso.
-- ---------------------------------------------------------------------
create function public.cuentas_pendientes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bodegas uuid[];
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_fin boolean := app.tiene_permiso('informes.financieros');
  v_cobrar boolean := v_fin or app.tiene_permiso('ventas.ver');
  v_compras boolean := v_fin or app.tiene_permiso('compras.ver');
  v_gastos boolean := v_fin or app.tiene_permiso('gastos.ver');
  v_r jsonb;
begin
  if not (v_cobrar or v_compras or v_gastos) then
    raise exception 'No tienes permiso para esta acción (informes.financieros).' using errcode = '42501';
  end if;
  select array_agg(id) into v_bodegas from public.bodegas where app.puede_ver_bodega(id);
  v_bodegas := coalesce(v_bodegas, '{}');

  select jsonb_build_object(
    'por_cobrar', case when v_cobrar then coalesce((
      select jsonb_agg(jsonb_build_object(
               'venta_id', d.id, 'numero', d.numero, 'fecha', d.fecha, 'cliente_id', d.cliente_id, 'cliente', d.cliente,
               'telefono', d.telefono, 'punto', d.punto, 'total', d.total, 'saldo', d.saldo, 'entregada', d.entregada,
               'dias', v_hoy - d.fecha) order by d.fecha, d.numero)
        from (select v.id, v.numero, (v.confirmada_en at time zone 'America/Bogota')::date as fecha, v.cliente_id,
                     coalesce(c.nombre, 'Cliente mostrador') as cliente, c.telefono, b.nombre as punto, v.total,
                     app.saldo_venta(v.id) as saldo, v.estado_entrega = 'entregada' as entregada
                from public.ventas v
                join public.bodegas b on b.id = v.bodega_id
                left join public.clientes c on c.id = v.cliente_id
               where v.estado = 'confirmada' and v.bodega_id = any (v_bodegas)) d
       where d.saldo > 0), '[]'::jsonb) end,
    'por_pagar', case when v_compras then coalesce((
      select jsonb_agg(jsonb_build_object(
               'compra_id', d.id, 'numero', d.numero, 'fecha', d.fecha, 'proveedor', d.proveedor, 'total', d.total,
               'saldo', d.saldo, 'dias', v_hoy - d.fecha) order by d.fecha, d.numero)
        from (select co.id, co.numero, co.fecha, p.nombre as proveedor, co.total, app.saldo_compra(co.id) as saldo
                from public.compras co
                join public.proveedores p on p.id = co.proveedor_id
               where co.estado in ('recibida_parcial', 'recibida') and co.bodega_id = any (v_bodegas)) d
       where d.saldo > 0), '[]'::jsonb) end,
    'gastos_por_pagar', case when v_gastos then coalesce((
      select jsonb_agg(jsonb_build_object(
               'gasto_id', g.id, 'numero', g.numero, 'fecha', g.fecha, 'descripcion', g.descripcion, 'categoria', cg.nombre,
               'proveedor', coalesce(p.nombre, nullif(btrim(g.beneficiario), '')), 'valor', g.valor, 'dias', v_hoy - g.fecha)
             order by g.fecha, g.numero)
        from public.gastos g
        join public.categorias_gasto cg on cg.id = g.categoria_id
        left join public.proveedores p on p.id = g.proveedor_id
       where g.estado = 'pendiente' and (g.bodega_id is null or g.bodega_id = any (v_bodegas))), '[]'::jsonb) end
  ) into v_r;
  return v_r;
end $$;

revoke execute on function public.cuentas_pendientes() from public, anon;
grant execute on function public.cuentas_pendientes() to authenticated;

-- ---------------------------------------------------------------------
-- Compras por proveedor y gastos por categoría, proveedor y usuario, comparados
-- con el periodo anterior de la misma duración. Solo con informes.financieros.
-- ---------------------------------------------------------------------
create function public.informe_compras_gastos(p_desde date, p_hasta date, p_bodega uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bodegas uuid[];
  v_ant_desde date;
  v_ant_hasta date;
  v_r jsonb;
begin
  perform app.exigir_permiso('informes.financieros');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Indica un periodo válido.';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'El periodo máximo es de un año.';
  end if;
  v_ant_hasta := p_desde - 1;
  v_ant_desde := p_desde - (p_hasta - p_desde + 1);
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
    v_bodegas := array[p_bodega];
  else
    select array_agg(id) into v_bodegas from public.bodegas where app.puede_ver_bodega(id);
  end if;
  v_bodegas := coalesce(v_bodegas, '{}');

  with c as (
    select co.id, co.proveedor_id, co.total, co.fecha, app.saldo_compra(co.id) as saldo
      from public.compras co
     where co.estado in ('confirmada', 'recibida_parcial', 'recibida')
       and co.fecha between v_ant_desde and p_hasta and co.bodega_id = any (v_bodegas)
  ),
  g as (
    select g.valor, g.categoria_id, g.proveedor_id, g.beneficiario, g.registrado_por, g.estado, g.fecha
      from public.gastos g
     where g.estado <> 'anulado' and g.fecha between v_ant_desde and p_hasta
       and (case when p_bodega is null then (g.bodega_id is null or g.bodega_id = any (v_bodegas))
                 else g.bodega_id = p_bodega end)
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'bodega_id', p_bodega,
                                  'anterior_desde', v_ant_desde, 'anterior_hasta', v_ant_hasta),
    'compras', jsonb_build_object(
      'cantidad', (select count(*) from c where fecha >= p_desde),
      'total', (select coalesce(sum(total), 0) from c where fecha >= p_desde),
      'saldo', (select coalesce(sum(greatest(saldo, 0)), 0) from c where fecha >= p_desde),
      'anterior', (select coalesce(sum(total), 0) from c where fecha <= v_ant_hasta)),
    'compras_por_proveedor', coalesce((
      select jsonb_agg(jsonb_build_object('proveedor', d.nombre, 'compras', d.compras, 'valor', d.valor, 'saldo', d.saldo,
                                          'anterior', d.anterior) order by d.valor desc, d.nombre)
        from (select p.nombre,
                     count(*) filter (where c.fecha >= p_desde) as compras,
                     coalesce(sum(c.total) filter (where c.fecha >= p_desde), 0) as valor,
                     coalesce(sum(greatest(c.saldo, 0)) filter (where c.fecha >= p_desde), 0) as saldo,
                     coalesce(sum(c.total) filter (where c.fecha <= v_ant_hasta), 0) as anterior
                from c join public.proveedores p on p.id = c.proveedor_id
               group by p.id, p.nombre) d
       where d.valor > 0 or d.anterior > 0), '[]'::jsonb),
    'gastos', jsonb_build_object(
      'cantidad', (select count(*) from g where fecha >= p_desde),
      'total', (select coalesce(sum(valor), 0) from g where fecha >= p_desde),
      'pendiente', (select coalesce(sum(valor), 0) from g where fecha >= p_desde and estado = 'pendiente'),
      'anterior', (select coalesce(sum(valor), 0) from g where fecha <= v_ant_hasta)),
    'gastos_por_categoria', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', d.nombre, 'tipo', d.tipo, 'valor', d.valor, 'anterior', d.anterior)
                       order by d.valor desc, d.nombre)
        from (select cg.nombre, cg.tipo,
                     coalesce(sum(g.valor) filter (where g.fecha >= p_desde), 0) as valor,
                     coalesce(sum(g.valor) filter (where g.fecha <= v_ant_hasta), 0) as anterior
                from g join public.categorias_gasto cg on cg.id = g.categoria_id
               group by cg.id, cg.nombre, cg.tipo) d
       where d.valor > 0 or d.anterior > 0), '[]'::jsonb),
    'gastos_por_proveedor', coalesce((
      select jsonb_agg(jsonb_build_object('proveedor', d.nombre, 'gastos', d.gastos, 'valor', d.valor) order by d.valor desc, d.nombre)
        from (select coalesce(p.nombre, nullif(btrim(g.beneficiario), ''), 'Sin proveedor') as nombre,
                     count(*) as gastos, sum(g.valor) as valor
                from g left join public.proveedores p on p.id = g.proveedor_id
               where g.fecha >= p_desde
               group by 1) d), '[]'::jsonb),
    'gastos_por_usuario', coalesce((
      select jsonb_agg(jsonb_build_object('usuario', d.nombre, 'gastos', d.gastos, 'valor', d.valor) order by d.valor desc, d.nombre)
        from (select coalesce(pe.nombre, 'Sin usuario') as nombre, count(*) as gastos, sum(g.valor) as valor
                from g left join public.perfiles pe on pe.id = g.registrado_por
               where g.fecha >= p_desde
               group by 1) d), '[]'::jsonb)
  ) into v_r;
  return v_r;
end $$;

revoke execute on function public.informe_compras_gastos(date, date, uuid) from public, anon;
grant execute on function public.informe_compras_gastos(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Por cliente: cuántas ventas, cuánto ha comprado (sin lo devuelto), cuánto debe y su última compra.
-- Se ve lo mismo que en la lista de ventas: todas las ventas de los puntos propios, o solo las propias.
-- ---------------------------------------------------------------------
create function public.resumen_clientes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_todas boolean := app.tiene_permiso('ventas.ver');
  v_r jsonb;
begin
  if not (v_todas or app.tiene_permiso('ventas.ver_propias')) then
    raise exception 'No tienes permiso para esta acción (ventas.ver).' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', d.cliente_id, 'ventas', d.ventas, 'comprado', d.comprado, 'saldo', d.saldo, 'ultima', d.ultima)), '[]'::jsonb)
    into v_r
    from (select v.cliente_id, count(*) as ventas,
                 round(sum(v.total - coalesce((select sum(dv.valor_total) from public.devoluciones_venta dv where dv.venta_id = v.id), 0)), 2) as comprado,
                 round(sum(greatest(app.saldo_venta(v.id), 0)), 2) as saldo,
                 max((v.confirmada_en at time zone 'America/Bogota')::date) as ultima
            from public.ventas v
           where v.estado = 'confirmada' and v.cliente_id is not null
             and app.puede_ver_bodega(v.bodega_id)
             and (v_todas or v.vendedor_id = auth.uid())
           group by v.cliente_id) d;
  return v_r;
end $$;

revoke execute on function public.resumen_clientes() from public, anon;
grant execute on function public.resumen_clientes() to authenticated;

-- ---------------------------------------------------------------------
-- Historial de usuarios: cada ingreso y salida queda en la auditoría
-- ---------------------------------------------------------------------
create function public.registrar_sesion(p_evento text, p_motivo text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_evento not in ('ingreso', 'salida') then
    return;
  end if;
  insert into public.auditoria (usuario_id, accion, tabla, registro_id, valor_nuevo)
  values (auth.uid(), p_evento, 'sesiones', auth.uid()::text,
          case when p_motivo is not null then jsonb_build_object('motivo', left(p_motivo, 60)) end);
end $$;

revoke execute on function public.registrar_sesion(text, text) from public, anon;
grant execute on function public.registrar_sesion(text, text) to authenticated;
