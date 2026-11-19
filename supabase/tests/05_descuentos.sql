-- =====================================================================
-- Pruebas · 05 · Descuento puntual por valor total, repartido entre las líneas
-- =====================================================================
select pruebas.como('admin@luma.test');
set role authenticated;
create temporary table kd (venta uuid);
grant all on kd to authenticated;
insert into kd select public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 1),
                              jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 1))));
insert into public.descuentos_autorizados (tipo, nombre, valor_total, venta_id, autorizado_por)
select 'puntual', 'Precio especial dos camisetas', 60000, venta, auth.uid() from kd;
reset role;

-- Quien vende aplica el descuento sin escribir el valor: el sistema lo reparte
select pruebas.como('vendedor@luma.test');
set role authenticated;
select pruebas.igual((select count(*) from public.ventas where id = (select venta from kd)), 0,
                     'la cotización del administrador no es visible para el vendedor');
reset role;

select pruebas.como('admin@luma.test');
set role authenticated;
select public.guardar_cotizacion((select venta from kd), jsonb_build_object(
  'lineas', (select jsonb_agg(jsonb_build_object('variante_id', pruebas.var('NAV-CR-M-BLA'), 'cantidad', 1,
             'descuento_autorizado_id', (select id from public.descuentos_autorizados where nombre = 'Precio especial dos camisetas')))
               from generate_series(1, 2))));
select pruebas.igual((select descuentos from public.ventas where id = (select venta from kd)), 60000,
                     'un descuento por valor total se reparte entre las líneas');
select pruebas.igual((select total from public.ventas where id = (select venta from kd)), 30000,
                     'total con el descuento repartido');
select pruebas.igual((select max(descuento) from public.venta_lineas where venta_id = (select venta from kd)), 45000,
                     'ninguna línea recibe más descuento que su valor');
select public.anular_venta((select venta from kd), 'Prueba de descuento');
reset role;
