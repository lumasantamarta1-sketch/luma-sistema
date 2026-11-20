import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { PestanasInventario } from "@/components/app/pestanas-inventario";
import { CLASES } from "@/lib/catalogo";
import { numero } from "@/lib/inventario";

export const metadata: Metadata = { title: "Inventario" };

type Fila = {
  variante_id: string; bodega_id: string; bodega: string; sku: string; producto: string; clase: string; unidad_medida: string;
  talla: string | null; color: string | null; tipo: string | null; diseno: string | null;
  cantidad: number; apartada: number; disponible: number; stock_minimo: number;
};

const ALERTAS: Record<string, { texto: string; tono: "error" | "alerta" | "neutro" }> = {
  agotado: { texto: "Agotado", tono: "error" },
  bajo_minimo: { texto: "Bajo el mínimo", tono: "alerta" },
  pocas_unidades: { texto: "Pocas unidades", tono: "neutro" },
};

export default async function PaginaInventario({ searchParams }: { searchParams: Promise<{ punto?: string; clase?: string; q?: string }> }) {
  const sesion = await exigirPermiso("inventario.ver");
  const { punto = "", clase = "", q = "" } = await searchParams;
  const supabase = await crearClienteServidor();
  let consulta = supabase.from("existencias_detalle").select("*").order("producto").order("sku");
  if (punto) consulta = consulta.eq("bodega_id", punto);
  if (clase in CLASES) consulta = consulta.eq("clase", clase);
  const limpio = q.trim().replace(/[%,()]/g, "");
  if (limpio) consulta = consulta.or(`sku.ilike.%${limpio}%,producto.ilike.%${limpio}%`);
  const [{ data }, { data: alertas }] = await Promise.all([
    consulta,
    supabase.rpc("alertas_inventario", { p_bodega: punto || null }),
  ]);
  const filas = (data ?? []) as Fila[];
  const alertaDe = new Map(((alertas ?? []) as { variante_id: string; bodega_id: string; alerta: string }[])
    .map((a) => [`${a.variante_id}|${a.bodega_id}`, a.alerta]));
  const agotadosSinFila = ((alertas ?? []) as { variante_id: string; bodega_id: string; sku: string; producto: string; bodega: string; alerta: string; clase: string }[])
    .filter((a) => a.alerta === "agotado" && !filas.some((f) => f.variante_id === a.variante_id && f.bodega_id === a.bodega_id))
    .filter((a) => (!clase || a.clase === clase) && (!limpio || `${a.sku} ${a.producto}`.toLowerCase().includes(limpio.toLowerCase())));

  return (
    <>
      <Encabezado titulo="Inventario" descripcion="Lo disponible es lo que hay menos lo apartado por ventas confirmadas."
                  acciones={tiene(sesion, "inventario.ajustar", "compras.gestionar") && tiene(sesion, "costos.ver") ? (
                    <Link href="/inventario/agregar" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
                      <PackagePlus className="size-5" aria-hidden /> Agregar inventario
                    </Link>
                  ) : undefined} />
      <PestanasInventario actual="/inventario" permisos={sesion.permisos} />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_200px_auto]">
        <input type="search" name="q" defaultValue={q} placeholder="Buscar por SKU o producto" aria-label="Buscar"
               className="min-h-11 rounded-xl border border-borde bg-white px-3" />
        <select name="punto" defaultValue={punto} aria-label="Punto de venta" className="min-h-11 rounded-xl border border-borde bg-white px-3">
          <option value="">Todos mis puntos</option>
          {sesion.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
        <select name="clase" defaultValue={clase} aria-label="Clase" className="min-h-11 rounded-xl border border-borde bg-white px-3">
          <option value="">Todas las clases</option>
          {Object.entries(CLASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Filtrar</button>
      </form>
      {filas.length === 0 && agotadosSinFila.length === 0 ? (
        <Tarjeta className="text-center text-suave">
          Aún no hay existencias registradas. Cárgalas con un ajuste de saldo inicial o recibiendo una compra.
        </Tarjeta>
      ) : (
        <Tarjeta className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-morado-50 text-left text-suave">
              <tr>
                <th className="px-4 py-3 font-semibold">Producto</th>
                <th className="px-4 py-3 font-semibold">Punto</th>
                <th className="px-4 py-3 text-right font-semibold">Hay</th>
                <th className="px-4 py-3 text-right font-semibold">Apartado</th>
                <th className="px-4 py-3 text-right font-semibold">Disponible</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borde">
              {filas.map((f) => {
                const alerta = alertaDe.get(`${f.variante_id}|${f.bodega_id}`);
                return (
                  <tr key={`${f.variante_id}${f.bodega_id}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{f.producto}</p>
                      <p className="text-suave">{f.sku}{[f.diseno, f.tipo, f.talla, f.color].filter(Boolean).length ? ` · ${[f.diseno, f.tipo, f.talla, f.color].filter(Boolean).join(" · ")}` : ""}</p>
                    </td>
                    <td className="px-4 py-3">{f.bodega}</td>
                    <td className="cifra px-4 py-3 text-right">{numero(f.cantidad)}{f.unidad_medida !== "unidad" ? ` ${f.unidad_medida}` : ""}</td>
                    <td className="cifra px-4 py-3 text-right text-suave">{numero(f.apartada)}</td>
                    <td className="cifra px-4 py-3 text-right font-semibold">{numero(f.disponible)}</td>
                    <td className="px-4 py-3">{alerta && <Insignia tono={ALERTAS[alerta].tono}>{ALERTAS[alerta].texto}</Insignia>}</td>
                  </tr>
                );
              })}
              {agotadosSinFila.map((a) => (
                <tr key={`${a.variante_id}${a.bodega_id}`}>
                  <td className="px-4 py-3"><p className="font-semibold">{a.producto}</p><p className="text-suave">{a.sku}</p></td>
                  <td className="px-4 py-3">{a.bodega}</td>
                  <td className="cifra px-4 py-3 text-right">0</td><td className="cifra px-4 py-3 text-right text-suave">0</td>
                  <td className="cifra px-4 py-3 text-right font-semibold">0</td>
                  <td className="px-4 py-3"><Insignia tono="error">Agotado</Insignia></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </>
  );
}
