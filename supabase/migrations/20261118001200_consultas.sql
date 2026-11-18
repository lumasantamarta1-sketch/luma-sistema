-- =====================================================================
-- LUMA · 12 · Consultas e indicadores
-- Las funciones verifican el permiso y omiten los costos a quien no puede verlos.
-- =====================================================================

-- Rango de fechas de Colombia convertido a instantes
create function app.desde_ts(p_desde date) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p_desde::timestamp at time zone 'America/Bogota')
$$;

create function app.hasta_ts(p_hasta date) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((p_hasta + 1)::timestamp at time zone 'America/Bogota')
$$;

-- Punto al que pertenece un movimiento de caja (para ver el flujo por punto)
create function app.bodega_movimiento_caja(p_documento_tipo text, p_documento_id uuid, p_cuenta uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select bodega_id from public.cuentas_dinero where id = p_cuenta),
    case p_documento_tipo
      when 'pago_venta' then (select v.bodega_id from public.pagos_venta p join public.ventas v on v.id = p.venta_id
                               where p.id = p_documento_id)
      when 'pago_compra' then (select c.bodega_id from public.pagos_compra p join public.compras c on c.id = p.compra_id
                                where p.id = p_documento_id)
      when 'gasto' then (select bodega_id from public.gastos where id = p_documento_id)
    end)
$$;

-- ---------------------------------------------------------------------
-- Sesión
-- ---------------------------------------------------------------------
create function public.mis_permisos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'usuario_id', p.id,
    'nombre', p.nombre,
    'correo', p.correo,
    'activo', p.activo,
    'debe_cambiar_clave', p.debe_cambiar_clave,
    'rol', r.codigo,
    'rol_nombre', r.nombre,
    'es_administrador', app.es_administrador(),
    'permisos', coalesce((select jsonb_agg(rp.permiso_codigo order by rp.permiso_codigo)
                            from public.rol_permisos rp
                           where rp.rol_id = r.id and r.activo and p.activo), '[]'::jsonb),
    'bodegas', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre, 'tipo', b.tipo)
                                          order by b.nombre)
                           from public.bodegas b
                          where b.activo and p.activo and app.puede_ver_bodega(b.id)), '[]'::jsonb))
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
   where p.id = auth.uid()
$$;

-- Nombres de usuarios para mostrar quién registró cada cosa (también los inactivos)
create function public.usuarios_nombres() returns table (id uuid, nombre text, activo boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.usuario_activo() then
    return;
  end if;
  return query select p.id, p.nombre, p.activo from public.perfiles p order by p.nombre;
end $$;

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------

-- Existencias con lo disponible. Vista con los permisos de quien consulta.
create view public.existencias_detalle with (security_invoker = true) as
select e.variante_id,
       e.bodega_id,
       b.nombre as bodega,
       va.sku,
       p.id as producto_id,
       p.nombre as producto,
       p.clase,
       p.unidad_medida,
       t.nombre as talla,
       co.nombre as color,
       ti.nombre as tipo,
       d.nombre as diseno,
       e.cantidad,
       e.apartada,
       e.cantidad - e.apartada as disponible,
       va.stock_minimo,
       va.precio_venta,
       va.activo
  from public.existencias e
  join public.variantes va on va.id = e.variante_id
  join public.productos p on p.id = va.producto_id
  join public.bodegas b on b.id = e.bodega_id
  left join public.tallas t on t.id = va.talla_id
  left join public.colores co on co.id = va.color_id
  left join public.tipos_camiseta ti on ti.id = va.tipo_id
  left join public.disenos d on d.id = va.diseno_id;

-- Kardex. Sin permiso de costos, las columnas de costo llegan vacías.
create function public.kardex(
  p_variante uuid default null, p_bodega uuid default null, p_desde date default null, p_hasta date default null,
  p_limite integer default 200, p_desplazamiento integer default 0
) returns table (
  id bigint, ocurrido_en timestamptz, variante_id uuid, sku text, bodega_id uuid, bodega text,
  tipo text, cantidad numeric, saldo_resultante numeric, costo_unitario numeric, costo_promedio_resultante numeric,
  motivo text, documento_tipo text, documento_id uuid, usuario_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_costos boolean := app.tiene_permiso('costos.ver');
begin
  perform app.exigir_permiso('inventario.kardex');
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
  end if;
  return query
    select m.id, m.ocurrido_en, m.variante_id, va.sku, m.bodega_id, b.nombre, m.tipo, m.cantidad, m.saldo_resultante,
           case when v_costos then m.costo_unitario end,
           case when v_costos then m.costo_promedio_resultante end,
           m.motivo, m.documento_tipo, m.documento_id, m.usuario_id
      from public.movimientos_inventario m
      join public.variantes va on va.id = m.variante_id
      join public.bodegas b on b.id = m.bodega_id
     where (p_variante is null or m.variante_id = p_variante)
       and (p_bodega is null or m.bodega_id = p_bodega)
       and app.puede_ver_bodega(m.bodega_id)
       and (p_desde is null or m.ocurrido_en >= app.desde_ts(p_desde))
       and (p_hasta is null or m.ocurrido_en < app.hasta_ts(p_hasta))
     order by m.ocurrido_en desc, m.id desc
     limit least(greatest(coalesce(p_limite, 200), 1), 1000)
    offset greatest(coalesce(p_desplazamiento, 0), 0);
end $$;

-- Alertas: agotado, bajo el mínimo y pocas unidades, por punto
create function public.alertas_inventario(p_bodega uuid default null)
returns table (variante_id uuid, sku text, producto text, clase text, bodega_id uuid, bodega text,
               cantidad numeric, disponible numeric, stock_minimo numeric, alerta text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pocas numeric;
begin
  perform app.exigir_permiso('inventario.ver');
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
  end if;
  select umbral_pocas_unidades into v_pocas from public.configuracion_negocio where id = 1;
  return query
    select va.id, va.sku, p.nombre, p.clase, b.id, b.nombre,
           coalesce(e.cantidad, 0), coalesce(e.cantidad - e.apartada, 0), va.stock_minimo,
           case when coalesce(e.cantidad, 0) = 0 then 'agotado'
                when coalesce(e.cantidad, 0) < va.stock_minimo then 'bajo_minimo'
                else 'pocas_unidades' end
      from public.variantes va
      join public.productos p on p.id = va.producto_id and p.activo and not p.por_pedido
      cross join public.bodegas b
      left join public.existencias e on e.variante_id = va.id and e.bodega_id = b.id
     where va.activo and b.activo
       and (p_bodega is null or b.id = p_bodega)
       and app.puede_ver_bodega(b.id)
       and (coalesce(e.cantidad, 0) = 0 and (va.stock_minimo > 0 or e.variante_id is not null)
            or coalesce(e.cantidad, 0) < va.stock_minimo
            or (p.clase = 'terminado' and coalesce(e.cantidad, 0) > 0 and coalesce(e.cantidad, 0) <= v_pocas))
     order by 10, p.nombre, va.sku, b.nombre;
end $$;

-- Pedidos por preparar, sin valores. Señala qué líneas pendientes ya se pueden apartar.
create function public.pedidos_por_preparar(p_bodega uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_solo_propias boolean := app.tiene_permiso('ventas.ver_propias') and not app.tiene_permiso('ventas.ver');
begin
  if not (app.tiene_permiso('ventas.entregar') or app.tiene_permiso('ventas.crear')) then
    raise exception 'No tienes permiso para esta acción (ventas.entregar).' using errcode = '42501';
  end if;
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'venta_id', v.id, 'numero', v.numero, 'confirmada_en', v.confirmada_en,
             'bodega_id', v.bodega_id, 'bodega', b.nombre, 'cliente', coalesce(c.nombre, 'Cliente mostrador'),
             'estado_entrega', v.estado_entrega, 'observaciones', v.observaciones,
             'lineas', (select jsonb_agg(jsonb_build_object(
                                 'venta_linea_id', l.id, 'sku', va.sku, 'producto', p.nombre,
                                 'talla', t.nombre, 'color', co.nombre, 'cantidad', l.cantidad,
                                 'apartada', l.cantidad_apartada, 'estado', l.estado,
                                 'personalizacion', l.personalizacion,
                                 'se_puede_apartar', l.estado = 'pendiente' and not p.por_pedido
                                    and coalesce((select e.cantidad - e.apartada from public.existencias e
                                                   where e.variante_id = l.variante_id and e.bodega_id = v.bodega_id), 0)
                                        >= l.cantidad - l.cantidad_apartada)
                               order by p.nombre, va.sku)
                          from public.venta_lineas l
                          join public.variantes va on va.id = l.variante_id
                          join public.productos p on p.id = va.producto_id
                          left join public.tallas t on t.id = va.talla_id
                          left join public.colores co on co.id = va.color_id
                         where l.venta_id = v.id))
           order by v.confirmada_en)
      from public.ventas v
      join public.bodegas b on b.id = v.bodega_id
      left join public.clientes c on c.id = v.cliente_id
     where v.estado = 'confirmada' and v.estado_entrega <> 'entregada'
       and (p_bodega is null or v.bodega_id = p_bodega)
       and app.puede_ver_bodega(v.bodega_id)
       and (not v_solo_propias or v.vendedor_id = auth.uid())), '[]'::jsonb);
end $$;

-- Compra para recibir, sin costos
create function public.compra_para_recibir(p_compra uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r jsonb;
  v_bodega uuid;
begin
  if not (app.tiene_permiso('compras.recibir') or app.tiene_permiso('compras.gestionar')) then
    raise exception 'No tienes permiso para esta acción (compras.recibir).' using errcode = '42501';
  end if;
  select bodega_id into v_bodega from public.compras where id = p_compra;
  if v_bodega is null then
    raise exception 'La compra no existe.';
  end if;
  perform app.exigir_bodega(v_bodega);
  select jsonb_build_object(
           'compra_id', c.id, 'numero', c.numero, 'fecha', c.fecha, 'estado', c.estado,
           'proveedor', pr.nombre, 'bodega', b.nombre,
           'lineas', (select jsonb_agg(jsonb_build_object(
                               'compra_linea_id', l.id, 'variante_id', l.variante_id, 'sku', va.sku,
                               'producto', p.nombre, 'cantidad', l.cantidad, 'recibida', l.cantidad_recibida,
                               'pendiente', l.cantidad - l.cantidad_recibida) order by p.nombre, va.sku)
                        from public.compra_lineas l
                        join public.variantes va on va.id = l.variante_id
                        join public.productos p on p.id = va.producto_id
                       where l.compra_id = c.id))
    into v_r
    from public.compras c
    join public.proveedores pr on pr.id = c.proveedor_id
    join public.bodegas b on b.id = c.bodega_id
   where c.id = p_compra;
  return v_r;
end $$;

-- Costo estimado de una camiseta terminada con los costos promedio del momento
create function public.costo_estimado(p_variante uuid) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total numeric;
begin
  perform app.exigir_permiso('costos.ver');
  select round(sum(c.cantidad * coalesce(vc.costo_promedio, 0)), 2) into v_total
    from app.consumos_teoricos(p_variante, 1) c
    left join public.variante_costos vc on vc.variante_id = c.variante_id;
  return v_total;
end $$;

-- Valores restringidos de ajustes y órdenes de estampado (no se leen desde la tabla)
create function public.detalle_costos(p_documento_tipo text, p_documento_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bodega uuid;
begin
  perform app.exigir_permiso('costos.ver');
  if p_documento_tipo = 'ajuste' then
    select bodega_id into v_bodega from public.ajustes_inventario where id = p_documento_id;
    perform app.exigir_bodega(v_bodega);
    return (select jsonb_build_object(
              'valor_estimado', a.valor_estimado,
              'lineas', (select jsonb_agg(jsonb_build_object('ajuste_linea_id', l.id, 'costo_unitario', l.costo_unitario))
                           from public.ajuste_lineas l where l.ajuste_id = a.id))
              from public.ajustes_inventario a where a.id = p_documento_id);
  elsif p_documento_tipo = 'estampado' then
    select bodega_id into v_bodega from public.ordenes_estampado where id = p_documento_id;
    perform app.exigir_bodega(v_bodega);
    return (select jsonb_build_object(
              'costos_adicionales', o.costos_adicionales,
              'lineas', (select jsonb_agg(jsonb_build_object(
                                  'linea_id', l.id,
                                  'costo_unitario', (select m.costo_unitario from public.movimientos_inventario m
                                                      where m.documento_tipo = 'estampado' and m.linea_id = l.id
                                                        and m.tipo = 'entrada_estampado')))
                           from public.orden_estampado_lineas l where l.orden_id = o.id))
              from public.ordenes_estampado o where o.id = p_documento_id);
  end if;
  raise exception 'Tipo de documento no válido.';
end $$;

-- ---------------------------------------------------------------------
-- Dinero
-- ---------------------------------------------------------------------
create function public.saldos_cuentas()
returns table (cuenta_id uuid, nombre text, tipo text, bodega_id uuid, saldo numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_permiso('caja.ver');
  return query
    select c.id, c.nombre, c.tipo, c.bodega_id, app.saldo_cuenta(c.id)
      from public.cuentas_dinero c
     where c.activo and (c.bodega_id is null or app.puede_ver_bodega(c.bodega_id))
     order by c.tipo, c.nombre;
end $$;

-- ---------------------------------------------------------------------
-- Indicadores financieros (sección 9 de la propuesta). Calculado vs. dinero real.
-- p_bodega nulo: todo el negocio (o los puntos asignados, si no los ve todos).
-- ---------------------------------------------------------------------
create function public.resumen_financiero(p_desde date, p_hasta date, p_bodega uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := app.desde_ts(p_desde);
  v_hasta timestamptz := app.hasta_ts(p_hasta);
  v_bodegas uuid[];
  v_brutas numeric; v_descuentos numeric; v_impuestos numeric;
  v_devol numeric; v_devol_imp numeric;
  v_netas numeric; v_cmv numeric; v_utilidad numeric;
  v_gastos numeric; v_perdidas numeric; v_gastos_op numeric;
  v_entradas numeric; v_salidas numeric; v_aportes numeric; v_retiros numeric;
  v_compras numeric;
  v_cxc numeric; v_anticipos numeric; v_cxp_compras numeric; v_cxp_gastos numeric;
  v_inventario jsonb;
begin
  perform app.exigir_permiso('informes.financieros');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Indica un periodo válido.';
  end if;
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
    v_bodegas := array[p_bodega];
  else
    select array_agg(id) into v_bodegas from public.bodegas where app.puede_ver_bodega(id);
  end if;
  v_bodegas := coalesce(v_bodegas, '{}');

  -- Ventas entregadas en el periodo
  select coalesce(sum(subtotal), 0), coalesce(sum(descuentos), 0), coalesce(sum(impuestos), 0)
    into v_brutas, v_descuentos, v_impuestos
    from public.ventas
   where estado = 'confirmada' and estado_entrega = 'entregada'
     and entregada_en >= v_desde and entregada_en < v_hasta and bodega_id = any (v_bodegas);

  -- Devoluciones del periodo, sin su impuesto
  select coalesce(sum(dl.valor), 0),
         coalesce(sum(case when l.cantidad * l.precio_unitario - l.descuento > 0
                           then round(dl.valor * l.impuesto / (l.cantidad * l.precio_unitario - l.descuento), 2)
                           else 0 end), 0)
    into v_devol, v_devol_imp
    from public.devoluciones_venta d
    join public.devolucion_venta_lineas dl on dl.devolucion_id = d.id
    join public.venta_lineas l on l.id = dl.venta_linea_id
   where d.registrado_en >= v_desde and d.registrado_en < v_hasta and d.bodega_id = any (v_bodegas);

  v_netas := v_brutas - v_descuentos - v_impuestos - (v_devol - v_devol_imp);

  -- Costo de lo vendido: salidas por venta menos devoluciones que volvieron al inventario
  -- salida_venta lleva cantidad negativa (suma); devolucion_cliente, positiva (resta)
  select coalesce(sum(-cantidad * costo_unitario), 0)
    into v_cmv
    from public.movimientos_inventario
   where tipo in ('salida_venta', 'devolucion_cliente')
     and ocurrido_en >= v_desde and ocurrido_en < v_hasta and bodega_id = any (v_bodegas);
  v_cmv := round(v_cmv, 2);
  v_utilidad := v_netas - v_cmv;

  -- Gastos operativos del periodo (pagados o pendientes) y pérdidas de inventario y estampado
  select coalesce(sum(g.valor), 0) into v_gastos
    from public.gastos g
    join public.categorias_gasto cg on cg.id = g.categoria_id and cg.tipo = 'operativo'
   where g.estado <> 'anulado' and g.fecha between p_desde and p_hasta
     and (case when p_bodega is null then (g.bodega_id is null or g.bodega_id = any (v_bodegas))
               else g.bodega_id = p_bodega end);

  -- Pérdidas y faltantes salen con cantidad negativa (suman); sobrantes y reversos de
  -- pérdida entran con cantidad positiva (restan)
  select round(coalesce(sum(-cantidad * costo_unitario), 0), 2)
    into v_perdidas
    from public.movimientos_inventario
   where tipo in ('perdida_estampado', 'perdida_devolucion', 'perdida', 'ajuste_salida', 'ajuste_entrada', 'reverso_perdida')
     and ocurrido_en >= v_desde and ocurrido_en < v_hasta and bodega_id = any (v_bodegas);
  v_gastos_op := v_gastos + v_perdidas;

  -- Compras recibidas en el periodo, a costo
  select round(coalesce(sum(cantidad * costo_unitario), 0), 2) into v_compras
    from public.movimientos_inventario
   where tipo = 'entrada_compra'
     and ocurrido_en >= v_desde and ocurrido_en < v_hasta and bodega_id = any (v_bodegas);

  -- Dinero real del periodo
  select coalesce(sum(valor) filter (where sentido = 'entrada' and origen not in ('traslado', 'aporte', 'retiro', 'saldo_inicial')), 0),
         coalesce(sum(valor) filter (where sentido = 'salida' and origen not in ('traslado', 'aporte', 'retiro', 'saldo_inicial')), 0),
         coalesce(sum(valor) filter (where origen = 'aporte'), 0),
         coalesce(sum(valor) filter (where origen = 'retiro'), 0)
    into v_entradas, v_salidas, v_aportes, v_retiros
    from public.movimientos_caja m
   where m.ocurrido_en >= v_desde and m.ocurrido_en < v_hasta
     and (case when p_bodega is null
               then coalesce(app.bodega_movimiento_caja(m.documento_tipo, m.documento_id, m.cuenta_id) = any (v_bodegas), true)
               else app.bodega_movimiento_caja(m.documento_tipo, m.documento_id, m.cuenta_id) = p_bodega end);

  -- Saldos a la fecha
  select coalesce(sum(greatest(app.saldo_venta(v.id), 0)) filter (where v.estado_entrega = 'entregada'), 0),
         coalesce(sum(app.pagado_venta(v.id)) filter (where v.estado_entrega <> 'entregada'), 0)
    into v_cxc, v_anticipos
    from public.ventas v
   where v.estado = 'confirmada' and v.bodega_id = any (v_bodegas);

  select coalesce(sum(greatest(app.saldo_compra(c.id), 0)), 0) into v_cxp_compras
    from public.compras c
   where c.estado in ('recibida_parcial', 'recibida') and c.bodega_id = any (v_bodegas);

  select coalesce(sum(g.valor), 0) into v_cxp_gastos
    from public.gastos g
   where g.estado = 'pendiente'
     and (case when p_bodega is null then (g.bodega_id is null or g.bodega_id = any (v_bodegas))
               else g.bodega_id = p_bodega end);

  select jsonb_build_object(
           'total', coalesce(round(sum(e.cantidad * coalesce(vc.costo_promedio, 0)), 2), 0),
           'terminado', coalesce(round(sum(e.cantidad * coalesce(vc.costo_promedio, 0)) filter (where va.clase = 'terminado'), 2), 0),
           'base', coalesce(round(sum(e.cantidad * coalesce(vc.costo_promedio, 0)) filter (where va.clase = 'base'), 2), 0),
           'material', coalesce(round(sum(e.cantidad * coalesce(vc.costo_promedio, 0)) filter (where va.clase = 'material'), 2), 0))
    into v_inventario
    from public.existencias e
    join public.variantes va on va.id = e.variante_id
    left join public.variante_costos vc on vc.variante_id = e.variante_id
   where e.bodega_id = any (v_bodegas);

  return jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'bodega_id', p_bodega),
    'calculado', jsonb_build_object(
      'ventas_brutas', v_brutas,
      'descuentos', v_descuentos,
      'impuestos', v_impuestos,
      'devoluciones', v_devol - v_devol_imp,
      'ventas_netas', v_netas,
      'costo_mercancia_vendida', v_cmv,
      'utilidad_bruta', v_utilidad,
      'margen_bruto', case when v_netas > 0 then round(v_utilidad / v_netas, 4) end,
      'gastos_registrados', v_gastos,
      'perdidas_inventario', v_perdidas,
      'gastos_operativos', v_gastos_op,
      'resultado_operativo', v_utilidad - v_gastos_op,
      'compras_recibidas', v_compras),
    'dinero_real', jsonb_build_object(
      'entradas', v_entradas,
      'salidas', v_salidas,
      'flujo_de_caja', v_entradas - v_salidas,
      'aportes', v_aportes,
      'retiros', v_retiros),
    'saldos', jsonb_build_object(
      'cuentas_por_cobrar', v_cxc,
      'anticipos_de_clientes', v_anticipos,
      'cuentas_por_pagar', v_cxp_compras + v_cxp_gastos,
      'compras_por_pagar', v_cxp_compras,
      'gastos_por_pagar', v_cxp_gastos,
      'valor_inventario', v_inventario));
end $$;

-- Indicadores de operación. El vendedor ve solo sus ventas; nadie recibe costos aquí.
create function public.resumen_operacion(p_desde date, p_hasta date, p_bodega uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := app.desde_ts(p_desde);
  v_hasta timestamptz := app.hasta_ts(p_hasta);
  v_bodegas uuid[];
  v_ve_ventas boolean := app.tiene_permiso('ventas.ver') or app.tiene_permiso('ventas.ver_propias');
  v_solo_propias boolean := app.tiene_permiso('ventas.ver_propias') and not app.tiene_permiso('ventas.ver');
  v_ventas jsonb := null;
  v_inv jsonb := null;
begin
  if not app.usuario_activo() then
    raise exception 'Tu usuario no está activo.' using errcode = '42501';
  end if;
  if p_bodega is not null then
    perform app.exigir_bodega(p_bodega);
    v_bodegas := array[p_bodega];
  else
    select array_agg(id) into v_bodegas from public.bodegas where app.puede_ver_bodega(id);
  end if;
  v_bodegas := coalesce(v_bodegas, '{}');

  if v_ve_ventas then
    select jsonb_build_object(
             'ventas_netas_entregadas', coalesce(sum(v.total - v.impuestos)
                                          filter (where v.estado_entrega = 'entregada'
                                                    and v.entregada_en >= v_desde and v.entregada_en < v_hasta), 0),
             'ventas_entregadas', count(*) filter (where v.estado_entrega = 'entregada'
                                                     and v.entregada_en >= v_desde and v.entregada_en < v_hasta),
             'pedidos_pendientes', count(*) filter (where v.estado_entrega <> 'entregada'),
             'valor_pedidos_pendientes', coalesce(sum(v.total) filter (where v.estado_entrega <> 'entregada'), 0),
             'anticipos_pedidos_pendientes', coalesce(sum(app.pagado_venta(v.id))
                                                filter (where v.estado_entrega <> 'entregada'), 0),
             'por_estampar', count(*) filter (where v.estado_entrega = 'por_estampar'),
             'recibido', (select coalesce(sum(case when p.tipo = 'pago' then p.valor else -p.valor end), 0)
                            from public.pagos_venta p
                            join public.ventas x on x.id = p.venta_id
                           where p.fecha >= v_desde and p.fecha < v_hasta and x.bodega_id = any (v_bodegas)
                             and (not v_solo_propias or x.vendedor_id = auth.uid())))
      into v_ventas
      from public.ventas v
     where v.estado = 'confirmada' and v.bodega_id = any (v_bodegas)
       and (not v_solo_propias or v.vendedor_id = auth.uid());
  end if;

  if app.tiene_permiso('inventario.ver') then
    select jsonb_build_object(
             'unidades_terminadas', coalesce(sum(e.cantidad) filter (where va.clase = 'terminado'), 0),
             'unidades_base', coalesce(sum(e.cantidad) filter (where va.clase = 'base'), 0),
             'agotados', (select count(*) from public.alertas_inventario(p_bodega) a where a.alerta = 'agotado'),
             'stock_bajo', (select count(*) from public.alertas_inventario(p_bodega) a where a.alerta = 'bajo_minimo'))
      into v_inv
      from public.existencias e
      join public.variantes va on va.id = e.variante_id
     where e.bodega_id = any (v_bodegas);
  end if;

  return jsonb_build_object('periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'bodega_id', p_bodega),
                            'ventas', v_ventas, 'inventario', v_inv);
end $$;

-- Salud de datos: compara existencias contra el kardex y lo apartado contra las ventas
create function public.salud_datos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.es_administrador() then
    raise exception 'Solo el administrador revisa la salud de datos.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'existencias_vs_kardex', coalesce((
      select jsonb_agg(jsonb_build_object('variante_id', x.variante_id, 'bodega_id', x.bodega_id,
                                          'existencias', x.cantidad, 'kardex', x.kardex))
        from (select coalesce(e.variante_id, k.variante_id) as variante_id, coalesce(e.bodega_id, k.bodega_id) as bodega_id,
                     coalesce(e.cantidad, 0) as cantidad, coalesce(k.total, 0) as kardex
                from public.existencias e
                full join (select variante_id, bodega_id, sum(cantidad) as total
                             from public.movimientos_inventario group by variante_id, bodega_id) k
                  on k.variante_id = e.variante_id and k.bodega_id = e.bodega_id) x
       where x.cantidad <> x.kardex), '[]'::jsonb),
    'apartado_vs_ventas', coalesce((
      select jsonb_agg(jsonb_build_object('variante_id', e.variante_id, 'bodega_id', e.bodega_id,
                                          'apartada', e.apartada, 'ventas', coalesce(s.total, 0)))
        from public.existencias e
        left join (select l.variante_id, v.bodega_id, sum(l.cantidad_apartada) as total
                     from public.venta_lineas l join public.ventas v on v.id = l.venta_id
                    where v.estado = 'confirmada' group by l.variante_id, v.bodega_id) s
          on s.variante_id = e.variante_id and s.bodega_id = e.bodega_id
       where e.apartada <> coalesce(s.total, 0)), '[]'::jsonb),
    'pagos_sin_movimiento_caja', (
      select count(*) from public.pagos_venta p
       where not exists (select 1 from public.movimientos_caja m where m.documento_tipo = 'pago_venta' and m.documento_id = p.id))
      + (select count(*) from public.pagos_compra p
          where not exists (select 1 from public.movimientos_caja m where m.documento_tipo = 'pago_compra' and m.documento_id = p.id)));
end $$;
