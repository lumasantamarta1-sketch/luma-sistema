import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { AnularOrden, RegistrarEstampado } from "../formularios";
import { ESTADOS_ORDEN, numero } from "@/lib/inventario";
import { fecha, pesos } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Orden de estampado" };

type Consumo = { variante_id: string; cantidad_teorica: number; cantidad_real: number | null;
  variantes: { sku: string; productos: { nombre: string; unidad_medida: string } } | null };
type Linea = { id: string; variante_id: string; cantidad_planeada: number; cantidad_buenas: number | null; cantidad_danadas: number | null;
  venta_linea_id: string | null; variantes: { sku: string; productos: { nombre: string } } | null; orden_estampado_consumos: Consumo[] };

export default async function PaginaOrden({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await exigirPermiso("estampado.ver", "estampado.gestionar");
  const supabase = await crearClienteServidor();
  const { data: orden } = await supabase.from("ordenes_estampado")
    .select("id, numero, estado, venta_id, bodega_id, observaciones, creado_en, terminado_en, bodegas(nombre), orden_estampado_lineas(id, variante_id, cantidad_planeada, cantidad_buenas, cantidad_danadas, venta_linea_id, variantes(sku, productos(nombre)), orden_estampado_consumos(variante_id, cantidad_teorica, cantidad_real, variantes(sku, productos(nombre, unidad_medida))))")
    .eq("id", id).maybeSingle();
  if (!orden) notFound();
  const lineas = (orden.orden_estampado_lineas ?? []) as unknown as Linea[];
  const veCostos = tiene(sesion, "costos.ver");

  // Lo que hace falta: consumo total por variante contra lo disponible en el punto
  const necesidad = new Map<string, { sku: string; producto: string; unidad: string; total: number }>();
  for (const l of lineas) for (const c of l.orden_estampado_consumos) {
    const n = necesidad.get(c.variante_id) ?? { sku: c.variantes?.sku ?? "", producto: c.variantes?.productos.nombre ?? "", unidad: c.variantes?.productos.unidad_medida ?? "unidad", total: 0 };
    n.total += Number(c.cantidad_teorica); necesidad.set(c.variante_id, n);
  }
  const [{ data: existencias }, costos] = await Promise.all([
    supabase.from("existencias").select("variante_id, cantidad, apartada").eq("bodega_id", orden.bodega_id).in("variante_id", [...necesidad.keys()]),
    veCostos && orden.estado === "terminada"
      ? supabase.rpc("detalle_costos", { p_documento_tipo: "estampado", p_documento_id: id })
      : veCostos ? Promise.all(lineas.map((l) => supabase.rpc("costo_estimado", { p_variante: l.variante_id }))) : Promise.resolve(null),
  ]);
  const disponible = new Map((existencias ?? []).map((e) => [e.variante_id, Number(e.cantidad) - Number(e.apartada)]));
  const faltantes = [...necesidad.entries()].filter(([v, n]) => (disponible.get(v) ?? 0) < n.total);
  const costoLinea = new Map<string, number>();
  if (costos && !Array.isArray(costos)) {
    for (const c of ((costos.data as { lineas?: { linea_id: string; costo_unitario: number }[] } | null)?.lineas ?? []))
      costoLinea.set(c.linea_id, Number(c.costo_unitario));
  } else if (Array.isArray(costos)) {
    lineas.forEach((l, i) => costoLinea.set(l.id, Number(costos[i].data ?? 0)));
  }

  return (
    <>
      <Encabezado titulo={`Orden ${orden.numero}`}
                  descripcion={`${(orden.bodegas as unknown as { nombre: string } | null)?.nombre ?? ""} · ${fecha(orden.creado_en)}${orden.observaciones ? ` · ${orden.observaciones}` : ""}`}
                  acciones={<Link href="/estampado" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-morado">Camisetas</h2>
              <span className="ml-auto"><Insignia tono={ESTADOS_ORDEN[orden.estado].tono}>{ESTADOS_ORDEN[orden.estado].texto}</Insignia></span>
            </div>
            <ul className="flex flex-col divide-y divide-borde">
              {lineas.map((l) => (
                <li key={l.id} className="py-3">
                  <p className="font-semibold">{l.variantes?.productos.nombre} · {l.variantes?.sku}</p>
                  <p className="cifra text-sm text-suave">
                    {Number(l.cantidad_planeada)} planeadas
                    {orden.estado === "terminada" && ` · ${Number(l.cantidad_buenas)} buenas · ${Number(l.cantidad_danadas)} dañadas`}
                    {veCostos && costoLinea.has(l.id) && ` · ${orden.estado === "terminada" ? "costo real" : "costo estimado"} ${pesos(costoLinea.get(l.id))} c/u`}
                  </p>
                  <ul className="mt-1 text-sm text-suave">
                    {l.orden_estampado_consumos.map((c) => (
                      <li key={c.variante_id}>· {c.variantes?.productos.nombre}: {numero(c.cantidad_teorica)} {c.variantes?.productos.unidad_medida}
                        {c.cantidad_real !== null && Number(c.cantidad_real) !== Number(c.cantidad_teorica) && ` (real ${numero(c.cantidad_real)})`}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Tarjeta>
          {orden.estado === "borrador" && (
            <Tarjeta className={faltantes.length ? "border-naranja" : ""}>
              <h2 className="mb-2 text-lg font-semibold text-morado">Materiales necesarios</h2>
              <ul className="text-sm">
                {[...necesidad.entries()].map(([v, n]) => {
                  const hay = disponible.get(v) ?? 0;
                  return (
                    <li key={v} className="flex justify-between gap-3 py-1">
                      <span>{n.producto} · {n.sku}</span>
                      <span className={`cifra ${hay < n.total ? "font-bold text-error" : ""}`}>
                        {numero(n.total)} de {numero(hay)} disponibles{hay < n.total ? ` · faltan ${numero(n.total - hay)}` : ""}</span>
                    </li>
                  );
                })}
              </ul>
              {faltantes.length > 0 && <p className="mt-2 text-sm font-semibold text-error">Compra o traslada lo que falta antes de registrar el estampado.</p>}
            </Tarjeta>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {orden.estado === "borrador" && tiene(sesion, "estampado.gestionar") && (
            <Tarjeta>
              <RegistrarEstampado ordenId={orden.id} veCostos={veCostos} lineas={lineas.map((l) => ({
                id: l.id, sku: l.variantes?.sku ?? "", producto: l.variantes?.productos.nombre ?? "", planeada: Number(l.cantidad_planeada),
                consumos: l.orden_estampado_consumos.map((c) => ({
                  variante_id: c.variante_id, sku: c.variantes?.sku ?? "", producto: c.variantes?.productos.nombre ?? "",
                  unidad: c.variantes?.productos.unidad_medida ?? "unidad", teorica: Number(c.cantidad_teorica), disponible: disponible.get(c.variante_id) ?? 0,
                })),
              }))} />
            </Tarjeta>
          )}
          {orden.estado !== "anulada" && tiene(sesion, "estampado.anular") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Anular</h2>
              <p className="mb-3 text-sm text-suave">
                {orden.estado === "terminada" ? "Genera los movimientos contrarios: salen las camisetas y vuelven la base y los materiales." : "La orden queda anulada sin mover inventario."}
              </p>
              <AnularOrden ordenId={orden.id} />
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}
