-- =====================================================================
-- LUMA · 17 · Ajuste de ventas: un descuento puntual por valor total se reparte
-- entre todas las líneas de la venta (antes solo alcanzaba la primera).
-- =====================================================================

create or replace function public.guardar_cotizacion(p_venta uuid, p_datos jsonb) returns uuid
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
      -- Lo que queda de un valor total se guarda antes de topar por la línea: así se reparte entre varias
      v_desc := least(case when v_l ? 'descuento' then (v_l ->> 'descuento')::numeric else v_max end,
                      v_max, round(v_cant * v_precio, 2));
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
