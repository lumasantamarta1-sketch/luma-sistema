-- =====================================================================
-- LUMA · 09 · Operaciones de ventas: cotizar, confirmar, cobrar, entregar,
-- anular y devolver. Cada función corre en una sola transacción.
-- =====================================================================

-- Bloquea la venta y verifica que el usuario pueda operarla:
-- su punto de venta y, si solo ve lo propio, que la venta sea suya.
create function app.venta_para_operar(p_venta uuid) returns public.ventas
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
begin
  select * into v from public.ventas where id = p_venta for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  perform app.exigir_bodega(v.bodega_id);
  if v.vendedor_id is distinct from auth.uid()
     and app.tiene_permiso('ventas.ver_propias') and not app.tiene_permiso('ventas.ver') then
    raise exception 'Solo puedes operar tus propias ventas.' using errcode = '42501';
  end if;
  return v;
end $$;

create function app.actualizar_estado_entrega(p_venta uuid) returns void
language sql security definer set search_path = '' as $$
  update public.ventas v
     set estado_entrega = case
           when v.estado_entrega = 'entregada' then 'entregada'
           when exists (select 1 from public.venta_lineas l where l.venta_id = v.id and l.estado = 'por_estampar')
             then 'por_estampar'
           when not exists (select 1 from public.venta_lineas l
                             where l.venta_id = v.id and l.cantidad_apartada < l.cantidad)
             then 'en_preparacion'
           else 'pendiente' end
   where v.id = p_venta
$$;

-- Registra un pago o un reembolso con su movimiento de caja. La venta ya debe estar bloqueada.
create function app.cobrar_venta(
  p_venta uuid, p_metodo uuid, p_valor numeric, p_referencia text, p_clave uuid, p_tipo text default 'pago'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_id uuid;
  v_saldo numeric;
  v_cuenta uuid;
begin
  if p_clave is not null then
    select id into v_id from public.pagos_venta where clave = p_clave;
    if found then
      return v_id;
    end if;
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'El valor del pago debe ser mayor que cero.';
  end if;
  if p_tipo not in ('pago', 'reembolso') then
    raise exception 'Tipo de pago no válido.';
  end if;
  select * into v from public.ventas where id = p_venta;
  v_saldo := app.saldo_venta(p_venta);
  if p_tipo = 'pago' then
    if v.estado <> 'confirmada' then
      raise exception 'Solo se reciben pagos de ventas confirmadas.';
    end if;
    if round(p_valor, 2) > v_saldo then
      raise exception 'El pago supera el saldo pendiente de la venta (%).', v_saldo using errcode = 'P0001';
    end if;
  elsif round(p_valor, 2) > -v_saldo then
    raise exception 'El reembolso supera el saldo a favor del cliente (%).', greatest(-v_saldo, 0) using errcode = 'P0001';
  end if;
  v_cuenta := app.cuenta_para_metodo(p_metodo, v.bodega_id);
  insert into public.pagos_venta (venta_id, tipo, metodo_pago_id, cuenta_id, valor, referencia, clave)
  values (p_venta, p_tipo, p_metodo, v_cuenta, round(p_valor, 2), nullif(btrim(p_referencia), ''), p_clave)
  returning id into v_id;
  perform app.mover_caja(v_cuenta,
                         case p_tipo when 'pago' then 'entrada' else 'salida' end,
                         case p_tipo when 'pago' then 'cobro_venta' else 'reembolso_cliente' end,
                         round(p_valor, 2), 'pago_venta', v_id,
                         case p_tipo when 'pago' then 'Pago de ' else 'Reembolso de ' end
                           || coalesce(v.numero, v.numero_cotizacion));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Cotización: crea o reemplaza el contenido. No toca el inventario.
-- p_datos: {bodega_id, cliente_id, observaciones,
--           lineas: [{variante_id, cantidad, precio_unitario?, descuento?,
--                     descuento_autorizado_id?, personalizacion?}]}
-- ---------------------------------------------------------------------
create function public.guardar_cotizacion(p_venta uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_l jsonb;
  v_var record;
  v_cant numeric;
  v_precio numeric;
  v_desc numeric;
  v_max numeric;
  v_aut public.descuentos_autorizados%rowtype;
  v_restante jsonb := '{}'::jsonb;
  v_cliente uuid := nullif(p_datos ->> 'cliente_id', '')::uuid;
  v_bodega uuid := nullif(p_datos ->> 'bodega_id', '')::uuid;
  v_puede_precio boolean := app.tiene_permiso('precios.gestionar');
  v_puede_desc boolean := app.tiene_permiso('descuentos.autorizar');
begin
  perform app.exigir_permiso('ventas.crear');
  if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' or jsonb_array_length(p_datos -> 'lineas') = 0 then
    raise exception 'Agrega al menos un producto.';
  end if;
  if v_cliente is not null and not exists (select 1 from public.clientes where id = v_cliente and activo) then
    raise exception 'El cliente no existe o está inactivo.';
  end if;

  if p_venta is null then
    perform app.exigir_bodega(v_bodega);
    if not exists (select 1 from public.bodegas where id = v_bodega and activo and tipo = 'punto_venta') then
      raise exception 'Las ventas se registran en un punto de venta activo.';
    end if;
    insert into public.ventas (numero_cotizacion, bodega_id, cliente_id, observaciones)
    values (app.siguiente_numero('cotizacion'), v_bodega, v_cliente, nullif(btrim(p_datos ->> 'observaciones'), ''))
    returning * into v;
  else
    v := app.venta_para_operar(p_venta);
    if v.estado <> 'cotizacion' then
      raise exception 'Solo se editan las cotizaciones; esta venta ya está %.', v.estado;
    end if;
    if v_bodega is not null and v_bodega <> v.bodega_id then
      perform app.exigir_bodega(v_bodega);
      if not exists (select 1 from public.bodegas where id = v_bodega and activo and tipo = 'punto_venta') then
        raise exception 'Las ventas se registran en un punto de venta activo.';
      end if;
    end if;
    update public.ventas
       set cliente_id = v_cliente,
           bodega_id = coalesce(v_bodega, bodega_id),
           observaciones = nullif(btrim(p_datos ->> 'observaciones'), '')
     where id = v.id
    returning * into v;
    delete from public.venta_lineas where venta_id = v.id;
  end if;

  for v_l in select * from jsonb_array_elements(p_datos -> 'lineas') loop
    select va.id, va.sku, va.precio_venta, va.activo, p.se_vende, p.activo as producto_activo,
           p.unidad_medida, p.id as producto_id
      into v_var
      from public.variantes va
      join public.productos p on p.id = va.producto_id
     where va.id = nullif(v_l ->> 'variante_id', '')::uuid;
    if v_var.id is null then
      raise exception 'Uno de los productos no existe.';
    end if;
    if not (v_var.activo and v_var.producto_activo and v_var.se_vende) then
      raise exception 'El producto % no está disponible para la venta.', v_var.sku;
    end if;
    v_cant := (v_l ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'La cantidad de % debe ser mayor que cero.', v_var.sku;
    end if;
    if v_var.unidad_medida = 'unidad' and v_cant <> trunc(v_cant) then
      raise exception 'Las camisetas se venden en unidades enteras (%).', v_var.sku;
    end if;

    v_precio := case when v_puede_precio and v_l ? 'precio_unitario'
                     then (v_l ->> 'precio_unitario')::numeric else v_var.precio_venta end;
    if v_precio is null or v_precio < 0 then
      raise exception 'El producto % no tiene precio de venta.', v_var.sku;
    end if;

    v_desc := 0;
    v_aut := null;
    if nullif(v_l ->> 'descuento_autorizado_id', '') is not null then
      select * into v_aut from public.descuentos_autorizados
       where id = (v_l ->> 'descuento_autorizado_id')::uuid;
      if v_aut.id is null or not app.descuento_aplica(v_aut.id, v.id, v_var.id) then
        raise exception 'El descuento elegido no está vigente o no aplica a %.', v_var.sku using errcode = '42501';
      end if;
      if v_aut.porcentaje is not null then
        v_max := round(v_cant * v_precio * v_aut.porcentaje / 100, 2);
      elsif v_aut.valor_por_unidad is not null then
        v_max := round(v_cant * v_aut.valor_por_unidad, 2);
      else
        v_max := coalesce((v_restante ->> v_aut.id::text)::numeric, v_aut.valor_total);
      end if;
      v_max := least(v_max, round(v_cant * v_precio, 2));
      v_desc := case when v_l ? 'descuento' then least((v_l ->> 'descuento')::numeric, v_max) else v_max end;
      if v_aut.valor_total is not null then
        v_restante := v_restante || jsonb_build_object(v_aut.id::text, v_max - v_desc);
      end if;
    elsif coalesce((v_l ->> 'descuento')::numeric, 0) > 0 then
      if not v_puede_desc then
        raise exception 'Solo puedes aplicar descuentos autorizados por el administrador.' using errcode = '42501';
      end if;
      v_desc := (v_l ->> 'descuento')::numeric;
    end if;
    if v_desc < 0 or v_desc > round(v_cant * v_precio, 2) then
      raise exception 'El descuento de % no es válido.', v_var.sku;
    end if;

    insert into public.venta_lineas (venta_id, variante_id, cantidad, precio_unitario, descuento,
                                     descuento_autorizado_id, personalizacion)
    values (v.id, v_var.id, v_cant, v_precio, round(v_desc, 2), v_aut.id,
            nullif(btrim(v_l ->> 'personalizacion'), ''));
  end loop;

  perform app.recalcular_venta(v.id);
  return v.id;
end $$;

-- ---------------------------------------------------------------------
-- Confirmar: valida descuentos, aparta unidades, asigna número y registra anticipos.
-- p_clave evita registrarla dos veces. p_pagos: [{metodo_pago_id, valor, referencia, clave}]
-- ---------------------------------------------------------------------
create function public.confirmar_venta(p_venta uuid, p_clave uuid, p_pagos jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_l record;
  v_n numeric;
  v_bajo_pedido boolean;
  v_anticipo_pct numeric;
  v_p jsonb;
  v_minimo numeric;
begin
  perform app.exigir_permiso('ventas.crear');
  if p_clave is null then
    raise exception 'Falta la clave de confirmación.';
  end if;
  v := app.venta_para_operar(p_venta);
  if v.estado = 'confirmada' then
    if v.clave_confirmacion = p_clave then
      return v.id;
    end if;
    raise exception 'La venta % ya fue confirmada.', v.numero;
  elsif v.estado = 'cancelada' then
    raise exception 'La venta está cancelada.';
  end if;
  if not exists (select 1 from public.venta_lineas where venta_id = v.id) then
    raise exception 'La venta no tiene productos.';
  end if;

  perform app.recalcular_venta(v.id);
  perform app.validar_descuentos(v.id);
  select permite_venta_bajo_pedido, anticipo_minimo_pct into v_bajo_pedido, v_anticipo_pct
    from public.configuracion_negocio where id = 1;

  perform app.bloquear_variantes(array(select variante_id from public.venta_lineas where venta_id = v.id));
  for v_l in
    select l.id, l.variante_id, l.cantidad, p.por_pedido
      from public.venta_lineas l
      join public.variantes va on va.id = l.variante_id
      join public.productos p on p.id = va.producto_id
     where l.venta_id = v.id
     order by l.variante_id, l.id
  loop
    if v_l.por_pedido then
      update public.venta_lineas set estado = 'por_estampar', cantidad_apartada = 0 where id = v_l.id;
    else
      v_n := app.apartar(v_l.variante_id, v.bodega_id, v_l.cantidad, v_bajo_pedido);
      update public.venta_lineas
         set cantidad_apartada = v_n,
             estado = case when v_n = cantidad then 'apartada' else 'pendiente' end
       where id = v_l.id;
    end if;
  end loop;

  update public.ventas
     set estado = 'confirmada',
         numero = app.siguiente_numero('venta'),
         clave_confirmacion = p_clave,
         confirmada_en = now()
   where id = v.id
  returning * into v;
  perform app.actualizar_estado_entrega(v.id);
  if exists (select 1 from public.venta_lineas where venta_id = v.id and estado = 'por_estampar') then
    perform app.crear_orden_desde_venta(v.id);
  end if;

  if jsonb_typeof(p_pagos) = 'array' then
    if jsonb_array_length(p_pagos) > 0 then
      perform app.exigir_permiso('ventas.cobrar');
    end if;
    for v_p in select * from jsonb_array_elements(p_pagos) loop
      perform app.cobrar_venta(v.id, (v_p ->> 'metodo_pago_id')::uuid, (v_p ->> 'valor')::numeric,
                               v_p ->> 'referencia', nullif(v_p ->> 'clave', '')::uuid, 'pago');
    end loop;
  end if;

  -- Pedidos que se estampan o esperan mercancía pueden exigir un anticipo mínimo
  if v_anticipo_pct > 0 and exists (select 1 from public.venta_lineas
                                     where venta_id = v.id and cantidad_apartada < cantidad) then
    v_minimo := round(v.total * v_anticipo_pct / 100, 2);
    if app.pagado_venta(v.id) < v_minimo then
      raise exception 'Este pedido exige un anticipo mínimo de %.', v_minimo using errcode = 'P0001';
    end if;
  end if;
  return v.id;
end $$;

-- Aparta las unidades que ya llegaron para las líneas pendientes de una venta confirmada
create function public.apartar_venta(p_venta uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_l record;
  v_n numeric;
  v_completas integer := 0;
begin
  if not (app.tiene_permiso('ventas.crear') or app.tiene_permiso('ventas.entregar')) then
    raise exception 'No tienes permiso para esta acción (ventas.crear).' using errcode = '42501';
  end if;
  v := app.venta_para_operar(p_venta);
  if v.estado <> 'confirmada' or v.estado_entrega = 'entregada' then
    raise exception 'Solo se apartan unidades de ventas confirmadas sin entregar.';
  end if;
  perform app.bloquear_variantes(array(select variante_id from public.venta_lineas
                                        where venta_id = v.id and estado = 'pendiente'));
  for v_l in
    select id, variante_id, cantidad - cantidad_apartada as faltan
      from public.venta_lineas
     where venta_id = v.id and estado = 'pendiente'
     order by variante_id, id
  loop
    v_n := app.apartar(v_l.variante_id, v.bodega_id, v_l.faltan, true);
    update public.venta_lineas
       set cantidad_apartada = cantidad_apartada + v_n,
           estado = case when cantidad_apartada + v_n = cantidad then 'apartada' else 'pendiente' end
     where id = v_l.id;
    if v_n = v_l.faltan then
      v_completas := v_completas + 1;
    end if;
  end loop;
  perform app.actualizar_estado_entrega(v.id);
  return v_completas;
end $$;

create function public.registrar_pago_venta(
  p_venta uuid, p_metodo uuid, p_valor numeric, p_referencia text default null,
  p_clave uuid default null, p_tipo text default 'pago'
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if p_tipo = 'reembolso' then
    if not (app.tiene_permiso('ventas.devolver') or app.tiene_permiso('ventas.anular')) then
      raise exception 'No tienes permiso para registrar reembolsos.' using errcode = '42501';
    end if;
  else
    perform app.exigir_permiso('ventas.cobrar');
  end if;
  perform app.venta_para_operar(p_venta);
  return app.cobrar_venta(p_venta, p_metodo, p_valor, p_referencia, p_clave, p_tipo);
end $$;

-- ---------------------------------------------------------------------
-- Entregar: una salida de kardex por línea desde lo apartado y costo congelado.
-- Con saldo pendiente solo entrega quien tiene permiso de venta a crédito.
-- ---------------------------------------------------------------------
create function public.entregar_venta(p_venta uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_l record;
  v_costo numeric;
  v_saldo numeric;
begin
  perform app.exigir_permiso('ventas.entregar');
  v := app.venta_para_operar(p_venta);
  if v.estado <> 'confirmada' then
    raise exception 'Solo se entregan ventas confirmadas.';
  end if;
  if v.estado_entrega = 'entregada' then
    return v.id;
  end if;
  if exists (select 1 from public.venta_lineas where venta_id = v.id and cantidad_apartada < cantidad) then
    raise exception 'Hay productos sin apartar o por estampar; la venta aún no se puede entregar.' using errcode = 'P0001';
  end if;
  v_saldo := app.saldo_venta(v.id);
  if v_saldo > 0 and not app.tiene_permiso('ventas.credito') then
    raise exception 'La venta tiene un saldo pendiente de %. Para entregarla a crédito se necesita la autorización del administrador.',
      v_saldo using errcode = '42501';
  end if;

  perform app.bloquear_variantes(array(select variante_id from public.venta_lineas where venta_id = v.id));
  for v_l in
    select id, variante_id, cantidad from public.venta_lineas where venta_id = v.id order by variante_id, id
  loop
    v_costo := app.mover_inventario(v_l.variante_id, v.bodega_id, 'salida_venta', -v_l.cantidad,
                                    'venta', v.id, v_l.id, null, null, v_l.cantidad);
    insert into public.venta_linea_costos (venta_linea_id, costo_unitario) values (v_l.id, v_costo);
    update public.venta_lineas set estado = 'entregada', cantidad_apartada = 0 where id = v_l.id;
  end loop;

  update public.ventas
     set estado_entrega = 'entregada', entregada_en = now(), entregada_por = auth.uid()
   where id = v.id;
  return v.id;
end $$;

-- ---------------------------------------------------------------------
-- Anular: nunca borra. Antes de entregar libera lo apartado y cancela las órdenes en borrador.
-- El anticipo se devuelve aparte con registrar_pago_venta(..., 'reembolso') o queda a favor.
-- ---------------------------------------------------------------------
create function public.anular_venta(p_venta uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_l record;
begin
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Escribe el motivo de la anulación.';
  end if;
  v := app.venta_para_operar(p_venta);
  if v.estado = 'cancelada' then
    return v.id;
  end if;
  if v.estado = 'cotizacion' then
    if not (app.tiene_permiso('ventas.crear') or app.tiene_permiso('ventas.anular')) then
      raise exception 'No tienes permiso para esta acción (ventas.anular).' using errcode = '42501';
    end if;
  else
    perform app.exigir_permiso('ventas.anular');
    if v.estado_entrega = 'entregada' then
      raise exception 'Una venta entregada no se anula; registra una devolución.';
    end if;
    for v_l in
      select id, variante_id, cantidad_apartada from public.venta_lineas
       where venta_id = v.id and cantidad_apartada > 0 order by variante_id, id
    loop
      perform app.liberar(v_l.variante_id, v.bodega_id, v_l.cantidad_apartada);
      update public.venta_lineas set cantidad_apartada = 0 where id = v_l.id;
    end loop;
    update public.ordenes_estampado
       set estado = 'anulada',
           observaciones = concat_ws(' · ', observaciones, 'Venta anulada: ' || btrim(p_motivo))
     where venta_id = v.id and estado = 'borrador';
  end if;
  update public.ventas
     set estado = 'cancelada', cancelada_en = now(), cancelada_por = auth.uid(),
         motivo_cancelacion = btrim(p_motivo)
   where id = v.id;
  return v.id;
end $$;

-- ---------------------------------------------------------------------
-- Devolución de cliente, línea por línea. En buen estado vuelve al inventario;
-- dañada entra y sale como pérdida a su costo. Reembolso opcional.
-- p_datos: {motivo, clave, lineas: [{venta_linea_id, cantidad, condicion}],
--           reembolso?: {metodo_pago_id, valor, referencia, clave}}
-- ---------------------------------------------------------------------
create function public.registrar_devolucion_venta(p_venta uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas%rowtype;
  v_clave uuid := nullif(p_datos ->> 'clave', '')::uuid;
  v_dev uuid;
  v_x jsonb;
  v_l public.venta_lineas%rowtype;
  v_cant numeric;
  v_ya numeric;
  v_valor numeric;
  v_total numeric := 0;
  v_costo numeric;
  v_dl uuid;
  v_cond text;
  v_motivo text := btrim(coalesce(p_datos ->> 'motivo', ''));
begin
  perform app.exigir_permiso('ventas.devolver');
  if v_clave is not null then
    select id into v_dev from public.devoluciones_venta where clave = v_clave;
    if found then
      return v_dev;
    end if;
  end if;
  if length(v_motivo) = 0 then
    raise exception 'Escribe el motivo de la devolución.';
  end if;
  if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' or jsonb_array_length(p_datos -> 'lineas') = 0 then
    raise exception 'Indica qué productos se devuelven.';
  end if;
  v := app.venta_para_operar(p_venta);
  if v.estado <> 'confirmada' or v.estado_entrega <> 'entregada' then
    raise exception 'Solo se devuelven ventas entregadas. Antes de entregar, anula la venta.';
  end if;

  perform app.bloquear_variantes(array(
    select l.variante_id from public.venta_lineas l
     where l.venta_id = v.id
       and l.id in (select (x ->> 'venta_linea_id')::uuid from jsonb_array_elements(p_datos -> 'lineas') x)));

  insert into public.devoluciones_venta (numero, venta_id, bodega_id, motivo, clave)
  values (app.siguiente_numero('devolucion_venta'), v.id, v.bodega_id, v_motivo, v_clave)
  returning id into v_dev;

  for v_x in select * from jsonb_array_elements(p_datos -> 'lineas') loop
    select * into v_l from public.venta_lineas
     where id = nullif(v_x ->> 'venta_linea_id', '')::uuid and venta_id = v.id;
    if v_l.id is null then
      raise exception 'Un producto de la devolución no pertenece a esta venta.';
    end if;
    v_cant := (v_x ->> 'cantidad')::numeric;
    v_cond := coalesce(v_x ->> 'condicion', 'buena');
    if v_cond not in ('buena', 'danada') then
      raise exception 'La condición debe ser buena o dañada.';
    end if;
    select coalesce(sum(cantidad), 0) into v_ya from public.devolucion_venta_lineas where venta_linea_id = v_l.id;
    if v_cant is null or v_cant <= 0 or v_cant > v_l.cantidad - v_ya then
      raise exception 'De ese producto se pueden devolver máximo % unidades.', v_l.cantidad - v_ya;
    end if;
    v_valor := round((v_l.cantidad * v_l.precio_unitario - v_l.descuento) * v_cant / v_l.cantidad, 2);
    insert into public.devolucion_venta_lineas (devolucion_id, venta_linea_id, cantidad, condicion, valor)
    values (v_dev, v_l.id, v_cant, v_cond, v_valor)
    returning id into v_dl;

    select costo_unitario into v_costo from public.venta_linea_costos where venta_linea_id = v_l.id;
    perform app.mover_inventario(v_l.variante_id, v.bodega_id, 'devolucion_cliente', v_cant,
                                 'devolucion_venta', v_dev, v_dl, v_costo, v_motivo);
    if v_cond = 'danada' then
      perform app.mover_inventario(v_l.variante_id, v.bodega_id, 'perdida_devolucion', -v_cant,
                                   'devolucion_venta', v_dev, v_dl, v_costo, 'Devuelta en mal estado');
    end if;
    v_total := v_total + v_valor;
  end loop;

  update public.devoluciones_venta set valor_total = v_total where id = v_dev;

  if jsonb_typeof(p_datos -> 'reembolso') = 'object' then
    perform app.cobrar_venta(v.id, (p_datos #>> '{reembolso,metodo_pago_id}')::uuid,
                             (p_datos #>> '{reembolso,valor}')::numeric,
                             p_datos #>> '{reembolso,referencia}',
                             nullif(p_datos #>> '{reembolso,clave}', '')::uuid, 'reembolso');
  end if;
  return v_dev;
end $$;
