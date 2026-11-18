"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export type OpcionVariante = { id: string; sku: string; producto: string; detalle: string; unidad: string; clase: string };
type Linea = { clave: number; varianteId: string; cantidad: string; costo: string };

// Líneas de un documento (ajuste, estampado, traslado): producto + cantidad (+ costo opcional).
// Se envían al servidor como JSON en el campo oculto «lineas».
export function LineasVariantes({
  opciones, conCosto = false, etiquetaCantidad = "Cantidad", permitirNegativos = false,
}: {
  opciones: OpcionVariante[]; conCosto?: boolean; etiquetaCantidad?: string; permitirNegativos?: boolean;
}) {
  const [lineas, setLineas] = useState<Linea[]>([{ clave: 1, varianteId: "", cantidad: "", costo: "" }]);
  const [filtro, setFiltro] = useState("");
  const filtradas = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return t ? opciones.filter((o) => `${o.sku} ${o.producto} ${o.detalle}`.toLowerCase().includes(t)) : opciones;
  }, [filtro, opciones]);
  const productos = useMemo(() => [...new Set(filtradas.map((o) => o.producto))], [filtradas]);
  const porId = useMemo(() => new Map(opciones.map((o) => [o.id, o])), [opciones]);

  const cambiar = (clave: number, campo: keyof Linea, valor: string) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));

  const json = JSON.stringify(
    lineas
      .filter((l) => l.varianteId && l.cantidad)
      .map((l) => ({
        variante_id: l.varianteId,
        cantidad: Number(l.cantidad),
        ...(conCosto && l.costo !== "" ? { costo_unitario: Number(l.costo) } : {}),
      })),
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="lineas" value={json} />
      <input
        type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por SKU, producto, talla o color" aria-label="Buscar producto"
        className="min-h-11 rounded-xl border border-borde bg-white px-3"
      />
      {lineas.map((l, i) => {
        const elegida = porId.get(l.varianteId);
        return (
          <div key={l.clave} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-borde p-3 sm:grid-cols-[1fr_120px_140px_auto] sm:items-end">
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold sm:col-span-1">
              Producto {i + 1}
              <select value={l.varianteId} onChange={(e) => cambiar(l.clave, "varianteId", e.target.value)}
                      className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
                <option value="">Elige…</option>
                {elegida && !filtradas.some((o) => o.id === elegida.id) && (
                  <option value={elegida.id}>{elegida.sku} · {elegida.detalle || elegida.producto}</option>
                )}
                {productos.map((p) => (
                  <optgroup key={p} label={p}>
                    {filtradas.filter((o) => o.producto === p).map((o) => (
                      <option key={o.id} value={o.id}>{o.sku}{o.detalle ? ` · ${o.detalle}` : ""}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {etiquetaCantidad}{elegida && elegida.unidad !== "unidad" ? ` (${elegida.unidad})` : ""}
              <input type="number" inputMode="decimal" step={elegida?.unidad === "unidad" ? 1 : "any"}
                     min={permitirNegativos ? undefined : 0} value={l.cantidad}
                     onChange={(e) => cambiar(l.clave, "cantidad", e.target.value)}
                     className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
            </label>
            {conCosto && (
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Costo unitario
                <input type="number" inputMode="decimal" min={0} step="any" value={l.costo}
                       onChange={(e) => cambiar(l.clave, "costo", e.target.value)}
                       className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
              </label>
            )}
            <button type="button" onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((x) => x.clave !== l.clave) : ls))}
                    className="flex size-11 items-center justify-center self-end rounded-xl text-error hover:bg-error/5" aria-label="Quitar línea">
              <Trash2 className="size-5" aria-hidden />
            </button>
          </div>
        );
      })}
      <button type="button"
              onClick={() => setLineas((ls) => [...ls, { clave: Math.max(...ls.map((x) => x.clave)) + 1, varianteId: "", cantidad: "", costo: "" }])}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-3 font-semibold text-morado hover:bg-morado-50">
        <Plus className="size-5" aria-hidden /> Agregar producto
      </button>
    </div>
  );
}
