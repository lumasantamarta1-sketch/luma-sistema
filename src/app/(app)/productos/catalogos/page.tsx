import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { AgregarElemento, AgregarMaterial } from "./formularios";
import { cambiarEstado, quitarMaterial } from "./acciones";

export const metadata: Metadata = { title: "Catálogos" };

type Elemento = { id: string; nombre: string; activo: boolean; codigo?: string; hex?: string | null; orden?: number };

function Lista({ titulo, tabla, elementos, editable }: { titulo: string; tabla: string; elementos: Elemento[]; editable: boolean }) {
  return (
    <Tarjeta>
      <h2 className="mb-3 text-lg font-semibold text-morado">{titulo}</h2>
      {elementos.length === 0 && <p className="mb-3 text-sm text-suave">Aún no hay {titulo.toLowerCase()}.</p>}
      <ul className="mb-3 flex flex-wrap gap-2">
        {elementos.map((e) => (
          <li key={e.id} className="flex items-center gap-2 rounded-xl border border-borde px-3 py-1.5">
            {e.hex && <span className="size-4 rounded-full border border-borde" style={{ background: e.hex }} aria-hidden />}
            <span className={e.activo ? "" : "text-suave line-through"}>{e.codigo ? `${e.codigo} · ` : ""}{e.nombre}</span>
            {editable && (
              <form action={cambiarEstado}>
                <input type="hidden" name="tabla" value={tabla} />
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="activo" value={String(!e.activo)} />
                <button type="submit" className="text-xs font-semibold text-morado underline">{e.activo ? "Desactivar" : "Activar"}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {editable && <AgregarElemento tabla={tabla} />}
    </Tarjeta>
  );
}

export default async function PaginaCatalogos() {
  const sesion = await exigirPermiso("catalogo.ver");
  const editable = tiene(sesion, "catalogo.gestionar");
  const supabase = await crearClienteServidor();
  const [cat, tal, col, tip, dis, rec, mat] = await Promise.all([
    supabase.from("categorias").select("id, nombre, activo").order("nombre"),
    supabase.from("tallas").select("id, nombre, activo, orden").order("orden"),
    supabase.from("colores").select("id, nombre, activo, hex").order("nombre"),
    supabase.from("tipos_camiseta").select("id, nombre, activo").order("nombre"),
    supabase.from("disenos").select("id, codigo, nombre, activo").order("nombre"),
    supabase.from("diseno_materiales").select("id, diseno_id, cantidad, variantes(sku, productos(nombre, unidad_medida)), tallas(nombre)"),
    supabase.from("variantes").select("id, sku, productos(nombre, unidad_medida)").eq("clase", "material").eq("activo", true).order("sku"),
  ]);
  type Receta = { id: string; diseno_id: string; cantidad: number; variantes: { sku: string; productos: { nombre: string; unidad_medida: string } } | null; tallas: { nombre: string } | null };
  const recetas = (rec.data ?? []) as unknown as Receta[];
  const materiales = ((mat.data ?? []) as unknown as { id: string; sku: string; productos: { nombre: string; unidad_medida: string } }[])
    .map((m) => ({ id: m.id, etiqueta: `${m.productos.nombre} (${m.productos.unidad_medida})` }));

  return (
    <>
      <Encabezado titulo="Tallas, colores y diseños" descripcion="Los catálogos no se borran: se desactivan para conservar el historial."
                  acciones={<Link href="/productos" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver a productos</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Lista titulo="Tallas" tabla="tallas" elementos={tal.data ?? []} editable={editable} />
        <Lista titulo="Colores" tabla="colores" elementos={col.data ?? []} editable={editable} />
        <Lista titulo="Tipos de camiseta" tabla="tipos_camiseta" elementos={tip.data ?? []} editable={editable} />
        <Lista titulo="Categorías" tabla="categorias" elementos={cat.data ?? []} editable={editable} />
      </div>
      <Tarjeta className="mt-4">
        <h2 className="text-lg font-semibold text-morado">Diseños y recetas</h2>
        <p className="mb-3 text-sm text-suave">La receta dice cuánto material gasta una camiseta de cada diseño. La camiseta base sale de la variante.</p>
        <ul className="mb-4 flex flex-col divide-y divide-borde">
          {(dis.data ?? []).map((d) => (
            <li key={d.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-semibold">{d.codigo} · {d.nombre}</span>
                  {!d.activo && <Insignia tono="error">Inactivo</Insignia>}
                  <span className="text-sm text-suave">{recetas.filter((r) => r.diseno_id === d.id).length} material(es)</span>
                </summary>
                <div className="mt-3 flex flex-col gap-3 pl-1">
                  <ul className="flex flex-col gap-1">
                    {recetas.filter((r) => r.diseno_id === d.id).map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-sm">
                        <span>{r.variantes?.productos.nombre}: <b className="cifra">{Number(r.cantidad)}</b> {r.variantes?.productos.unidad_medida}
                          {r.tallas ? ` · talla ${r.tallas.nombre}` : " · todas las tallas"}</span>
                        {editable && (
                          <form action={quitarMaterial}><input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="text-xs font-semibold text-error underline">Quitar</button></form>
                        )}
                      </li>
                    ))}
                  </ul>
                  {editable && <AgregarMaterial disenoId={d.id} materiales={materiales} tallas={(tal.data ?? []).filter((t) => t.activo)} />}
                  {editable && (
                    <form action={cambiarEstado}>
                      <input type="hidden" name="tabla" value="disenos" /><input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="activo" value={String(!d.activo)} />
                      <button type="submit" className="text-sm font-semibold text-morado underline">{d.activo ? "Desactivar diseño" : "Activar diseño"}</button>
                    </form>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
        {editable && <AgregarElemento tabla="disenos" />}
      </Tarjeta>
    </>
  );
}
