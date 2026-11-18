-- =====================================================================
-- LUMA · 10 · Operaciones de compras y de estampado
-- =====================================================================

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------

-- Totales y costo neto por unidad. Los costos adicionales se reparten por valor de línea.
-- Si LUMA no es responsable de IVA, el IVA pagado se suma al costo.
create function app.recalcular_compra(p_compra uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_resp boolean;
  v_adic numeric;
  v_base_total numeric;
  v_cant_total numeric;
begin
  select responsable_iva into v_resp from public.configuracion_negocio where id = 1;
  select coalesce(sum(valor), 0) into v_adic from public.compra_costos_adicionales where compra_id = p_compra;
  select coalesce(sum(cantidad * costo_unitario - descuento), 0), coalesce(sum(cantidad), 0)
    into v_base_total, v_cant_total
    from public.compra_lineas where compra_id = p_compra;

  update public.compra_lineas l
     set costo_neto_unitario = round((
           (l.cantidad * l.costo_unitario - l.descuento)
           + case when v_resp then 0
                  else round((l.cantidad * l.costo_unitario - l.descuento) * l.impuesto_pct / 100, 2) end
           + case when v_base_total > 0 then v_adic * (l.cantidad * l.costo_unitario - l.descuento) / v_base_total
                  when v_cant_total > 0 then v_adic * l.cantidad / v_cant_total
                  else 0 end
         ) / l.cantidad, 4)
   where l.compra_id = p_compra;

  update public.compras c
     set subtotal = s.subtotal,
         descuentos = s.descuentos,
         impuestos = s.impuestos,
         costos_adicionales = v_adic,
         total = s.subtotal - s.descuentos + s.impuestos + v_adic
    from (select coalesce(round(sum(cantidad * costo_unitario), 2), 0) as subtotal,
                 coalesce(sum(descuento), 0) as descuentos,
                 coalesce(sum(round((cantidad * costo_unitario - descuento) * impuesto_pct / 100, 2)), 0) as impuestos
            from public.compra_lineas where compra_id = p_compra) s
   where c.id = p_compra;
end $$;

-- Crea o reemplaza una compra en borrador.
-- p_datos: {proveedor_id, bodega_id, fecha, forma_pago, observaciones,
--           lineas: [{variante_id, cantidad, costo_unitario, descuento?, impuesto_pct?}],
--           costos_adicionales: [{concepto, valor}]}
create function public.guardar_compra(p_compra uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
  v_l jsonb;
  v_var record;
  v_cant numeric;
  v_proveedor uuid := nullif(p_datos ->> 'proveedor_id', '')::uuid;
  v_bodega uuid := nullif(p_datos ->> 'bodega_id', '')::uuid;
begin
  perform app.exigir_permiso('compras.gestionar');
  if not exists (select 1 from public.proveedores where id = v_proveedor and activo) then
    raise exception 'Elige un proveedor activo.';
  end if;
  if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' or jsonb_array_length(p_datos -> 'lineas') = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;

  if p_compra is null then
    perform app.exigir_bodega(v_bodega);
    insert into public.compras (numero, proveedor_id, bodega_id, fecha, forma_pago, observaciones)
    values (app.siguiente_numero('compra'), v_proveedor, v_bodega,
            coalesce(nullif(p_datos ->> 'fecha', '')::date, app.hoy()),
            nullif(btrim(p_datos ->> 'forma_pago'), ''), nullif(btrim(p_datos ->> 'observaciones'), ''))
    returning * into c;
  else
    select * into c from public.compras where id = p_compra for update;
    if not found then
      raise exception 'La compra no existe.';
    end if;
    perform app.exigir_bodega(c.bodega_id);
    if c.estado <> 'borrador' then
      raise exception 'Solo se editan compras en borrador.';
    end if;
    if v_bodega is not null then
      perform app.exigir_bodega(v_bodega);
    end if;
    update public.compras
       set proveedor_id = v_proveedor,
           bodega_id = coalesce(v_bodega, bodega_id),
           fecha = coalesce(nullif(p_datos ->> 'fecha', '')::date, fecha),
           forma_pago = nullif(btrim(p_datos ->> 'forma_pago'), ''),
           observaciones = nullif(btrim(p_datos ->> 'observaciones'), '')
     where id = c.id
    returning * into c;
    delete from public.compra_lineas where compra_id = c.id;
    delete from public.compra_costos_adicionales where compra_id = c.id;
  end if;

  for v_l in select * from jsonb_array_elements(p_datos -> 'lineas') loop
    select va.id, va.sku, va.activo, p.unidad_medida into v_var
      from public.variantes va join public.productos p on p.id = va.producto_id
     where va.id = nullif(v_l ->> 'variante_id', '')::uuid;
    if v_var.id is null or not v_var.activo then
      raise exception 'Uno de los productos no existe o está inactivo.';
    end if;
    v_cant := (v_l ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'La cantidad de % debe ser mayor que cero.', v_var.sku;
    end if;
    if v_var.unidad_medida = 'unidad' and v_cant <> trunc(v_cant) then
      raise exception 'Las camisetas se compran en unidades enteras (%).', v_var.sku;
    end if;
    if (v_l ->> 'costo_unitario') is null or (v_l ->> 'costo_unitario')::numeric < 0 then
      raise exception 'Indica el costo unitario de %.', v_var.sku;
    end if;
    insert into public.compra_lineas (compra_id, variante_id, cantidad, costo_unitario, descuento, impuesto_pct)
    values (c.id, v_var.id, v_cant, (v_l ->> 'costo_unitario')::numeric,
            coalesce((v_l ->> 'descuento')::numeric, 0), coalesce((v_l ->> 'impuesto_pct')::numeric, 0));
  end loop;

  if jsonb_typeof(p_datos -> 'costos_adicionales') = 'array' then
    insert into public.compra_costos_adicionales (compra_id, concepto, valor)
    select c.id, btrim(x ->> 'concepto'), (x ->> 'valor')::numeric
      from jsonb_array_elements(p_datos -> 'costos_adicionales') x;
  end if;

  perform app.recalcular_compra(c.id);
  return c.id;
end $$;

-- Recibe mercancía. p_clave hace idempotente la recepción: cada línea genera su
-- movimiento con un identificador derivado de la clave, y repetirla no duplica nada.
-- p_lineas: [{compra_linea_id, cantidad}] o null para recibir todo lo pendiente.
create function app.recibir_compra_int(p_compra uuid, p_clave uuid, p_lineas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
  v_r record;
  v_pend numeric;
begin
  select * into c from public.compras where id = p_compra;
  if exists (select 1 from public.movimientos_inventario m
               join public.compra_lineas l on l.compra_id = c.id
              where m.documento_tipo = 'compra' and m.documento_id = c.id
                and m.linea_id = md5(p_clave::text || l.id::text)::uuid) then
    return;
  end if;
  if c.estado not in ('confirmada', 'recibida_parcial') then
    raise exception 'Solo se recibe mercancía de compras confirmadas con unidades pendientes.';
  end if;

  create temporary table if not exists _recepcion (linea_id uuid primary key, variante_id uuid, cantidad numeric, costo numeric)
    on commit drop;
  truncate _recepcion;
  if p_lineas is null then
    insert into _recepcion
    select id, variante_id, cantidad - cantidad_recibida, costo_neto_unitario
      from public.compra_lineas
     where compra_id = c.id and cantidad > cantidad_recibida;
  else
    for v_r in
      select l.id, l.variante_id, l.cantidad - l.cantidad_recibida as pendiente, l.costo_neto_unitario,
             (x ->> 'cantidad')::numeric as cantidad
        from jsonb_array_elements(p_lineas) x
        left join public.compra_lineas l on l.id = nullif(x ->> 'compra_linea_id', '')::uuid and l.compra_id = c.id
    loop
      if v_r.id is null then
        raise exception 'Una línea recibida no pertenece a esta compra.';
      end if;
      if v_r.cantidad is null or v_r.cantidad <= 0 then
        continue;
      end if;
      select coalesce(sum(cantidad), 0) into v_pend from _recepcion where linea_id = v_r.id;
      if v_r.cantidad + v_pend > v_r.pendiente then
        raise exception 'Se están recibiendo más unidades de las pendientes (%).', v_r.pendiente;
      end if;
      insert into _recepcion values (v_r.id, v_r.variante_id, v_r.cantidad, v_r.costo_neto_unitario)
      on conflict (linea_id) do update set cantidad = _recepcion.cantidad + excluded.cantidad;
    end loop;
  end if;
  if not exists (select 1 from _recepcion) then
    raise exception 'No hay unidades para recibir.';
  end if;

  perform app.bloquear_variantes(array(select variante_id from _recepcion));
  for v_r in select * from _recepcion order by variante_id, linea_id loop
    perform app.mover_inventario(v_r.variante_id, c.bodega_id, 'entrada_compra', v_r.cantidad,
                                 'compra', c.id, md5(p_clave::text || v_r.linea_id::text)::uuid,
                                 v_r.costo, 'Recepción de ' || c.numero);
    update public.compra_lineas set cantidad_recibida = cantidad_recibida + v_r.cantidad where id = v_r.linea_id;
  end loop;

  update public.compras
     set estado = case when exists (select 1 from public.compra_lineas
                                     where compra_id = c.id and cantidad_recibida < cantidad)
                       then 'recibida_parcial' else 'recibida' end
   where id = c.id;
end $$;

create function public.confirmar_compra(p_compra uuid, p_recibir boolean default false, p_clave uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
begin
  perform app.exigir_permiso('compras.gestionar');
  select * into c from public.compras where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  perform app.exigir_bodega(c.bodega_id);
  if c.estado <> 'borrador' then
    if c.estado = 'anulada' then
      raise exception 'La compra está anulada.';
    end if;
    return c.id;
  end if;
  if not exists (select 1 from public.compra_lineas where compra_id = c.id) then
    raise exception 'La compra no tiene productos.';
  end if;
  perform app.recalcular_compra(c.id);
  update public.compras
     set estado = 'confirmada', confirmado_por = auth.uid(), confirmado_en = now()
   where id = c.id;
  if p_recibir then
    perform app.recibir_compra_int(c.id, coalesce(p_clave, gen_random_uuid()), null);
  end if;
  return c.id;
end $$;

create function public.recibir_compra(p_compra uuid, p_clave uuid, p_lineas jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
begin
  if not (app.tiene_permiso('compras.recibir') or app.tiene_permiso('compras.gestionar')) then
    raise exception 'No tienes permiso para esta acción (compras.recibir).' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave de la recepción.';
  end if;
  select * into c from public.compras where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  perform app.exigir_bodega(c.bodega_id);
  perform app.recibir_compra_int(c.id, p_clave, p_lineas);
  return c.id;
end $$;

-- Pago al proveedor (salida de caja) o reembolso del proveedor (entrada)
create function public.registrar_pago_compra(
  p_compra uuid, p_cuenta uuid, p_valor numeric, p_referencia text default null,
  p_clave uuid default null, p_tipo text default 'pago'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
  v_id uuid;
  v_saldo numeric;
  v_bodega_cuenta uuid;
begin
  perform app.exigir_permiso('compras.pagar');
  if p_clave is not null then
    select id into v_id from public.pagos_compra where clave = p_clave;
    if found then
      return v_id;
    end if;
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'El valor debe ser mayor que cero.';
  end if;
  if p_tipo not in ('pago', 'reembolso') then
    raise exception 'Tipo de pago no válido.';
  end if;
  select * into c from public.compras where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  perform app.exigir_bodega(c.bodega_id);
  if c.estado = 'borrador' then
    raise exception 'Confirma la compra antes de registrar pagos.';
  end if;
  select bodega_id into v_bodega_cuenta from public.cuentas_dinero where id = p_cuenta;
  if v_bodega_cuenta is not null then
    perform app.exigir_bodega(v_bodega_cuenta);
  end if;
  v_saldo := app.saldo_compra(c.id);
  if p_tipo = 'pago' then
    if c.estado = 'anulada' then
      raise exception 'La compra está anulada.';
    end if;
    if round(p_valor, 2) > v_saldo then
      raise exception 'El pago supera el saldo por pagar de la compra (%).', v_saldo using errcode = 'P0001';
    end if;
  elsif round(p_valor, 2) > -v_saldo then
    raise exception 'El reembolso supera el saldo a favor (%).', greatest(-v_saldo, 0) using errcode = 'P0001';
  end if;
  insert into public.pagos_compra (compra_id, tipo, cuenta_id, valor, referencia, clave)
  values (c.id, p_tipo, p_cuenta, round(p_valor, 2), nullif(btrim(p_referencia), ''), p_clave)
  returning id into v_id;
  perform app.mover_caja(p_cuenta,
                         case p_tipo when 'pago' then 'salida' else 'entrada' end,
                         case p_tipo when 'pago' then 'pago_compra' else 'reembolso_proveedor' end,
                         round(p_valor, 2), 'pago_compra', v_id,
                         case p_tipo when 'pago' then 'Pago de ' else 'Reembolso de ' end || c.numero);
  return v_id;
end $$;

create function public.anular_compra(p_compra uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
begin
  perform app.exigir_permiso('compras.gestionar');
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Escribe el motivo de la anulación.';
  end if;
  select * into c from public.compras where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  perform app.exigir_bodega(c.bodega_id);
  if c.estado = 'anulada' then
    return c.id;
  end if;
  if exists (select 1 from public.compra_lineas where compra_id = c.id and cantidad_recibida > 0) then
    raise exception 'La compra ya tiene mercancía recibida; registra una devolución al proveedor.';
  end if;
  if app.pagado_compra(c.id) <> 0 then
    raise exception 'La compra tiene pagos; registra primero el reembolso del proveedor.';
  end if;
  update public.compras
     set estado = 'anulada', observaciones = concat_ws(' · ', observaciones, 'Anulada: ' || btrim(p_motivo))
   where id = c.id;
  return c.id;
end $$;

-- Devolución al proveedor: sale del inventario a su costo neto y reduce lo que se le debe.
-- p_datos: {motivo, clave, lineas: [{compra_linea_id, cantidad}]}
create function public.registrar_devolucion_proveedor(p_compra uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras%rowtype;
  v_clave uuid := nullif(p_datos ->> 'clave', '')::uuid;
  v_motivo text := btrim(coalesce(p_datos ->> 'motivo', ''));
  v_dev uuid;
  v_x jsonb;
  v_l public.compra_lineas%rowtype;
  v_cant numeric;
  v_dl uuid;
  v_total numeric := 0;
begin
  perform app.exigir_permiso('compras.gestionar');
  if v_clave is not null then
    select id into v_dev from public.devoluciones_proveedor where clave = v_clave;
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
  select * into c from public.compras where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  perform app.exigir_bodega(c.bodega_id);

  perform app.bloquear_variantes(array(
    select l.variante_id from public.compra_lineas l
     where l.compra_id = c.id
       and l.id in (select (x ->> 'compra_linea_id')::uuid from jsonb_array_elements(p_datos -> 'lineas') x)));

  insert into public.devoluciones_proveedor (numero, compra_id, bodega_id, motivo, clave)
  values (app.siguiente_numero('devolucion_proveedor'), c.id, c.bodega_id, v_motivo, v_clave)
  returning id into v_dev;

  for v_x in select * from jsonb_array_elements(p_datos -> 'lineas') loop
    select * into v_l from public.compra_lineas
     where id = nullif(v_x ->> 'compra_linea_id', '')::uuid and compra_id = c.id
       for update;
    if v_l.id is null then
      raise exception 'Un producto de la devolución no pertenece a esta compra.';
    end if;
    v_cant := (v_x ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 or v_cant > v_l.cantidad_recibida - v_l.cantidad_devuelta then
      raise exception 'De ese producto se pueden devolver máximo % unidades.', v_l.cantidad_recibida - v_l.cantidad_devuelta;
    end if;
    insert into public.devolucion_proveedor_lineas (devolucion_id, compra_linea_id, variante_id, cantidad, costo_unitario)
    values (v_dev, v_l.id, v_l.variante_id, v_cant, v_l.costo_neto_unitario)
    returning id into v_dl;
    perform app.mover_inventario(v_l.variante_id, c.bodega_id, 'devolucion_proveedor', -v_cant,
                                 'devolucion_proveedor', v_dev, v_dl, v_l.costo_neto_unitario, v_motivo);
    update public.compra_lineas set cantidad_devuelta = cantidad_devuelta + v_cant where id = v_l.id;
    v_total := v_total + round(v_cant * v_l.costo_neto_unitario, 2);
  end loop;
  update public.devoluciones_proveedor set valor_total = v_total where id = v_dev;
  return v_dev;
end $$;

-- ---------------------------------------------------------------------
-- Estampado
-- ---------------------------------------------------------------------

-- Crea o edita una orden en borrador. Las líneas de un pedido personalizado no se editan.
-- p_datos: {bodega_id, observaciones, costos_adicionales?, lineas?: [{variante_id, cantidad}]}
create function public.guardar_orden_estampado(p_orden uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.ordenes_estampado%rowtype;
  v_l jsonb;
  v_bodega uuid := nullif(p_datos ->> 'bodega_id', '')::uuid;
  v_cant numeric;
begin
  perform app.exigir_permiso('estampado.gestionar');
  if p_datos ? 'costos_adicionales' and coalesce((p_datos ->> 'costos_adicionales')::numeric, 0) <> 0
     and not app.tiene_permiso('costos.ver') then
    raise exception 'Solo quien ve costos registra costos adicionales.' using errcode = '42501';
  end if;
  if p_orden is null then
    perform app.exigir_bodega(v_bodega);
    if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' or jsonb_array_length(p_datos -> 'lineas') = 0 then
      raise exception 'Agrega al menos una camiseta para estampar.';
    end if;
    insert into public.ordenes_estampado (numero, bodega_id, observaciones, costos_adicionales)
    values (app.siguiente_numero('estampado'), v_bodega, nullif(btrim(p_datos ->> 'observaciones'), ''),
            coalesce((p_datos ->> 'costos_adicionales')::numeric, 0))
    returning * into o;
  else
    select * into o from public.ordenes_estampado where id = p_orden for update;
    if not found then
      raise exception 'La orden no existe.';
    end if;
    perform app.exigir_bodega(o.bodega_id);
    if o.estado <> 'borrador' then
      raise exception 'Solo se editan órdenes en borrador.';
    end if;
    if o.venta_id is not null and (p_datos ? 'lineas' or (v_bodega is not null and v_bodega <> o.bodega_id)) then
      raise exception 'Las líneas y el punto de un pedido personalizado no se editan.';
    end if;
    if v_bodega is not null then
      perform app.exigir_bodega(v_bodega);
    end if;
    update public.ordenes_estampado
       set observaciones = case when p_datos ? 'observaciones'
                                then nullif(btrim(p_datos ->> 'observaciones'), '') else observaciones end,
           costos_adicionales = case when p_datos ? 'costos_adicionales'
                                     then coalesce((p_datos ->> 'costos_adicionales')::numeric, 0)
                                     else costos_adicionales end,
           bodega_id = coalesce(v_bodega, bodega_id)
     where id = o.id
    returning * into o;
    if p_datos ? 'lineas' then
      delete from public.orden_estampado_lineas where orden_id = o.id;
    end if;
  end if;

  if o.venta_id is null and jsonb_typeof(p_datos -> 'lineas') = 'array' then
    for v_l in select * from jsonb_array_elements(p_datos -> 'lineas') loop
      v_cant := (v_l ->> 'cantidad')::numeric;
      if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant) then
        raise exception 'Las cantidades a estampar son unidades enteras mayores que cero.';
      end if;
      perform app.agregar_linea_orden(o.id, nullif(v_l ->> 'variante_id', '')::uuid, v_cant);
    end loop;
  end if;
  return o.id;
end $$;

-- Crea la orden de estampado de lo que falte en un pedido personalizado
create function public.ordenar_estampado_venta(p_venta uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_permiso('estampado.gestionar');
  perform app.venta_para_operar(p_venta);
  return app.crear_orden_desde_venta(p_venta);
end $$;

-- Registra el resultado: consume base y materiales a su costo promedio, calcula el costo
-- unitario de cada línea, entra las camisetas y pasa las dañadas a pérdida.
-- p_datos: {costos_adicionales?, lineas: [{linea_id, buenas, danadas,
--           consumos?: [{variante_id, cantidad}]}]}
create function public.registrar_estampado(p_orden uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.ordenes_estampado%rowtype;
  v_l record;
  v_x jsonb;
  v_c jsonb;
  v_b numeric;
  v_d numeric;
  v_costo numeric;
  v_total_unid numeric;
  v_u numeric;
  v_vl public.venta_lineas%rowtype;
  v_venta public.ventas%rowtype;
  v_n numeric;
  v_clase text;
begin
  perform app.exigir_permiso('estampado.gestionar');
  select * into o from public.ordenes_estampado where id = p_orden for update;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  perform app.exigir_bodega(o.bodega_id);
  if o.estado = 'terminada' then
    return o.id;
  elsif o.estado = 'anulada' then
    raise exception 'La orden está anulada.';
  end if;
  if p_datos ? 'costos_adicionales' then
    if coalesce((p_datos ->> 'costos_adicionales')::numeric, 0) <> o.costos_adicionales
       and not app.tiene_permiso('costos.ver') then
      raise exception 'Solo quien ve costos registra costos adicionales.' using errcode = '42501';
    end if;
    update public.ordenes_estampado
       set costos_adicionales = coalesce((p_datos ->> 'costos_adicionales')::numeric, 0)
     where id = o.id
    returning * into o;
  end if;

  -- Resultado de cada línea y consumo real
  if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' then
    raise exception 'Indica el resultado de cada línea de la orden.';
  end if;
  for v_l in select * from public.orden_estampado_lineas where orden_id = o.id loop
    v_x := null;
    select x into v_x from jsonb_array_elements(p_datos -> 'lineas') x
     where nullif(x ->> 'linea_id', '')::uuid = v_l.id
     limit 1;
    if v_x is null then
      raise exception 'Falta el resultado de una de las líneas de la orden.';
    end if;
    v_b := coalesce((v_x ->> 'buenas')::numeric, 0);
    v_d := coalesce((v_x ->> 'danadas')::numeric, 0);
    if v_b < 0 or v_d < 0 or v_b + v_d = 0 or v_b <> trunc(v_b) or v_d <> trunc(v_d) then
      raise exception 'Indica cuántas camisetas salieron buenas y cuántas dañadas, en unidades enteras.';
    end if;
    update public.orden_estampado_lineas set cantidad_buenas = v_b, cantidad_danadas = v_d where id = v_l.id;

    -- Por defecto, el consumo teórico ajustado a las unidades realmente estampadas
    update public.orden_estampado_consumos
       set cantidad_real = round(cantidad_teorica * (v_b + v_d) / v_l.cantidad_planeada, 3)
     where linea_id = v_l.id;
    if jsonb_typeof(v_x -> 'consumos') = 'array' then
      for v_c in select * from jsonb_array_elements(v_x -> 'consumos') loop
        select clase into v_clase from public.variantes where id = nullif(v_c ->> 'variante_id', '')::uuid;
        if v_clase is null or v_clase not in ('base', 'material') then
          raise exception 'Solo se consumen camisetas base y materiales.';
        end if;
        if (v_c ->> 'cantidad')::numeric is null or (v_c ->> 'cantidad')::numeric < 0 then
          raise exception 'El consumo no puede ser negativo.';
        end if;
        insert into public.orden_estampado_consumos (linea_id, variante_id, cantidad_teorica, cantidad_real)
        values (v_l.id, (v_c ->> 'variante_id')::uuid, 0, (v_c ->> 'cantidad')::numeric)
        on conflict (linea_id, variante_id) do update set cantidad_real = excluded.cantidad_real;
      end loop;
    end if;
  end loop;

  perform app.bloquear_variantes(array(
    select c.variante_id from public.orden_estampado_consumos c
      join public.orden_estampado_lineas l on l.id = c.linea_id
     where l.orden_id = o.id
    union
    select variante_id from public.orden_estampado_lineas where orden_id = o.id));

  -- Consumos: salen a su costo promedio. Todo o nada: si algo falta, se rechaza la orden.
  create temporary table if not exists _costo_linea (linea_id uuid primary key, costo numeric) on commit drop;
  truncate _costo_linea;
  for v_l in
    select c.id, c.linea_id, c.variante_id, c.cantidad_real
      from public.orden_estampado_consumos c
      join public.orden_estampado_lineas l on l.id = c.linea_id
     where l.orden_id = o.id and c.cantidad_real > 0
     order by c.variante_id, c.id
  loop
    v_costo := app.mover_inventario(v_l.variante_id, o.bodega_id, 'consumo_estampado', -v_l.cantidad_real,
                                    'estampado', o.id, v_l.id, null, 'Estampado ' || o.numero);
    insert into _costo_linea values (v_l.linea_id, v_l.cantidad_real * v_costo)
    on conflict (linea_id) do update set costo = _costo_linea.costo + excluded.costo;
  end loop;

  -- Entradas: costo unitario = (consumos + parte de costos adicionales) ÷ unidades estampadas
  select sum(cantidad_buenas + cantidad_danadas) into v_total_unid
    from public.orden_estampado_lineas where orden_id = o.id;
  for v_l in
    select l.*, coalesce(cl.costo, 0) as costo_consumo
      from public.orden_estampado_lineas l
      left join _costo_linea cl on cl.linea_id = l.id
     where l.orden_id = o.id
     order by l.variante_id, l.id
  loop
    v_u := round((v_l.costo_consumo
                  + o.costos_adicionales * (v_l.cantidad_buenas + v_l.cantidad_danadas) / v_total_unid)
                 / (v_l.cantidad_buenas + v_l.cantidad_danadas), 4);
    perform app.mover_inventario(v_l.variante_id, o.bodega_id, 'entrada_estampado',
                                 v_l.cantidad_buenas + v_l.cantidad_danadas, 'estampado', o.id, v_l.id, v_u,
                                 'Estampado ' || o.numero);
    if v_l.cantidad_danadas > 0 then
      perform app.mover_inventario(v_l.variante_id, o.bodega_id, 'perdida_estampado', -v_l.cantidad_danadas,
                                   'estampado', o.id, v_l.id, v_u, 'Dañada al estampar');
    end if;

    -- Pedido personalizado: las buenas quedan apartadas para su venta
    if v_l.venta_linea_id is not null and v_l.cantidad_buenas > 0 then
      select * into v_vl from public.venta_lineas where id = v_l.venta_linea_id for update;
      select * into v_venta from public.ventas where id = v_vl.venta_id;
      if v_venta.estado = 'confirmada' and v_vl.estado <> 'entregada' and v_venta.bodega_id = o.bodega_id then
        v_n := app.apartar(v_vl.variante_id, o.bodega_id,
                           least(v_l.cantidad_buenas, v_vl.cantidad - v_vl.cantidad_apartada), true);
        update public.venta_lineas
           set cantidad_apartada = cantidad_apartada + v_n,
               estado = case when cantidad_apartada + v_n >= cantidad then 'apartada' else 'por_estampar' end
         where id = v_vl.id;
        perform app.actualizar_estado_entrega(v_venta.id);
      end if;
    end if;
  end loop;

  update public.ordenes_estampado
     set estado = 'terminada', terminado_por = auth.uid(), terminado_en = now()
   where id = o.id;
  return o.id;
end $$;

-- Anula una orden. En borrador solo cambia el estado; terminada genera los movimientos
-- contrarios: salen las camisetas, se reversa la pérdida y vuelven base y materiales.
create function public.anular_estampado(p_orden uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.ordenes_estampado%rowtype;
  v_l record;
  v_u numeric;
  v_vl public.venta_lineas%rowtype;
  v_n numeric;
begin
  perform app.exigir_permiso('estampado.anular');
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Escribe el motivo de la anulación.';
  end if;
  select * into o from public.ordenes_estampado where id = p_orden for update;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  perform app.exigir_bodega(o.bodega_id);
  if o.estado = 'anulada' then
    return o.id;
  end if;

  if o.estado = 'terminada' then
    perform app.bloquear_variantes(array(
      select c.variante_id from public.orden_estampado_consumos c
        join public.orden_estampado_lineas l on l.id = c.linea_id
       where l.orden_id = o.id
      union
      select variante_id from public.orden_estampado_lineas where orden_id = o.id));

    for v_l in select * from public.orden_estampado_lineas where orden_id = o.id order by variante_id, id loop
      -- Libera lo que esta orden había apartado para su venta
      if v_l.venta_linea_id is not null then
        select * into v_vl from public.venta_lineas where id = v_l.venta_linea_id for update;
        if v_vl.estado = 'entregada' then
          raise exception 'Las camisetas de esta orden ya se entregaron; registra una devolución.';
        end if;
        v_n := least(v_vl.cantidad_apartada, v_l.cantidad_buenas);
        if v_n > 0 then
          perform app.liberar(v_vl.variante_id, o.bodega_id, v_n);
          update public.venta_lineas
             set cantidad_apartada = cantidad_apartada - v_n, estado = 'por_estampar'
           where id = v_vl.id;
          perform app.actualizar_estado_entrega(v_vl.venta_id);
        end if;
      end if;
      select costo_unitario into v_u from public.movimientos_inventario
       where documento_tipo = 'estampado' and linea_id = v_l.id and tipo = 'entrada_estampado';
      if v_l.cantidad_danadas > 0 then
        perform app.mover_inventario(v_l.variante_id, o.bodega_id, 'reverso_perdida', v_l.cantidad_danadas,
                                     'estampado', o.id, v_l.id, v_u, 'Anulación: ' || btrim(p_motivo));
      end if;
      perform app.mover_inventario(v_l.variante_id, o.bodega_id, 'reverso_entrada',
                                   -(v_l.cantidad_buenas + v_l.cantidad_danadas), 'estampado', o.id, v_l.id, v_u,
                                   'Anulación: ' || btrim(p_motivo));
    end loop;

    for v_l in
      select c.id, c.variante_id, c.cantidad_real, m.costo_unitario
        from public.orden_estampado_consumos c
        join public.orden_estampado_lineas l on l.id = c.linea_id
        join public.movimientos_inventario m
          on m.documento_tipo = 'estampado' and m.linea_id = c.id and m.tipo = 'consumo_estampado'
       where l.orden_id = o.id
       order by c.variante_id, c.id
    loop
      perform app.mover_inventario(v_l.variante_id, o.bodega_id, 'reverso_consumo', v_l.cantidad_real,
                                   'estampado', o.id, v_l.id, v_l.costo_unitario, 'Anulación: ' || btrim(p_motivo));
    end loop;
  end if;

  update public.ordenes_estampado
     set estado = 'anulada', observaciones = concat_ws(' · ', observaciones, 'Anulada: ' || btrim(p_motivo))
   where id = o.id;
  return o.id;
end $$;
