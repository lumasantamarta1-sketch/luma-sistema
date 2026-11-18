-- =====================================================================
-- LUMA · 08 · Núcleo: inventario, costo promedio, apartados y caja
-- Toda escritura en existencias, kardex y caja pasa por estas funciones internas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ayudas de permisos
-- ---------------------------------------------------------------------
create function app.es_administrador() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfiles p
      join public.roles r on r.id = p.rol_id and r.activo
     where p.id = auth.uid() and p.activo and r.codigo = 'administrador')
$$;

create function app.exigir_bodega(p_bodega uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_bodega is null or not app.puede_ver_bodega(p_bodega) then
    raise exception 'No tienes acceso a este punto de venta.' using errcode = '42501';
  end if;
end $$;

create function app.hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Bogota')::date
$$;

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
create function app.unidades_en_transito(p_variante uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(tl.cantidad), 0)
    from public.traslado_lineas tl
    join public.traslados t on t.id = tl.traslado_id
   where t.estado = 'enviado' and tl.variante_id = p_variante
$$;

-- Bloquea el costo de varias variantes en un orden fijo para evitar bloqueos cruzados
create function app.bloquear_variantes(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.variante_costos (variante_id)
  select distinct x from unnest(p_ids) x where x is not null
  on conflict do nothing;
  perform 1 from public.variante_costos
   where variante_id = any (p_ids)
   order by variante_id
     for update;
end $$;

-- Mueve inventario: valida existencias, actualiza el costo promedio ponderado de la
-- empresa y deja el movimiento en el kardex. Devuelve el costo unitario del movimiento.
-- p_liberar: unidades apartadas que esta salida consume (entregas de ventas).
create function app.mover_inventario(
  p_variante uuid,
  p_bodega uuid,
  p_tipo text,
  p_cantidad numeric,
  p_documento_tipo text,
  p_documento_id uuid,
  p_linea_id uuid,
  p_costo numeric default null,
  p_motivo text default null,
  p_liberar numeric default 0
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_unidad text;
  v_sku text;
  v_prom numeric;
  v_ex public.existencias%rowtype;
  v_total numeric;
  v_costo numeric;
  v_nuevo numeric;
begin
  if p_cantidad is null or p_cantidad = 0 then
    raise exception 'La cantidad del movimiento no puede ser cero.';
  end if;
  p_liberar := coalesce(p_liberar, 0);
  if p_liberar < 0 or (p_liberar > 0 and p_liberar > -p_cantidad) then
    raise exception 'Cantidad apartada a liberar no válida.';
  end if;

  select p.unidad_medida, v.sku into v_unidad, v_sku
    from public.variantes v
    join public.productos p on p.id = v.producto_id
   where v.id = p_variante;
  if v_unidad is null then
    raise exception 'La variante no existe.';
  end if;
  if v_unidad = 'unidad' and p_cantidad <> trunc(p_cantidad) then
    raise exception 'Las camisetas se cuentan en unidades enteras (%).', v_sku using errcode = '22023';
  end if;

  -- Bloqueos: el costo de la variante (compartido entre puntos) y su existencia en la bodega
  insert into public.variante_costos (variante_id) values (p_variante) on conflict do nothing;
  select costo_promedio into v_prom from public.variante_costos where variante_id = p_variante for update;
  insert into public.existencias (variante_id, bodega_id) values (p_variante, p_bodega) on conflict do nothing;
  select * into v_ex from public.existencias where variante_id = p_variante and bodega_id = p_bodega for update;

  if p_cantidad < 0 then
    if v_ex.apartada < p_liberar then
      raise exception 'No hay % unidades apartadas de % para entregar.', p_liberar, v_sku using errcode = 'P0001';
    end if;
    if v_ex.cantidad - v_ex.apartada < -p_cantidad - p_liberar then
      raise exception 'Existencias insuficientes de %: hay % disponibles y se necesitan %.',
        v_sku, v_ex.cantidad - v_ex.apartada, -p_cantidad - p_liberar using errcode = 'P0001';
    end if;
  end if;

  -- Unidades de la empresa antes del movimiento, incluidas las que viajan en traslados
  select coalesce(sum(cantidad), 0) into v_total from public.existencias where variante_id = p_variante;
  v_total := v_total + app.unidades_en_transito(p_variante);

  -- Costo del movimiento
  if p_cantidad > 0 then
    if p_tipo in ('saldo_inicial', 'entrada_compra', 'entrada_estampado', 'devolucion_cliente',
                  'reverso_consumo', 'reverso_perdida') then
      if p_costo is null or p_costo < 0 then
        raise exception 'La entrada "%" necesita un costo válido.', p_tipo;
      end if;
      v_costo := p_costo;
    elsif p_tipo = 'ajuste_entrada' and p_costo is not null then
      if p_costo < 0 then
        raise exception 'El costo no puede ser negativo.';
      end if;
      v_costo := p_costo;
    else
      v_costo := v_prom;
    end if;
  else
    if p_tipo in ('perdida_estampado', 'perdida_devolucion', 'devolucion_proveedor', 'reverso_entrada')
       and p_costo is not null then
      v_costo := p_costo;
    else
      v_costo := v_prom;
    end if;
  end if;
  v_costo := round(v_costo, 4);

  -- Costo promedio ponderado. Los traslados no lo cambian.
  if p_tipo in ('traslado_salida', 'traslado_entrada') or v_costo = v_prom then
    v_nuevo := v_prom;
  elsif v_total + p_cantidad > 0 then
    v_nuevo := round((v_total * v_prom + p_cantidad * v_costo) / (v_total + p_cantidad), 4);
  else
    v_nuevo := v_prom;
  end if;
  if v_nuevo < 0 then
    raise exception 'El movimiento de % dejaría un costo promedio negativo; revisa el costo o haz un ajuste.', v_sku;
  end if;

  update public.existencias
     set cantidad = cantidad + p_cantidad,
         apartada = apartada - p_liberar,
         actualizado_en = now()
   where variante_id = p_variante and bodega_id = p_bodega
  returning * into v_ex;

  if v_nuevo <> v_prom then
    update public.variante_costos set costo_promedio = v_nuevo, actualizado_en = now()
     where variante_id = p_variante;
    insert into public.historial_costos (variante_id, costo_anterior, costo_nuevo, movimiento_tipo, documento_tipo, documento_id)
    values (p_variante, v_prom, v_nuevo, p_tipo, p_documento_tipo, p_documento_id);
  end if;
  if p_tipo in ('saldo_inicial', 'entrada_compra', 'entrada_estampado') then
    update public.variante_costos set ultimo_costo = v_costo, actualizado_en = now()
     where variante_id = p_variante;
  end if;

  insert into public.movimientos_inventario (
    variante_id, bodega_id, tipo, cantidad, costo_unitario, saldo_resultante,
    costo_promedio_resultante, motivo, documento_tipo, documento_id, linea_id)
  values (p_variante, p_bodega, p_tipo, p_cantidad, v_costo, v_ex.cantidad,
          v_nuevo, p_motivo, p_documento_tipo, p_documento_id, p_linea_id);
  return v_costo;
end $$;

-- Aparta unidades en un punto. Con p_parcial aparta lo que haya; sin él, todo o error.
-- Devuelve las unidades apartadas.
create function app.apartar(p_variante uuid, p_bodega uuid, p_cantidad numeric, p_parcial boolean default false)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_ex public.existencias%rowtype;
  v_sku text;
  v_n numeric;
begin
  if p_cantidad <= 0 then
    return 0;
  end if;
  insert into public.existencias (variante_id, bodega_id) values (p_variante, p_bodega) on conflict do nothing;
  select * into v_ex from public.existencias where variante_id = p_variante and bodega_id = p_bodega for update;
  v_n := least(p_cantidad, v_ex.cantidad - v_ex.apartada);
  if v_n < p_cantidad and not p_parcial then
    select sku into v_sku from public.variantes where id = p_variante;
    raise exception 'No hay existencias suficientes de %: disponibles %, pedidas %.',
      v_sku, v_ex.cantidad - v_ex.apartada, p_cantidad using errcode = 'P0001';
  end if;
  if v_n > 0 then
    update public.existencias
       set apartada = apartada + v_n, actualizado_en = now()
     where variante_id = p_variante and bodega_id = p_bodega;
  end if;
  return greatest(v_n, 0);
end $$;

create function app.liberar(p_variante uuid, p_bodega uuid, p_cantidad numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_cantidad > 0 then
    update public.existencias
       set apartada = apartada - p_cantidad, actualizado_en = now()
     where variante_id = p_variante and bodega_id = p_bodega;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Dinero
-- ---------------------------------------------------------------------
create function app.saldo_cuenta(p_cuenta uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when sentido = 'entrada' then valor else -valor end), 0)
    from public.movimientos_caja
   where cuenta_id = p_cuenta
$$;

create function app.mover_caja(
  p_cuenta uuid, p_sentido text, p_origen text, p_valor numeric,
  p_documento_tipo text, p_documento_id uuid, p_descripcion text default null, p_clave uuid default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text;
  v_id bigint;
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'El valor debe ser mayor que cero.';
  end if;
  select tipo into v_tipo from public.cuentas_dinero where id = p_cuenta and activo for update;
  if not found then
    raise exception 'La cuenta de dinero no existe o está inactiva.';
  end if;
  if p_sentido = 'salida' and v_tipo = 'efectivo' and app.saldo_cuenta(p_cuenta) < p_valor then
    raise exception 'El efectivo de la caja no alcanza para esta salida.' using errcode = 'P0001';
  end if;
  insert into public.movimientos_caja (cuenta_id, sentido, origen, valor, documento_tipo, documento_id, descripcion, clave)
  values (p_cuenta, p_sentido, p_origen, round(p_valor, 2), p_documento_tipo, p_documento_id, p_descripcion, p_clave)
  returning id into v_id;
  return v_id;
end $$;

-- El efectivo va a la caja del punto; los demás métodos, a su cuenta fija
create function app.cuenta_para_metodo(p_metodo uuid, p_bodega uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tipo text;
  v_cuenta uuid;
begin
  select tipo, cuenta_id into v_tipo, v_cuenta from public.metodos_pago where id = p_metodo and activo;
  if not found then
    raise exception 'Método de pago no válido.';
  end if;
  if v_tipo = 'efectivo' then
    if p_bodega is null then
      raise exception 'Para pagar en efectivo indica el punto de venta de cuya caja sale o entra el dinero.';
    end if;
    select id into v_cuenta from public.cuentas_dinero
     where tipo = 'efectivo' and bodega_id = p_bodega and activo;
    if v_cuenta is null then
      raise exception 'Este punto de venta no tiene caja de efectivo configurada.';
    end if;
  end if;
  return v_cuenta;
end $$;

-- ---------------------------------------------------------------------
-- Saldos de documentos
-- ---------------------------------------------------------------------
create function app.pagado_venta(p_venta uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when tipo = 'pago' then valor else -valor end), 0)
    from public.pagos_venta where venta_id = p_venta
$$;

create function app.devuelto_venta(p_venta uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(valor_total), 0) from public.devoluciones_venta where venta_id = p_venta
$$;

-- Lo que el cliente aún debe (negativo: saldo a su favor)
create function app.saldo_venta(p_venta uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when v.estado = 'cancelada' then 0 else v.total end
         - app.devuelto_venta(v.id) - app.pagado_venta(v.id)
    from public.ventas v where v.id = p_venta
$$;

create function app.pagado_compra(p_compra uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when tipo = 'pago' then valor else -valor end), 0)
    from public.pagos_compra where compra_id = p_compra
$$;

create function app.devuelto_compra(p_compra uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(valor_total), 0) from public.devoluciones_proveedor where compra_id = p_compra
$$;

-- Lo que se le debe al proveedor (negativo: saldo a favor de LUMA)
create function app.saldo_compra(p_compra uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when c.estado = 'anulada' then 0 else c.total end
         - app.devuelto_compra(c.id) - app.pagado_compra(c.id)
    from public.compras c where c.id = p_compra
$$;

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------

-- Totales de la venta. Con IVA activo, el impuesto va incluido en el precio.
create function app.recalcular_venta(p_venta uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pct numeric;
begin
  select case when responsable_iva then impuesto_venta_pct else 0 end into v_pct
    from public.configuracion_negocio where id = 1;
  update public.venta_lineas
     set impuesto_pct = v_pct,
         impuesto = case when v_pct > 0
                         then round((cantidad * precio_unitario - descuento)
                                    - (cantidad * precio_unitario - descuento) / (1 + v_pct / 100), 2)
                         else 0 end
   where venta_id = p_venta;
  update public.ventas v
     set subtotal = s.subtotal,
         descuentos = s.descuentos,
         impuestos = s.impuestos,
         total = s.subtotal - s.descuentos
    from (select coalesce(round(sum(cantidad * precio_unitario), 2), 0) as subtotal,
                 coalesce(sum(descuento), 0) as descuentos,
                 coalesce(sum(impuesto), 0) as impuestos
            from public.venta_lineas where venta_id = p_venta) s
   where v.id = p_venta;
end $$;

-- Un descuento autorizado aplica a la línea si está vigente y coincide con su venta y producto
create function app.descuento_aplica(p_descuento uuid, p_venta uuid, p_variante uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.descuentos_autorizados d
      join public.variantes v on v.id = p_variante
     where d.id = p_descuento and d.activo
       and (d.vigente_desde is null or app.hoy() >= d.vigente_desde)
       and (d.vigente_hasta is null or app.hoy() <= d.vigente_hasta)
       and (d.tipo = 'promocion' or d.venta_id = p_venta)
       and (d.variante_id is null or d.variante_id = v.id)
       and (d.producto_id is null or d.producto_id = v.producto_id))
$$;

-- Cada descuento debe venir de una autorización vigente del administrador y no superarla
create function app.validar_descuentos(p_venta uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r record;
begin
  if app.tiene_permiso('descuentos.autorizar') then
    return;
  end if;
  if exists (select 1 from public.venta_lineas
              where venta_id = p_venta and descuento > 0 and descuento_autorizado_id is null) then
    raise exception 'Hay un descuento que el administrador no ha autorizado.' using errcode = '42501';
  end if;
  if exists (select 1 from public.venta_lineas
              where venta_id = p_venta and descuento > 0
                and not app.descuento_aplica(descuento_autorizado_id, p_venta, variante_id)) then
    raise exception 'Un descuento autorizado no está vigente o no aplica a esta venta.' using errcode = '42501';
  end if;
  for v_r in
    select d.id, d.nombre,
           sum(l.descuento) as aplicado,
           case when d.porcentaje is not null then sum(round(l.cantidad * l.precio_unitario * d.porcentaje / 100, 2))
                when d.valor_por_unidad is not null then sum(round(l.cantidad * d.valor_por_unidad, 2))
                else max(d.valor_total) end as permitido
      from public.venta_lineas l
      join public.descuentos_autorizados d on d.id = l.descuento_autorizado_id
     where l.venta_id = p_venta and l.descuento > 0
     group by d.id, d.nombre
  loop
    if v_r.aplicado > v_r.permitido then
      raise exception 'El descuento «%» supera lo autorizado: máximo %.', v_r.nombre, v_r.permitido
        using errcode = '42501';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Estampado
-- ---------------------------------------------------------------------

-- Consumo teórico de una camiseta terminada: su camiseta base y la receta de su diseño
create function app.consumos_teoricos(p_variante uuid, p_cantidad numeric)
returns table (variante_id uuid, cantidad numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_base uuid;
  v_diseno uuid;
  v_talla uuid;
  v_sku text;
  v_clase text;
begin
  select v.variante_base_id, v.diseno_id, v.talla_id, v.sku, v.clase
    into v_base, v_diseno, v_talla, v_sku, v_clase
    from public.variantes v where v.id = p_variante;
  if v_clase is distinct from 'terminado' then
    raise exception 'Solo se estampan camisetas terminadas.';
  end if;
  if v_base is null then
    raise exception 'La variante % no tiene camiseta base del mismo tipo, talla y color.', v_sku;
  end if;
  return query select v_base, p_cantidad;
  if v_diseno is not null then
    return query
      select dm.material_id, round(p_cantidad * dm.cantidad, 3)
        from public.diseno_materiales dm
       where dm.diseno_id = v_diseno
         and (dm.talla_id = v_talla
              or (dm.talla_id is null and not exists (
                    select 1 from public.diseno_materiales x
                     where x.diseno_id = dm.diseno_id and x.material_id = dm.material_id
                       and x.talla_id = v_talla)));
  end if;
end $$;

-- Agrega una línea a una orden con sus consumos teóricos
create function app.agregar_linea_orden(p_orden uuid, p_variante uuid, p_cantidad numeric, p_venta_linea uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_linea uuid;
begin
  insert into public.orden_estampado_lineas (orden_id, variante_id, cantidad_planeada, venta_linea_id)
  values (p_orden, p_variante, p_cantidad, p_venta_linea)
  returning id into v_linea;
  insert into public.orden_estampado_consumos (linea_id, variante_id, cantidad_teorica)
  select v_linea, c.variante_id, sum(c.cantidad)
    from app.consumos_teoricos(p_variante, p_cantidad) c
   group by c.variante_id;
  return v_linea;
end $$;

-- Orden de estampado para las unidades de la venta que faltan por estampar.
-- Devuelve null si no falta ninguna.
create function app.crear_orden_desde_venta(p_venta uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_orden uuid;
  v_bodega uuid;
  v_l record;
begin
  select bodega_id into v_bodega from public.ventas where id = p_venta;
  for v_l in
    select l.id, l.variante_id,
           l.cantidad - l.cantidad_apartada
           - coalesce((select sum(ol.cantidad_planeada)
                         from public.orden_estampado_lineas ol
                         join public.ordenes_estampado o on o.id = ol.orden_id and o.estado = 'borrador'
                        where ol.venta_linea_id = l.id), 0) as faltan
      from public.venta_lineas l
     where l.venta_id = p_venta and l.estado = 'por_estampar'
     order by l.id
  loop
    continue when v_l.faltan <= 0;
    if v_orden is null then
      insert into public.ordenes_estampado (numero, bodega_id, venta_id, observaciones)
      values (app.siguiente_numero('estampado'), v_bodega, p_venta, 'Pedido personalizado')
      returning id into v_orden;
    end if;
    perform app.agregar_linea_orden(v_orden, v_l.variante_id, v_l.faltan, v_l.id);
  end loop;
  return v_orden;
end $$;
