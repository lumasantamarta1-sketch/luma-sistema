-- =====================================================================
-- LUMA · 13 · Seguridad: privilegios, RLS, auditoría y reglas fijas
-- Quien llame a la base de datos directamente solo obtiene lo que su rol permite.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Privilegios. "anon" no tiene acceso a nada. "authenticated" lee lo que RLS le deje
--    y solo escribe directo en datos maestros; documentos y libros pasan por funciones.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- Las políticas RLS llaman estas funciones con el usuario que consulta
grant execute on function app.tiene_permiso(text), app.puede_ver_bodega(uuid), app.usuario_activo()
  to authenticated;

-- Columnas con costos que no se leen desde la tabla (ver detalle_costos)
revoke select on public.ordenes_estampado, public.ajustes_inventario, public.ajuste_lineas from authenticated;
grant select (id, numero, bodega_id, venta_id, estado, observaciones, creado_por, creado_en, terminado_por, terminado_en)
  on public.ordenes_estampado to authenticated;
grant select (id, numero, bodega_id, tipo, motivo, estado, solicitado_por, solicitado_en, resuelto_por, resuelto_en,
              observacion)
  on public.ajustes_inventario to authenticated;
grant select (id, ajuste_id, variante_id, cantidad) on public.ajuste_lineas to authenticated;

-- Escritura directa en datos maestros, solo en las columnas que se pueden cambiar
grant update (nombre_comercial, eslogan, logo_ruta, colores, moneda, zona_horaria, responsable_iva,
              impuesto_venta_pct, permite_venta_bajo_pedido, anticipo_minimo_pct, umbral_aprobacion_ajuste,
              umbral_pocas_unidades, dias_sin_movimiento, minutos_inactividad, actualizado_en)
  on public.configuracion_negocio to authenticated;
grant update (prefijo) on public.consecutivos to authenticated;
grant insert on public.roles to authenticated;
grant update (nombre, descripcion, activo) on public.roles to authenticated;
grant insert, delete on public.rol_permisos to authenticated;

grant insert on public.categorias, public.tallas, public.colores, public.tipos_camiseta, public.disenos,
                public.productos, public.variantes, public.diseno_materiales to authenticated;
grant update (nombre, activo) on public.categorias, public.tipos_camiseta to authenticated;
grant update (nombre, orden, activo) on public.tallas to authenticated;
grant update (nombre, hex, activo) on public.colores to authenticated;
grant update (codigo, nombre, descripcion, imagen_ruta, activo) on public.disenos to authenticated;
grant update (codigo, nombre, categoria_id, descripcion, foto_ruta, se_vende, por_pedido, activo)
  on public.productos to authenticated;
grant update (sku, referencia, precio_venta, stock_minimo, activo) on public.variantes to authenticated;
grant update (cantidad), delete on public.diseno_materiales to authenticated;

grant insert on public.bodegas, public.cuentas_dinero, public.metodos_pago, public.impuestos to authenticated;
grant update (codigo, nombre, tipo, direccion, activo) on public.bodegas to authenticated;
grant update (nombre, activo) on public.cuentas_dinero to authenticated;
grant update (nombre, cuenta_id, activo) on public.metodos_pago to authenticated;
grant update (nombre, porcentaje, activo) on public.impuestos to authenticated;

grant insert on public.clientes, public.proveedores to authenticated;
grant update (nombre, documento, telefono, whatsapp, correo, ciudad, direccion, activo) on public.clientes to authenticated;
grant update (nombre, identificacion_tributaria, contacto, telefono, correo, direccion, observaciones, activo)
  on public.proveedores to authenticated;

grant insert on public.categorias_gasto, public.gastos_recurrentes, public.descuentos_autorizados to authenticated;
grant update (nombre, activo) on public.categorias_gasto to authenticated;
grant update (nombre, categoria_id, proveedor_id, beneficiario, valor, frecuencia, dia, activo)
  on public.gastos_recurrentes to authenticated;
grant update (nombre, vigente_desde, vigente_hasta, activo) on public.descuentos_autorizados to authenticated;

grant insert on public.adjuntos to authenticated;

-- ---------------------------------------------------------------------
-- 2. RLS en todas las tablas. Una tabla sin política no se puede leer.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Configuración, seguridad y catálogos de apoyo
create policy configuracion_ver on public.configuracion_negocio for select to authenticated
  using ((select app.usuario_activo()));
create policy configuracion_editar on public.configuracion_negocio for update to authenticated
  using ((select app.tiene_permiso('configuracion.gestionar')))
  with check ((select app.tiene_permiso('configuracion.gestionar')));

create policy roles_ver on public.roles for select to authenticated using ((select app.usuario_activo()));
create policy roles_crear on public.roles for insert to authenticated
  with check ((select app.tiene_permiso('usuarios.gestionar')) and not es_sistema);
create policy roles_editar on public.roles for update to authenticated
  using ((select app.tiene_permiso('usuarios.gestionar')))
  with check ((select app.tiene_permiso('usuarios.gestionar')));
create policy permisos_ver on public.permisos for select to authenticated using ((select app.usuario_activo()));
create policy rol_permisos_ver on public.rol_permisos for select to authenticated using ((select app.usuario_activo()));
create policy rol_permisos_crear on public.rol_permisos for insert to authenticated
  with check ((select app.tiene_permiso('usuarios.gestionar')));
create policy rol_permisos_borrar on public.rol_permisos for delete to authenticated
  using ((select app.tiene_permiso('usuarios.gestionar')));

create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select app.tiene_permiso('usuarios.gestionar')));
create policy usuario_bodegas_ver on public.usuario_bodegas for select to authenticated
  using (usuario_id = (select auth.uid()) or (select app.tiene_permiso('usuarios.gestionar')));

create policy consecutivos_ver on public.consecutivos for select to authenticated
  using ((select app.tiene_permiso('configuracion.gestionar')));
create policy consecutivos_editar on public.consecutivos for update to authenticated
  using ((select app.tiene_permiso('configuracion.gestionar')))
  with check ((select app.tiene_permiso('configuracion.gestionar')));

create policy auditoria_ver on public.auditoria for select to authenticated
  using ((select app.tiene_permiso('auditoria.ver')));

-- Catálogo
do $$
declare
  t text;
begin
  foreach t in array array['categorias', 'tallas', 'colores', 'tipos_camiseta', 'disenos', 'productos'] loop
    execute format($f$create policy %1$s_ver on public.%1$I for select to authenticated
                      using ((select app.tiene_permiso('catalogo.ver')))$f$, t);
    execute format($f$create policy %1$s_crear on public.%1$I for insert to authenticated
                      with check ((select app.tiene_permiso('catalogo.gestionar')))$f$, t);
    execute format($f$create policy %1$s_editar on public.%1$I for update to authenticated
                      using ((select app.tiene_permiso('catalogo.gestionar')))
                      with check ((select app.tiene_permiso('catalogo.gestionar')))$f$, t);
  end loop;
end $$;

create policy variantes_ver on public.variantes for select to authenticated
  using ((select app.tiene_permiso('catalogo.ver')));
create policy variantes_crear on public.variantes for insert to authenticated
  with check ((select app.tiene_permiso('catalogo.gestionar')));
create policy variantes_editar on public.variantes for update to authenticated
  using ((select app.tiene_permiso('catalogo.gestionar')) or (select app.tiene_permiso('precios.gestionar')))
  with check ((select app.tiene_permiso('catalogo.gestionar')) or (select app.tiene_permiso('precios.gestionar')));
create policy historial_precios_ver on public.historial_precios for select to authenticated
  using ((select app.tiene_permiso('catalogo.ver')));
create policy variante_costos_ver on public.variante_costos for select to authenticated
  using ((select app.tiene_permiso('costos.ver')));
create policy historial_costos_ver on public.historial_costos for select to authenticated
  using ((select app.tiene_permiso('costos.ver')));

create policy diseno_materiales_ver on public.diseno_materiales for select to authenticated
  using ((select app.tiene_permiso('catalogo.ver')) or (select app.tiene_permiso('estampado.ver')));
create policy diseno_materiales_crear on public.diseno_materiales for insert to authenticated
  with check ((select app.tiene_permiso('catalogo.gestionar')));
create policy diseno_materiales_editar on public.diseno_materiales for update to authenticated
  using ((select app.tiene_permiso('catalogo.gestionar')))
  with check ((select app.tiene_permiso('catalogo.gestionar')));
create policy diseno_materiales_borrar on public.diseno_materiales for delete to authenticated
  using ((select app.tiene_permiso('catalogo.gestionar')));

-- Puntos de venta, cuentas, métodos de pago e impuestos (nombres visibles; saldos por función)
do $$
declare
  t text;
begin
  foreach t in array array['bodegas', 'cuentas_dinero', 'metodos_pago', 'impuestos'] loop
    execute format($f$create policy %1$s_ver on public.%1$I for select to authenticated
                      using ((select app.usuario_activo()))$f$, t);
    execute format($f$create policy %1$s_crear on public.%1$I for insert to authenticated
                      with check ((select app.tiene_permiso('configuracion.gestionar')))$f$, t);
    execute format($f$create policy %1$s_editar on public.%1$I for update to authenticated
                      using ((select app.tiene_permiso('configuracion.gestionar')))
                      with check ((select app.tiene_permiso('configuracion.gestionar')))$f$, t);
  end loop;
end $$;

-- Inventario
create policy existencias_ver on public.existencias for select to authenticated
  using ((select app.tiene_permiso('inventario.ver')) and app.puede_ver_bodega(bodega_id));
create policy movimientos_inventario_ver on public.movimientos_inventario for select to authenticated
  using ((select app.tiene_permiso('costos.ver')) and (select app.tiene_permiso('inventario.kardex'))
         and app.puede_ver_bodega(bodega_id));
create policy ajustes_ver on public.ajustes_inventario for select to authenticated
  using (((select app.tiene_permiso('inventario.ajustar')) or (select app.tiene_permiso('inventario.aprobar_ajuste'))
          or (select app.tiene_permiso('inventario.kardex')))
         and app.puede_ver_bodega(bodega_id));
create policy ajuste_lineas_ver on public.ajuste_lineas for select to authenticated
  using (exists (select 1 from public.ajustes_inventario a where a.id = ajuste_id));
create policy traslados_ver on public.traslados for select to authenticated
  using (((select app.tiene_permiso('traslados.ver')) or (select app.tiene_permiso('traslados.gestionar')))
         and (app.puede_ver_bodega(origen_id) or app.puede_ver_bodega(destino_id)));
create policy traslado_lineas_ver on public.traslado_lineas for select to authenticated
  using (exists (select 1 from public.traslados t where t.id = traslado_id));

-- Terceros
create policy clientes_ver on public.clientes for select to authenticated
  using ((select app.tiene_permiso('clientes.ver')) or (select app.tiene_permiso('clientes.crear'))
         or (select app.tiene_permiso('clientes.gestionar')));
create policy clientes_crear on public.clientes for insert to authenticated
  with check ((select app.tiene_permiso('clientes.crear')) or (select app.tiene_permiso('clientes.gestionar')));
create policy clientes_editar on public.clientes for update to authenticated
  using ((select app.tiene_permiso('clientes.gestionar')))
  with check ((select app.tiene_permiso('clientes.gestionar')));
create policy proveedores_ver on public.proveedores for select to authenticated
  using ((select app.tiene_permiso('proveedores.ver')) or (select app.tiene_permiso('proveedores.gestionar'))
         or (select app.tiene_permiso('compras.ver')));
create policy proveedores_crear on public.proveedores for insert to authenticated
  with check ((select app.tiene_permiso('proveedores.gestionar')));
create policy proveedores_editar on public.proveedores for update to authenticated
  using ((select app.tiene_permiso('proveedores.gestionar')))
  with check ((select app.tiene_permiso('proveedores.gestionar')));

-- Compras (con costos: solo quien ve compras)
create policy compras_ver on public.compras for select to authenticated
  using ((select app.tiene_permiso('compras.ver')) and app.puede_ver_bodega(bodega_id));
create policy compra_lineas_ver on public.compra_lineas for select to authenticated
  using (exists (select 1 from public.compras c where c.id = compra_id));
create policy compra_costos_ver on public.compra_costos_adicionales for select to authenticated
  using (exists (select 1 from public.compras c where c.id = compra_id));
create policy pagos_compra_ver on public.pagos_compra for select to authenticated
  using (exists (select 1 from public.compras c where c.id = compra_id));
create policy devoluciones_proveedor_ver on public.devoluciones_proveedor for select to authenticated
  using ((select app.tiene_permiso('compras.ver')) and app.puede_ver_bodega(bodega_id));
create policy devolucion_proveedor_lineas_ver on public.devolucion_proveedor_lineas for select to authenticated
  using (exists (select 1 from public.devoluciones_proveedor d where d.id = devolucion_id));

-- Ventas: todas las del punto o solo las propias
create policy ventas_ver on public.ventas for select to authenticated
  using (app.puede_ver_bodega(bodega_id)
         and ((select app.tiene_permiso('ventas.ver'))
              or ((select app.tiene_permiso('ventas.ver_propias')) and vendedor_id = (select auth.uid()))));
create policy venta_lineas_ver on public.venta_lineas for select to authenticated
  using (exists (select 1 from public.ventas v where v.id = venta_id));
create policy pagos_venta_ver on public.pagos_venta for select to authenticated
  using (exists (select 1 from public.ventas v where v.id = venta_id));
create policy devoluciones_venta_ver on public.devoluciones_venta for select to authenticated
  using (exists (select 1 from public.ventas v where v.id = venta_id));
create policy devolucion_venta_lineas_ver on public.devolucion_venta_lineas for select to authenticated
  using (exists (select 1 from public.devoluciones_venta d where d.id = devolucion_id));
create policy venta_linea_costos_ver on public.venta_linea_costos for select to authenticated
  using ((select app.tiene_permiso('costos.ver'))
         and exists (select 1 from public.venta_lineas l where l.id = venta_linea_id));
create policy descuentos_ver on public.descuentos_autorizados for select to authenticated
  using ((select app.tiene_permiso('ventas.crear')) or (select app.tiene_permiso('ventas.ver'))
         or (select app.tiene_permiso('descuentos.autorizar')));
create policy descuentos_crear on public.descuentos_autorizados for insert to authenticated
  with check ((select app.tiene_permiso('descuentos.autorizar')) and autorizado_por = (select auth.uid()));
create policy descuentos_editar on public.descuentos_autorizados for update to authenticated
  using ((select app.tiene_permiso('descuentos.autorizar')))
  with check ((select app.tiene_permiso('descuentos.autorizar')));

-- Estampado
create policy ordenes_estampado_ver on public.ordenes_estampado for select to authenticated
  using ((select app.tiene_permiso('estampado.ver')) and app.puede_ver_bodega(bodega_id));
create policy orden_lineas_ver on public.orden_estampado_lineas for select to authenticated
  using (exists (select 1 from public.ordenes_estampado o where o.id = orden_id));
create policy orden_consumos_ver on public.orden_estampado_consumos for select to authenticated
  using (exists (select 1 from public.orden_estampado_lineas l where l.id = linea_id));

-- Dinero
create policy movimientos_caja_ver on public.movimientos_caja for select to authenticated
  using ((select app.tiene_permiso('caja.ver'))
         and exists (select 1 from public.cuentas_dinero c
                      where c.id = cuenta_id and (c.bodega_id is null or app.puede_ver_bodega(c.bodega_id))));
create policy cierres_caja_ver on public.cierres_caja for select to authenticated
  using (((select app.tiene_permiso('caja.ver')) or (select app.tiene_permiso('caja.cerrar')))
         and exists (select 1 from public.cuentas_dinero c
                      where c.id = cuenta_id and (c.bodega_id is null or app.puede_ver_bodega(c.bodega_id))));

-- Gastos
create policy categorias_gasto_ver on public.categorias_gasto for select to authenticated
  using ((select app.tiene_permiso('gastos.ver')) or (select app.tiene_permiso('gastos.registrar'))
         or (select app.tiene_permiso('gastos.configurar')));
create policy categorias_gasto_crear on public.categorias_gasto for insert to authenticated
  with check ((select app.tiene_permiso('gastos.configurar')));
create policy categorias_gasto_editar on public.categorias_gasto for update to authenticated
  using ((select app.tiene_permiso('gastos.configurar')))
  with check ((select app.tiene_permiso('gastos.configurar')));
create policy gastos_recurrentes_ver on public.gastos_recurrentes for select to authenticated
  using ((select app.tiene_permiso('gastos.ver')) or (select app.tiene_permiso('gastos.configurar')));
create policy gastos_recurrentes_crear on public.gastos_recurrentes for insert to authenticated
  with check ((select app.tiene_permiso('gastos.configurar')));
create policy gastos_recurrentes_editar on public.gastos_recurrentes for update to authenticated
  using ((select app.tiene_permiso('gastos.configurar')))
  with check ((select app.tiene_permiso('gastos.configurar')));
create policy gastos_ver on public.gastos for select to authenticated
  using ((select app.tiene_permiso('gastos.ver')) and (bodega_id is null or app.puede_ver_bodega(bodega_id)));

-- Adjuntos: se ven y se suben con el permiso del documento al que pertenecen
create function app.puede_ver_documento(p_tipo text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_tipo
    when 'producto' then app.tiene_permiso('catalogo.ver')
    when 'diseno' then app.tiene_permiso('catalogo.ver')
    when 'compra' then app.tiene_permiso('compras.ver')
      and exists (select 1 from public.compras c where c.id = p_id and app.puede_ver_bodega(c.bodega_id))
    when 'devolucion_proveedor' then app.tiene_permiso('compras.ver')
      and exists (select 1 from public.devoluciones_proveedor d where d.id = p_id and app.puede_ver_bodega(d.bodega_id))
    when 'gasto' then app.tiene_permiso('gastos.ver')
      and exists (select 1 from public.gastos g where g.id = p_id and (g.bodega_id is null or app.puede_ver_bodega(g.bodega_id)))
    when 'ajuste' then (app.tiene_permiso('inventario.ajustar') or app.tiene_permiso('inventario.aprobar_ajuste'))
      and exists (select 1 from public.ajustes_inventario a where a.id = p_id and app.puede_ver_bodega(a.bodega_id))
    when 'venta' then exists (
      select 1 from public.ventas v where v.id = p_id and app.puede_ver_bodega(v.bodega_id)
         and (app.tiene_permiso('ventas.ver') or app.tiene_permiso('ventas.entregar')
              or (app.tiene_permiso('ventas.ver_propias') and v.vendedor_id = auth.uid())))
    when 'venta_linea' then exists (
      select 1 from public.venta_lineas l join public.ventas v on v.id = l.venta_id
       where l.id = p_id and app.puede_ver_bodega(v.bodega_id)
         and (app.tiene_permiso('ventas.ver') or app.tiene_permiso('ventas.entregar')
              or app.tiene_permiso('estampado.ver')
              or (app.tiene_permiso('ventas.ver_propias') and v.vendedor_id = auth.uid())))
    when 'devolucion_venta' then exists (
      select 1 from public.devoluciones_venta d join public.ventas v on v.id = d.venta_id
       where d.id = p_id and app.puede_ver_bodega(v.bodega_id)
         and (app.tiene_permiso('ventas.ver') or (app.tiene_permiso('ventas.ver_propias') and v.vendedor_id = auth.uid())))
    else false end
$$;

create function app.puede_adjuntar(p_tipo text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.puede_ver_documento(p_tipo, p_id) and case p_tipo
    when 'producto' then app.tiene_permiso('catalogo.gestionar')
    when 'diseno' then app.tiene_permiso('catalogo.gestionar')
    when 'compra' then app.tiene_permiso('compras.gestionar')
    when 'devolucion_proveedor' then app.tiene_permiso('compras.gestionar')
    when 'gasto' then app.tiene_permiso('gastos.registrar')
    when 'ajuste' then app.tiene_permiso('inventario.ajustar')
    when 'venta' then app.tiene_permiso('ventas.crear')
    when 'venta_linea' then app.tiene_permiso('ventas.crear')
    when 'devolucion_venta' then app.tiene_permiso('ventas.devolver')
    else false end
$$;
grant execute on function app.puede_ver_documento(text, uuid), app.puede_adjuntar(text, uuid) to authenticated;

create policy adjuntos_ver on public.adjuntos for select to authenticated
  using (app.puede_ver_documento(documento_tipo, documento_id));
create policy adjuntos_crear on public.adjuntos for insert to authenticated
  with check (subido_por = (select auth.uid()) and app.puede_adjuntar(documento_tipo, documento_id));

-- ---------------------------------------------------------------------
-- 3. Auditoría: usuario, fecha, acción, registro, valor anterior y nuevo
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'configuracion_negocio', 'roles', 'rol_permisos', 'perfiles', 'usuario_bodegas', 'consecutivos',
    'categorias', 'tallas', 'colores', 'tipos_camiseta', 'disenos', 'productos', 'variantes', 'diseno_materiales',
    'bodegas', 'clientes', 'proveedores', 'descuentos_autorizados', 'cuentas_dinero', 'metodos_pago', 'impuestos',
    'categorias_gasto', 'gastos_recurrentes', 'ventas', 'compras', 'gastos', 'ajustes_inventario', 'traslados',
    'ordenes_estampado', 'devoluciones_venta', 'devoluciones_proveedor', 'pagos_venta', 'pagos_compra',
    'cierres_caja', 'adjuntos']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app.registrar_auditoria()', t || '_auditoria', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Reglas fijas
-- ---------------------------------------------------------------------

-- Siempre existe al menos un administrador activo
create function app.proteger_ultimo_administrador() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select id from public.roles where codigo = 'administrador');
begin
  if old.rol_id = v_admin and old.activo
     and (new.rol_id is distinct from v_admin or not new.activo)
     and not exists (select 1 from public.perfiles
                      where id <> old.id and rol_id = v_admin and activo) then
    raise exception 'Debe quedar al menos un administrador activo.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger perfiles_ultimo_administrador
  before update of rol_id, activo on public.perfiles
  for each row execute function app.proteger_ultimo_administrador();

-- Los roles de partida conservan su código; el administrador no se desactiva
create function app.proteger_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.es_sistema and (new.codigo <> old.codigo or not new.es_sistema) then
    raise exception 'Los roles de partida no cambian de código.';
  end if;
  if old.codigo = 'administrador' and not new.activo then
    raise exception 'El rol Administrador no se desactiva.';
  end if;
  return new;
end $$;
create trigger roles_proteger before update on public.roles
  for each row execute function app.proteger_roles();

-- El administrador tiene todos los permisos; descuentos, crédito y todos los puntos son solo suyos
create function app.proteger_rol_permisos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text;
begin
  if tg_op = 'DELETE' then
    select codigo into v_codigo from public.roles where id = old.rol_id;
    if v_codigo = 'administrador' then
      raise exception 'El rol Administrador conserva todos los permisos.';
    end if;
    return old;
  end if;
  select codigo into v_codigo from public.roles where id = new.rol_id;
  if new.permiso_codigo in ('descuentos.autorizar', 'ventas.credito', 'bodegas.todas')
     and v_codigo is distinct from 'administrador' then
    raise exception 'Solo el Administrador puede tener el permiso %.', new.permiso_codigo;
  end if;
  return new;
end $$;
create trigger rol_permisos_proteger before insert or delete on public.rol_permisos
  for each row execute function app.proteger_rol_permisos();

-- Todo permiso nuevo se asigna al administrador
create function app.permiso_al_administrador() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rol_permisos (rol_id, permiso_codigo)
  select id, new.codigo from public.roles where codigo = 'administrador'
  on conflict do nothing;
  return null;
end $$;
create trigger permisos_al_administrador after insert on public.permisos
  for each row execute function app.permiso_al_administrador();

-- ---------------------------------------------------------------------
-- 5. Funciones internas: nadie las ejecuta salvo las tres que usan las políticas
-- ---------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public;
grant execute on function app.tiene_permiso(text), app.puede_ver_bodega(uuid), app.usuario_activo(),
                          app.puede_ver_documento(text, uuid), app.puede_adjuntar(text, uuid)
  to authenticated;
