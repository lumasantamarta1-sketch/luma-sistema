import type { Metadata } from "next";
import { Download } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { pestanasInformes } from "@/lib/informes";
import { CLASES } from "@/lib/catalogo";
import { numero } from "@/lib/inventario";
import { pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Informe de inventario" };

type Existencia = {
  variante_id: string; bodega_id: string; bodega: string; sku: string; producto: string; clase: string; unidad_medida: string;
  talla: string | null; color: string | null; tipo: string | null; diseno: string | null; cantidad: number; disponible: number; activo: boolean;
};
type Alerta = { variante_id: string; sku: string; producto: string; bodega: string; cantidad: number; stock_minimo: number; alerta: string };

const ALERTAS: Record<string, { texto: string; tono: "error" | "alerta" | "marca" }> = {
  agotado: { texto: "Agotado", tono: "error" },
  bajo_minimo: { texto: "Bajo el mínimo", tono: "alerta" },
  pocas_unidades: { texto: "Pocas unidades", tono: "marca" },
};

export default async function InformeInventario({ searchParams }: { searchParams: Promise<{ punto?: string }> }) {
  const f = await searchParams;
  const sesion = await exigirPermiso("informes.inventario");
  const supabase = await crearClienteServidor();
  const veCostos = tiene(sesion, "costos.ver");
  const puntos = sesion.bodegas;
  const punto = puntos.some((p) => p.id === f.punto) ? f.punto : undefined;
  let consulta = supabase.from("existencias_detalle")
    .select("variante_id, bodega_id, bodega, sku, producto, clase, unidad_medida, talla, color, tipo, diseno, cantidad, disponible, activo")
    .neq("cantidad", 0).order("producto").order("sku").limit(3000);
  if (punto) consulta = consulta.eq("bodega_id", punto);
  const [{ data }, { data: costos }, { data: alertas }] = await Promise.all([
    consulta,
    veCostos ? supabase.from("variante_costos").select("variante_id, costo_promedio") : Promise.resolve({ data: [] }),
    supabase.rpc("alertas_inventario", { p_bodega: punto ?? null }),
  ]);
  const filas = (data ?? []) as Existencia[];
  const costo = new Map(((costos ?? []) as { variante_id: string; costo_promedio: number }[]).map((c) => [c.variante_id, Number(c.costo_promedio)]));
  const porClase = new Map<string, { unidades: number; valor: number }>();
  for (const e of filas) {
    const x = porClase.get(e.clase) ?? { unidades: 0, valor: 0 };
    x.unidades += e.clase === "material" ? 0 : Number(e.cantidad);
    x.valor += Number(e.cantidad) * (costo.get(e.variante_id) ?? 0);
    porClase.set(e.clase, x);
  }
  const total = [...porClase.values()].reduce((s, x) => s + x.valor, 0);
  const lista = (alertas ?? []) as Alerta[];
  const exportar = tiene(sesion, "informes.exportar") ? `/informes/exportar?tipo=inventario${punto ? `&punto=${punto}` : ""}` : null;

  return (
    <>
      <Encabezado titulo="Inventario" descripcion="Existencias de hoy por producto y punto."
                  acciones={exportar ? (
                    <a href={exportar} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50">
                      <Download className="size-4" aria-hidden /> Exportar a Excel (CSV)
                    </a>
                  ) : undefined} />
      <Pestanas actual="/informes/inventario" etiqueta="Informes" items={pestanasInformes(sesion.permisos)} />
      {puntos.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Punto
            <select name="punto" defaultValue={punto ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
              <option value="">Todos</option>
              {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Ver</button>
        </form>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {["terminado", "base", "material"].map((c) => (
          <Tarjeta key={c} className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-suave">{CLASES[c]}</p>
            <p className="cifra font-titulo text-2xl font-semibold text-morado">
              {c === "material" ? `${filas.filter((e) => e.clase === c).length} ítem(s)` : `${numero(porClase.get(c)?.unidades ?? 0)} und`}
            </p>
            {veCostos && <p className="text-xs text-suave">A costo: {pesos(porClase.get(c)?.valor ?? 0)}</p>}
          </Tarjeta>
        ))}
        {veCostos && (
          <Tarjeta className="flex flex-col gap-1 bg-morado-50">
            <p className="text-sm font-semibold text-suave">Valor del inventario</p>
            <p className="cifra font-titulo text-2xl font-semibold text-morado">{pesos(total)}</p>
            <p className="text-xs text-suave">Al costo promedio · Calculado</p>
          </Tarjeta>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Tarjeta>
          <h2 className="mb-3 text-lg font-semibold text-morado">Existencias</h2>
          {filas.length === 0 ? <p className="text-sm text-suave">No hay existencias registradas.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="text-left text-suave">
                  <th className="py-2 font-semibold">Producto</th><th className="py-2 font-semibold">Punto</th>
                  <th className="py-2 text-right font-semibold">Cantidad</th><th className="py-2 text-right font-semibold">Disponible</th>
                  {veCostos && <th className="py-2 text-right font-semibold">Valor</th>}
                </tr></thead>
                <tbody>
                  {filas.map((e) => (
                    <tr key={`${e.variante_id}-${e.bodega_id}`} className="border-t border-borde">
                      <td className="py-2">{e.producto}<span className="block text-xs text-suave">{e.sku}{[e.diseno, e.talla, e.color].filter(Boolean).length ? ` · ${[e.diseno, e.talla, e.color].filter(Boolean).join(" · ")}` : ""}</span></td>
                      <td className="py-2">{e.bodega}</td>
                      <td className="cifra py-2 text-right">{numero(e.cantidad)}{e.unidad_medida !== "unidad" ? ` ${e.unidad_medida}` : ""}</td>
                      <td className="cifra py-2 text-right">{numero(e.disponible)}</td>
                      {veCostos && <td className="cifra py-2 text-right">{pesos(Number(e.cantidad) * (costo.get(e.variante_id) ?? 0))}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
        <Tarjeta className="h-fit">
          <h2 className="mb-3 text-lg font-semibold text-morado">Alertas</h2>
          {lista.length === 0 ? <p className="text-sm text-suave">Sin alertas: todo está por encima del mínimo.</p> : (
            <ul className="flex flex-col divide-y divide-borde text-sm">
              {lista.slice(0, 60).map((a) => (
                <li key={`${a.variante_id}-${a.bodega}`} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">{a.producto} <span className="text-suave">({a.sku}) · {a.bodega}</span></span>
                  <Insignia tono={ALERTAS[a.alerta]?.tono}>{ALERTAS[a.alerta]?.texto ?? a.alerta}</Insignia>
                  <span className="cifra">{numero(a.cantidad)}{Number(a.stock_minimo) > 0 ? ` / mín. ${numero(a.stock_minimo)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </>
  );
}
