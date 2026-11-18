#!/usr/bin/env bash
# =====================================================================
# Pruebas · 04 · Dos vendedores confirman al mismo tiempo la última unidad.
# La primera venta bloquea la existencia; la segunda espera y se rechaza.
# =====================================================================
set -uo pipefail
PSQL=(psql -h /home/claude/pg -p 54329 -U postgres -d luma -v ON_ERROR_STOP=1 -q -X -t -A)
TMP=$(mktemp -d)

"${PSQL[@]}" >/dev/null <<'SQL'
select pruebas.como('admin@luma.test');
set role authenticated;
insert into public.productos (codigo, nombre, clase, se_vende) values ('ULT', 'Camiseta última unidad', 'terminado', true);
insert into public.variantes (producto_id, sku, precio_venta) select id, 'ULT-1', 50000 from public.productos where codigo = 'ULT';
select public.solicitar_ajuste(jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'), 'tipo', 'saldo_inicial',
  'motivo', 'Prueba de concurrencia',
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ULT-1'), 'cantidad', 1, 'costo_unitario', 20000))));
SQL

venta() {
  cat <<SQL
begin;
select pruebas.como('$1');
set role authenticated;
select public.confirmar_venta(public.guardar_cotizacion(null, jsonb_build_object('bodega_id', pruebas.bod('Tienda Centro'),
  'lineas', jsonb_build_array(jsonb_build_object('variante_id', pruebas.var('ULT-1'), 'cantidad', 1)))), gen_random_uuid());
select pg_sleep($2);
commit;
SQL
}

inicio=$(date +%s.%N)
( venta vendedor@luma.test 2 | "${PSQL[@]}" >"$TMP/a.txt" 2>&1; echo $? >"$TMP/a.rc" ) &
sleep 0.5
( venta vendedor2@luma.test 0 | "${PSQL[@]}" >"$TMP/b.txt" 2>&1; echo $? >"$TMP/b.rc"; date +%s.%N >"$TMP/b.fin" ) &
wait

espera=$(echo "$(cat "$TMP/b.fin") - $inicio" | bc)
apartada=$("${PSQL[@]}" -c "select apartada from public.existencias where variante_id = pruebas.var('ULT-1')")
ventas=$("${PSQL[@]}" -c "select count(*) from public.ventas v join public.venta_lineas l on l.venta_id = v.id
                           where l.variante_id = pruebas.var('ULT-1') and v.estado = 'confirmada'")

falla=0
if [[ "$(cat "$TMP/a.rc")" == "0" ]]; then echo "   ok · la primera venta toma la última unidad"; else echo "   FALLÓ: la primera venta no se confirmó"; cat "$TMP/a.txt"; falla=1; fi
if [[ "$(cat "$TMP/b.rc")" != "0" ]] && grep -q "No hay existencias suficientes" "$TMP/b.txt"; then
  echo "   ok · la segunda venta se rechaza: $(grep -o 'No hay existencias suficientes[^.]*' "$TMP/b.txt" | head -1)"
else echo "   FALLÓ: la segunda venta debía rechazarse"; cat "$TMP/b.txt"; falla=1; fi
if (( $(echo "$espera >= 1.8" | bc) )); then echo "   ok · la segunda esperó el bloqueo de la primera (${espera:0:4} s)"; else echo "   FALLÓ: no hubo espera ($espera s)"; falla=1; fi
if [[ "$apartada" == "1.000" && "$ventas" == "1" ]]; then echo "   ok · queda una sola venta y una unidad apartada"; else echo "   FALLÓ: apartada=$apartada ventas=$ventas"; falla=1; fi
rm -rf "$TMP"
exit $falla
