-- =====================================================================
-- LUMA · 11 · Traslados, ajustes, gastos, caja y usuarios
-- =====================================================================

-- ---------------------------------------------------------------------
-- Traslados entre puntos: salen del origen al enviarse y entran al destino al recibirse
-- ---------------------------------------------------------------------

-- p_datos: {origen_id, destino_id, observaciones, lineas: [{variante_id, cantidad}]}
create function public.guardar_traslado(p_traslado uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.traslados%rowtype;
  v_l jsonb;
  v_origen uuid := nullif(p_datos ->> 'origen_id', '')::uuid;
  v_destino uuid := nullif(p_datos ->> 'destino_id', '')::uuid;
  v_var record;
  v_cant numeric;
begin
  perform app.exigir_permiso('traslados.gestionar');
  perform app.exigir_bodega(v_origen);
  if not exists (select 1 from public.bodegas where id = v_destino and activo) then
    raise exception 'Elige un punto de destino activo.';
  end if;
  if v_origen = v_destino then
    raise exception 'El origen y el destino deben ser distintos.';
  end if;
  if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' or jsonb_array_length(p_datos -> 'lineas') = 0 then
    raise exception 'Agrega al menos un producto al traslado.';
  end if;

  if p_traslado is null then
    insert into public.traslados (numero, origen_id, destino_id, observaciones)
    values (app.siguiente_numero('traslado'), v_origen, v_destino, nullif(btrim(p_datos ->> 'observaciones'), ''))
    returning * into t;
  else
    select * into t from public.traslados where id = p_traslado for update;
    if not found then
      raise exception 'El traslado no existe.';
    end if;
    perform app.exigir_bodega(t.origen_id);
    if t.estado <> 'borrador' then
      raise exception 'Solo se editan traslados en borrador.';
    end if;
    update public.traslados
       set origen_id = v_origen, destino_id = v_destino,
           observaciones = nullif(btrim(p_datos ->> 'observaciones'), '')
     where id = t.id
    returning * into t;
    delete from public.traslado_lineas where traslado_id = t.id;
  end if;

  for v_l in select * from jsonb_array_elements(p_datos -> 'lineas') loop
    select va.id, va.sku, va.activo, p.unidad_medida into v_var
      from public.variantes va join public.productos p on p.id = va.producto_id
     where va.id = nullif(v_l ->> 'variante_id', '')::uuid;
    if v_var.id is null then
      raise exception 'Uno de los productos no existe.';
    end if;
    v_cant := (v_l ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 or (v_var.unidad_medida = 'unidad' and v_cant <> trunc(v_cant)) then
      raise exception 'Cantidad no válida para %.', v_var.sku;
    end if;
    insert into public.traslado_lineas (traslado_id, variante_id, cantidad)
    values (t.id, v_var.id, v_cant)
    on conflict (traslado_id, variante_id) do update set cantidad = public.traslado_lineas.cantidad + excluded.cantidad;
  end loop;
  return t.id;
end $$;

create function public.enviar_traslado(p_traslado uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.traslados%rowtype;
  v_l record;
begin
  perform app.exigir_permiso('traslados.gestionar');
  select * into t from public.traslados where id = p_traslado for update;
  if not found then
    raise exception 'El traslado no existe.';
  end if;
  perform app.exigir_bodega(t.origen_id);
  if t.estado in ('enviado', 'recibido') then
    return t.id;
  elsif t.estado <> 'borrador' then
    raise exception 'El traslado está anulado.';
  end if;
  perform app.bloquear_variantes(array(select variante_id from public.traslado_lineas where traslado_id = t.id));
  for v_l in select * from public.traslado_lineas where traslado_id = t.id order by variante_id loop
    perform app.mover_inventario(v_l.variante_id, t.origen_id, 'traslado_salida', -v_l.cantidad,
                                 'traslado', t.id, v_l.id, null, 'Traslado ' || t.numero);
  end loop;
  update public.traslados set estado = 'enviado', enviado_por = auth.uid(), enviado_en = now() where id = t.id;
  return t.id;
end $$;

create function public.recibir_traslado(p_traslado uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.traslados%rowtype;
  v_l record;
begin
  perform app.exigir_permiso('traslados.gestionar');
  select * into t from public.traslados where id = p_traslado for update;
  if not found then
    raise exception 'El traslado no existe.';
  end if;
  perform app.exigir_bodega(t.destino_id);
  if t.estado = 'recibido' then
    return t.id;
  elsif t.estado <> 'enviado' then
    raise exception 'Solo se reciben traslados enviados.';
  end if;
  perform app.bloquear_variantes(array(select variante_id from public.traslado_lineas where traslado_id = t.id));
  for v_l in select * from public.traslado_lineas where traslado_id = t.id order by variante_id loop
    perform app.mover_inventario(v_l.variante_id, t.destino_id, 'traslado_entrada', v_l.cantidad,
                                 'traslado', t.id, v_l.id, null, 'Traslado ' || t.numero);
  end loop;
  update public.traslados set estado = 'recibido', recibido_por = auth.uid(), recibido_en = now() where id = t.id;
  return t.id;
end $$;

-- Un traslado enviado y no recibido se anula devolviendo las unidades al origen
create function public.anular_traslado(p_traslado uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.traslados%rowtype;
  v_l record;
begin
  perform app.exigir_permiso('traslados.gestionar');
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Escribe el motivo de la anulación.';
  end if;
  select * into t from public.traslados where id = p_traslado for update;
  if not found then
    raise exception 'El traslado no existe.';
  end if;
  perform app.exigir_bodega(t.origen_id);
  if t.estado = 'anulado' then
    return t.id;
  elsif t.estado = 'recibido' then
    raise exception 'El traslado ya se recibió; haz un traslado de regreso.';
  elsif t.estado = 'enviado' then
    perform app.bloquear_variantes(array(select variante_id from public.traslado_lineas where traslado_id = t.id));
    for v_l in select * from public.traslado_lineas where traslado_id = t.id order by variante_id loop
      perform app.mover_inventario(v_l.variante_id, t.origen_id, 'traslado_entrada', v_l.cantidad,
                                   'traslado', t.id, v_l.id, null, 'Anulación de ' || t.numero);
    end loop;
  end if;
  update public.traslados
     set estado = 'anulado', observaciones = concat_ws(' · ', observaciones, 'Anulado: ' || btrim(p_motivo))
   where id = t.id;
  return t.id;
end $$;

-- ---------------------------------------------------------------------
-- Ajustes, pérdidas y saldo inicial. Se aplican al aprobarse.
-- ---------------------------------------------------------------------
create function app.aplicar_ajuste(p_ajuste uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.ajustes_inventario%rowtype;
  v_l record;
begin
  select * into a from public.ajustes_inventario where id = p_ajuste;
  perform app.bloquear_variantes(array(select variante_id from public.ajuste_lineas where ajuste_id = a.id));
  for v_l in select * from public.ajuste_lineas where ajuste_id = a.id order by variante_id loop
    perform app.mover_inventario(
      v_l.variante_id, a.bodega_id,
      case when a.tipo = 'saldo_inicial' then 'saldo_inicial'
           when a.tipo = 'perdida' then 'perdida'
           when v_l.cantidad > 0 then 'ajuste_entrada'
           else 'ajuste_salida' end,
      v_l.cantidad, 'ajuste', a.id, v_l.id, v_l.costo_unitario, a.motivo);
  end loop;
end $$;

-- p_datos: {bodega_id, tipo: ajuste|perdida|saldo_inicial, motivo,
--           lineas: [{variante_id, cantidad, costo_unitario?}]}
-- En "ajuste" la cantidad lleva signo; en "perdida" y "saldo_inicial" es positiva.
create function public.solicitar_ajuste(p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.ajustes_inventario%rowtype;
  v_tipo text := p_datos ->> 'tipo';
  v_bodega uuid := nullif(p_datos ->> 'bodega_id', '')::uuid;
  v_motivo text := btrim(coalesce(p_datos ->> 'motivo', ''));
  v_l jsonb;
  v_var record;
  v_cant numeric;
  v_costo numeric;
  v_valor numeric := 0;
  v_umbral numeric;
  v_ve_costos boolean := app.tiene_permiso('costos.ver');
begin
  perform app.exigir_permiso('inventario.ajustar');
  perform app.exigir_bodega(v_bodega);
  if v_tipo is null or v_tipo not in ('ajuste', 'perdida', 'saldo_inicial') then
    raise exception 'Tipo de ajuste no válido.';
  end if;
  if length(v_motivo) = 0 then
    raise exception 'Escribe el motivo del ajuste.';
  end if;
  if v_tipo = 'saldo_inicial' and not v_ve_costos then
    raise exception 'El saldo inicial lleva costos; lo registra quien tiene permiso de ver costos.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_datos -> 'lineas') is distinct from 'array' or jsonb_array_length(p_datos -> 'lineas') = 0 then
    raise exception 'Agrega al menos un producto al ajuste.';
  end if;

  insert into public.ajustes_inventario (numero, bodega_id, tipo, motivo)
  values (app.siguiente_numero('ajuste'), v_bodega, v_tipo, v_motivo)
  returning * into a;

  for v_l in select * from jsonb_array_elements(p_datos -> 'lineas') loop
    select va.id, va.sku, p.unidad_medida, coalesce(vc.costo_promedio, 0) as promedio into v_var
      from public.variantes va
      join public.productos p on p.id = va.producto_id
      left join public.variante_costos vc on vc.variante_id = va.id
     where va.id = nullif(v_l ->> 'variante_id', '')::uuid;
    if v_var.id is null then
      raise exception 'Uno de los productos no existe.';
    end if;
    v_cant := (v_l ->> 'cantidad')::numeric;
    if v_cant is null or v_cant = 0 or (v_tipo <> 'ajuste' and v_cant < 0) then
      raise exception 'Cantidad no válida para %.', v_var.sku;
    end if;
    if v_var.unidad_medida = 'unidad' and v_cant <> trunc(v_cant) then
      raise exception 'Las camisetas se cuentan en unidades enteras (%).', v_var.sku;
    end if;
    if v_tipo = 'perdida' then
      v_cant := -v_cant;
    end if;
    v_costo := null;
    if v_ve_costos and v_cant > 0 and nullif(v_l ->> 'costo_unitario', '') is not null then
      v_costo := (v_l ->> 'costo_unitario')::numeric;
      if v_costo < 0 then
        raise exception 'El costo no puede ser negativo.';
      end if;
    end if;
    if v_tipo = 'saldo_inicial' and v_costo is null then
      raise exception 'Indica el costo unitario de % para el saldo inicial.', v_var.sku;
    end if;
    insert into public.ajuste_lineas (ajuste_id, variante_id, cantidad, costo_unitario)
    values (a.id, v_var.id, v_cant, v_costo);
    v_valor := v_valor + abs(v_cant) * coalesce(v_costo, v_var.promedio);
  end loop;

  update public.ajustes_inventario set valor_estimado = round(v_valor, 2) where id = a.id;
  select umbral_aprobacion_ajuste into v_umbral from public.configuracion_negocio where id = 1;
  -- Se aplica de una vez si lo hace el administrador o si no supera el umbral
  if app.es_administrador() or round(v_valor, 2) <= v_umbral then
    perform app.aplicar_ajuste(a.id);
    update public.ajustes_inventario
       set estado = 'aprobado', resuelto_por = auth.uid(), resuelto_en = now()
     where id = a.id;
  end if;
  return a.id;
end $$;

create function public.resolver_ajuste(p_ajuste uuid, p_aprobar boolean, p_observacion text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.ajustes_inventario%rowtype;
begin
  perform app.exigir_permiso('inventario.aprobar_ajuste');
  select * into a from public.ajustes_inventario where id = p_ajuste for update;
  if not found then
    raise exception 'El ajuste no existe.';
  end if;
  perform app.exigir_bodega(a.bodega_id);
  if a.estado <> 'pendiente' then
    raise exception 'El ajuste ya fue %.', a.estado;
  end if;
  if a.solicitado_por = auth.uid() and not app.es_administrador() then
    raise exception 'Nadie aprueba su propio ajuste, salvo el administrador.' using errcode = '42501';
  end if;
  if not p_aprobar and length(btrim(coalesce(p_observacion, ''))) = 0 then
    raise exception 'Escribe por qué se rechaza el ajuste.';
  end if;
  if p_aprobar then
    perform app.aplicar_ajuste(a.id);
  end if;
  update public.ajustes_inventario
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
         resuelto_por = auth.uid(), resuelto_en = now(),
         observacion = nullif(btrim(p_observacion), '')
   where id = a.id;
  return a.id;
end $$;

-- ---------------------------------------------------------------------
-- Gastos: un gasto pendiente cuenta en el resultado, pero no sale de caja hasta pagarse
-- ---------------------------------------------------------------------
create function app.pagar_gasto_int(p_gasto uuid, p_metodo uuid, p_referencia text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.gastos%rowtype;
  v_cuenta uuid;
  v_bodega_cuenta uuid;
begin
  select * into g from public.gastos where id = p_gasto;
  v_cuenta := app.cuenta_para_metodo(p_metodo, g.bodega_id);
  select bodega_id into v_bodega_cuenta from public.cuentas_dinero where id = v_cuenta;
  if v_bodega_cuenta is not null then
    perform app.exigir_bodega(v_bodega_cuenta);
  end if;
  update public.gastos
     set estado = 'pagado', metodo_pago_id = p_metodo, cuenta_id = v_cuenta, pagado_en = now()
   where id = g.id;
  perform app.mover_caja(v_cuenta, 'salida', 'pago_gasto', g.valor, 'gasto', g.id,
                         concat_ws(' · ', 'Gasto ' || g.numero, nullif(btrim(p_referencia), '')));
end $$;

-- p_datos: {fecha, categoria_id, descripcion, proveedor_id, beneficiario, valor, bodega_id,
--           pagado, metodo_pago_id, referencia, clave}
create function public.registrar_gasto(p_datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  g public.gastos%rowtype;
  v_clave uuid := nullif(p_datos ->> 'clave', '')::uuid;
  v_cat public.categorias_gasto%rowtype;
  v_bodega uuid := nullif(p_datos ->> 'bodega_id', '')::uuid;
  v_valor numeric := (p_datos ->> 'valor')::numeric;
  v_id uuid;
begin
  perform app.exigir_permiso('gastos.registrar');
  if v_clave is not null then
    select id into v_id from public.gastos where clave = v_clave;
    if found then
      return v_id;
    end if;
  end if;
  if v_bodega is not null then
    perform app.exigir_bodega(v_bodega);
  end if;
  select * into v_cat from public.categorias_gasto where id = nullif(p_datos ->> 'categoria_id', '')::uuid and activo;
  if v_cat.id is null then
    raise exception 'Elige una categoría de gasto activa.';
  end if;
  if v_cat.tipo = 'mercancia' then
    raise exception 'La categoría «%» es de mercancía: regístrala en Compras para que entre al inventario.', v_cat.nombre;
  end if;
  if v_valor is null or v_valor <= 0 then
    raise exception 'El valor del gasto debe ser mayor que cero.';
  end if;
  insert into public.gastos (numero, fecha, categoria_id, descripcion, proveedor_id, beneficiario, valor, bodega_id, clave)
  values (app.siguiente_numero('gasto'), coalesce(nullif(p_datos ->> 'fecha', '')::date, app.hoy()), v_cat.id,
          btrim(coalesce(p_datos ->> 'descripcion', '')), nullif(p_datos ->> 'proveedor_id', '')::uuid,
          nullif(btrim(p_datos ->> 'beneficiario'), ''), round(v_valor, 2), v_bodega, v_clave)
  returning * into g;
  if coalesce((p_datos ->> 'pagado')::boolean, false) then
    if nullif(p_datos ->> 'metodo_pago_id', '') is null then
      raise exception 'Indica con qué método se pagó el gasto.';
    end if;
    perform app.pagar_gasto_int(g.id, (p_datos ->> 'metodo_pago_id')::uuid, p_datos ->> 'referencia');
  end if;
  return g.id;
end $$;

create function public.pagar_gasto(p_gasto uuid, p_metodo uuid, p_referencia text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  g public.gastos%rowtype;
begin
  perform app.exigir_permiso('gastos.pagar');
  select * into g from public.gastos where id = p_gasto for update;
  if not found then
    raise exception 'El gasto no existe.';
  end if;
  if g.bodega_id is not null then
    perform app.exigir_bodega(g.bodega_id);
  end if;
  if g.estado = 'pagado' then
    return g.id;
  elsif g.estado = 'anulado' then
    raise exception 'El gasto está anulado.';
  end if;
  perform app.pagar_gasto_int(g.id, p_metodo, p_referencia);
  return g.id;
end $$;

-- Anular un gasto pagado devuelve el dinero a su cuenta con un movimiento a la vista
create function public.anular_gasto(p_gasto uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  g public.gastos%rowtype;
begin
  perform app.exigir_permiso('gastos.anular');
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Escribe el motivo de la anulación.';
  end if;
  select * into g from public.gastos where id = p_gasto for update;
  if not found then
    raise exception 'El gasto no existe.';
  end if;
  if g.bodega_id is not null then
    perform app.exigir_bodega(g.bodega_id);
  end if;
  if g.estado = 'anulado' then
    return g.id;
  end if;
  if g.estado = 'pagado' then
    perform app.mover_caja(g.cuenta_id, 'entrada', 'anulacion', g.valor, 'gasto', g.id,
                           'Anulación de ' || g.numero || ': ' || btrim(p_motivo));
  end if;
  update public.gastos
     set estado = 'anulado', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = g.id;
  return g.id;
end $$;

-- Crea, una sola vez por periodo, el gasto pendiente de cada plantilla recurrente activa
create function public.generar_gastos_recurrentes(p_fecha date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_fecha date := coalesce(p_fecha, app.hoy());
  r public.gastos_recurrentes%rowtype;
  v_periodo text;
  v_fecha_gasto date;
  v_n integer := 0;
begin
  perform app.exigir_permiso('gastos.registrar');
  perform pg_advisory_xact_lock(hashtext('luma.gastos_recurrentes'));
  for r in select * from public.gastos_recurrentes where activo order by nombre loop
    if r.frecuencia = 'mensual' then
      v_periodo := to_char(v_fecha, 'YYYY-MM');
      v_fecha_gasto := least(date_trunc('month', v_fecha)::date + (coalesce(r.dia, 1) - 1),
                             (date_trunc('month', v_fecha) + interval '1 month - 1 day')::date);
    elsif r.frecuencia = 'quincenal' then
      v_periodo := to_char(v_fecha, 'YYYY-MM') || case when extract(day from v_fecha) <= 15 then '-1' else '-2' end;
      v_fecha_gasto := date_trunc('month', v_fecha)::date + case when extract(day from v_fecha) <= 15 then 0 else 15 end;
    else
      v_periodo := to_char(v_fecha, 'IYYY-"S"IW');
      v_fecha_gasto := date_trunc('week', v_fecha)::date;
    end if;
    if not exists (select 1 from public.gastos where recurrente_id = r.id and periodo = v_periodo) then
      insert into public.gastos (numero, fecha, categoria_id, descripcion, proveedor_id, beneficiario, valor,
                                 recurrente_id, periodo)
      values (app.siguiente_numero('gasto'), v_fecha_gasto, r.categoria_id, r.nombre, r.proveedor_id,
              r.beneficiario, r.valor, r.id, v_periodo);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Caja: aportes, retiros y traslados entre cuentas; cierre por punto
-- ---------------------------------------------------------------------
create function public.movimiento_caja(
  p_tipo text, p_cuenta uuid, p_valor numeric, p_descripcion text, p_clave uuid, p_cuenta_destino uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_b uuid;
begin
  perform app.exigir_permiso('caja.gestionar');
  if p_clave is null then
    raise exception 'Falta la clave del movimiento.';
  end if;
  if exists (select 1 from public.movimientos_caja where clave = p_clave) then
    return;
  end if;
  if length(btrim(coalesce(p_descripcion, ''))) = 0 then
    raise exception 'Describe el movimiento.';
  end if;
  select bodega_id into v_b from public.cuentas_dinero where id = p_cuenta;
  if v_b is not null then
    perform app.exigir_bodega(v_b);
  end if;
  if p_tipo = 'aporte' then
    perform app.mover_caja(p_cuenta, 'entrada', 'aporte', p_valor, null, null, btrim(p_descripcion), p_clave);
  elsif p_tipo = 'retiro' then
    perform app.mover_caja(p_cuenta, 'salida', 'retiro', p_valor, null, null, btrim(p_descripcion), p_clave);
  elsif p_tipo = 'saldo_inicial' then
    if exists (select 1 from public.movimientos_caja where cuenta_id = p_cuenta) then
      raise exception 'El saldo inicial solo se registra en una cuenta sin movimientos.';
    end if;
    perform app.mover_caja(p_cuenta, 'entrada', 'saldo_inicial', p_valor, null, null, btrim(p_descripcion), p_clave);
  elsif p_tipo = 'traslado' then
    if p_cuenta_destino is null or p_cuenta_destino = p_cuenta then
      raise exception 'Elige una cuenta de destino distinta.';
    end if;
    select bodega_id into v_b from public.cuentas_dinero where id = p_cuenta_destino;
    if v_b is not null then
      perform app.exigir_bodega(v_b);
    end if;
    -- Bloqueo en orden fijo de las dos cuentas
    perform 1 from public.cuentas_dinero where id in (p_cuenta, p_cuenta_destino) order by id for update;
    perform app.mover_caja(p_cuenta, 'salida', 'traslado', p_valor, null, null, btrim(p_descripcion), p_clave);
    perform app.mover_caja(p_cuenta_destino, 'entrada', 'traslado', p_valor, null, null, btrim(p_descripcion), p_clave);
  else
    raise exception 'Tipo de movimiento no válido.';
  end if;
end $$;

create function public.cerrar_caja(p_cuenta uuid, p_contado numeric, p_justificacion text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cuentas_dinero%rowtype;
  v_esperado numeric;
  v_id uuid;
begin
  perform app.exigir_permiso('caja.cerrar');
  select * into c from public.cuentas_dinero where id = p_cuenta for update;
  if not found or c.tipo <> 'efectivo' then
    raise exception 'El cierre se hace sobre la caja de efectivo de un punto.';
  end if;
  perform app.exigir_bodega(c.bodega_id);
  if p_contado is null or p_contado < 0 then
    raise exception 'Indica el efectivo contado.';
  end if;
  if exists (select 1 from public.cierres_caja where cuenta_id = c.id and fecha = app.hoy()) then
    raise exception 'Esta caja ya tiene cierre hoy.';
  end if;
  v_esperado := app.saldo_cuenta(c.id);
  if round(p_contado, 2) <> v_esperado and length(btrim(coalesce(p_justificacion, ''))) = 0 then
    raise exception 'Hay una diferencia de %; escribe la justificación.', round(p_contado, 2) - v_esperado;
  end if;
  insert into public.cierres_caja (cuenta_id, fecha, saldo_esperado, saldo_contado, justificacion)
  values (c.id, app.hoy(), v_esperado, round(p_contado, 2), nullif(btrim(p_justificacion), ''))
  returning id into v_id;
  if round(p_contado, 2) <> v_esperado then
    perform app.mover_caja(c.id, case when p_contado > v_esperado then 'entrada' else 'salida' end,
                           'ajuste_cierre', abs(round(p_contado, 2) - v_esperado), 'cierre_caja', v_id,
                           'Diferencia de cierre: ' || btrim(p_justificacion));
  end if;
  return v_id;
end $$;

-- Cada punto de venta nuevo recibe su caja de efectivo
create function app.crear_caja_punto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo = 'punto_venta' and not exists (
       select 1 from public.cuentas_dinero where bodega_id = new.id and tipo = 'efectivo' and activo) then
    insert into public.cuentas_dinero (nombre, tipo, bodega_id)
    values ('Caja ' || new.nombre, 'efectivo', new.id);
  end if;
  return null;
end $$;

create trigger bodegas_crear_caja
  after insert or update of tipo on public.bodegas
  for each row execute function app.crear_caja_punto();

-- ---------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------

-- p_datos: {nombre?, rol_id?, activo?, debe_cambiar_clave?, bodegas?: [uuid]}
create function public.asignar_usuario(p_usuario uuid, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_permiso('usuarios.gestionar');
  if not exists (select 1 from public.perfiles where id = p_usuario) then
    raise exception 'El usuario no existe.';
  end if;
  update public.perfiles
     set nombre = case when p_datos ? 'nombre' then btrim(p_datos ->> 'nombre') else nombre end,
         rol_id = case when p_datos ? 'rol_id' then nullif(p_datos ->> 'rol_id', '')::uuid else rol_id end,
         activo = case when p_datos ? 'activo' then (p_datos ->> 'activo')::boolean else activo end,
         debe_cambiar_clave = case when p_datos ? 'debe_cambiar_clave'
                                   then (p_datos ->> 'debe_cambiar_clave')::boolean else debe_cambiar_clave end,
         actualizado_en = now()
   where id = p_usuario;
  if jsonb_typeof(p_datos -> 'bodegas') = 'array' then
    delete from public.usuario_bodegas
     where usuario_id = p_usuario
       and bodega_id not in (select (x #>> '{}')::uuid from jsonb_array_elements(p_datos -> 'bodegas') x);
    insert into public.usuario_bodegas (usuario_id, bodega_id)
    select p_usuario, (x #>> '{}')::uuid from jsonb_array_elements(p_datos -> 'bodegas') x
    on conflict do nothing;
  end if;
end $$;

create function public.actualizar_mi_perfil(p_nombre text default null, p_clave_cambiada boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.usuario_activo() then
    raise exception 'Tu usuario no está activo.' using errcode = '42501';
  end if;
  update public.perfiles
     set nombre = coalesce(nullif(btrim(p_nombre), ''), nombre),
         debe_cambiar_clave = case when p_clave_cambiada then false else debe_cambiar_clave end,
         actualizado_en = now()
   where id = auth.uid();
end $$;

-- Arranque: solo se ejecuta desde el SQL del proyecto, nunca desde la aplicación
create function app.promover_administrador(p_correo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update public.perfiles
     set rol_id = (select id from public.roles where codigo = 'administrador'), activo = true,
         actualizado_en = now()
   where lower(correo) = lower(btrim(p_correo))
  returning id into v_id;
  if v_id is null then
    raise exception 'No hay un usuario con el correo %. Créalo primero en Authentication.', p_correo;
  end if;
  return v_id;
end $$;
