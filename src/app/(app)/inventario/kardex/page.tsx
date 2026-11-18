import type { Metadata } from "next";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerVariantes } from "@/lib/catalogo";
import { TIPOS_MOVIMIENTO, numero } from "@/lib/inventario";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";
import { PestanasInventario } from "@/components/app/pestanas-inventario";
import { pesos } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Movimientos de inventario" };

type Movimiento = {
  id: number; ocurrido_en: string; sku: string; bodega: string; tipo: string; cantidad: number; saldo_resultante: number;
  costo_unitario: number | null; motivo: string | null;
};

const fechaHora = (v: string) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v));

export default async function PaginaKardex({ searchParams }: { searchParams: Promise<{ variante?: string; punto?: string; desde?: string; hasta?: string }> }) {
  const sesion = await exigirPermiso("inventario.kardex");
  const { variante = "", punto = "", desde = "", hasta = "" } = await searchParams;
  const supabase = await crearClienteServidor();
  const [{ data, error }, variantes] = await Promise.all([
    supabase.rpc("kardex", { p_variante: variante || null, p_bodega: punto || null, p_desde: desde || null, p_hasta: hasta || null, p_limite: 300 }),
    obtenerVariantes(supabase, { soloActivas: false }),
  ]);
  const movimientos = (data ?? []) as Movimiento[];
  const conCostos = movimientos.some((m) => m.costo_unitario !== null);

  return (
    <>
      <Encabezado titulo="Inventario" descripcion="Cada entrada y salida queda aquí y no se modifica." />
      <PestanasInventario actual="/inventario/kardex" permisos={sesion.permisos} />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_160px_auto]">
        <select name="variante" defaultValue={variante} aria-label="Producto" className="min-h-11 rounded-xl border border-borde bg-white px-3">
          <option value="">Todos los productos</option>
          {variantes.map((v) => <option key={v.id} value={v.id}>{v.sku} · {v.producto}</option>)}
        </select>
        <select name="punto" defaultValue={punto} aria-label="Punto" className="min-h-11 rounded-xl border border-borde bg-white px-3">
          <option value="">Todos mis puntos</option>
          {sesion.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
        <input type="date" name="desde" defaultValue={desde} aria-label="Desde" className="min-h-11 rounded-xl border border-borde bg-white px-3" />
        <input type="date" name="hasta" defaultValue={hasta} aria-label="Hasta" className="min-h-11 rounded-xl border border-borde bg-white px-3" />
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Filtrar</button>
      </form>
      {error && <Tarjeta className="text-error">{error.message}</Tarjeta>}
      <Tarjeta className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-morado-50 text-left text-suave">
            <tr>
              <th className="px-4 py-3 font-semibold">Fecha</th><th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">Movimiento</th><th className="px-4 py-3 text-right font-semibold">Cantidad</th>
              <th className="px-4 py-3 text-right font-semibold">Saldo</th>
              {conCostos && <th className="px-4 py-3 text-right font-semibold">Costo</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {movimientos.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-suave">Sin movimientos.</td></tr>}
            {movimientos.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap px-4 py-3">{fechaHora(m.ocurrido_en)}</td>
                <td className="px-4 py-3"><p className="font-semibold">{m.sku}</p><p className="text-suave">{m.bodega}</p></td>
                <td className="px-4 py-3">{TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo}{m.motivo ? <span className="block text-suave">{m.motivo}</span> : null}</td>
                <td className={`cifra px-4 py-3 text-right font-semibold ${Number(m.cantidad) < 0 ? "text-error" : "text-morado"}`}>
                  {Number(m.cantidad) > 0 ? "+" : ""}{numero(m.cantidad)}</td>
                <td className="cifra px-4 py-3 text-right">{numero(m.saldo_resultante)}</td>
                {conCostos && <td className="cifra px-4 py-3 text-right">{m.costo_unitario !== null ? pesos(m.costo_unitario) : ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
    </>
  );
}
