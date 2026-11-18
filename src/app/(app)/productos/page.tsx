import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CLASES } from "@/lib/catalogo";
import { cn } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Productos" };

type Fila = {
  id: string; codigo: string; nombre: string; clase: string; se_vende: boolean; por_pedido: boolean; activo: boolean;
  categorias: { nombre: string } | null; variantes: { id: string; activo: boolean }[];
};

export default async function PaginaProductos({ searchParams }: { searchParams: Promise<{ clase?: string; q?: string }> }) {
  const sesion = await exigirPermiso("catalogo.ver");
  const { clase = "terminado", q = "" } = await searchParams;
  const supabase = await crearClienteServidor();
  let consulta = supabase.from("productos")
    .select("id, codigo, nombre, clase, se_vende, por_pedido, activo, categorias(nombre), variantes(id, activo)")
    .order("activo", { ascending: false }).order("nombre");
  if (clase in CLASES) consulta = consulta.eq("clase", clase);
  if (q.trim()) consulta = consulta.or(`nombre.ilike.%${q.trim().replace(/[%,()]/g, "")}%,codigo.ilike.%${q.trim().replace(/[%,()]/g, "")}%`);
  const [{ data }, { data: existencias }] = await Promise.all([
    consulta,
    tiene(sesion, "inventario.ver")
      ? supabase.from("existencias_detalle").select("producto_id, cantidad")
      : Promise.resolve({ data: [] as { producto_id: string; cantidad: number }[] }),
  ]);
  const unidades = new Map<string, number>();
  for (const e of existencias ?? []) unidades.set(e.producto_id, (unidades.get(e.producto_id) ?? 0) + Number(e.cantidad));
  const productos = (data ?? []) as unknown as Fila[];

  return (
    <>
      <Encabezado
        titulo="Productos"
        descripcion="Camisetas terminadas, camisetas base y materiales, cada uno con sus variantes."
        acciones={
          <>
            <Link href="/productos/catalogos" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50">
              Tallas, colores y diseños
            </Link>
            {tiene(sesion, "catalogo.gestionar") && (
              <Link href="/productos/nuevo" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
                <Plus className="size-5" aria-hidden /> Nuevo producto
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <nav className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-borde" aria-label="Clase">
          {Object.entries(CLASES).map(([k, v]) => (
            <Link key={k} href={`/productos?clase=${k}`} aria-current={clase === k ? "page" : undefined}
                  className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold",
                                clase === k ? "bg-morado text-white" : "text-suave hover:bg-morado-50")}>{v}</Link>
          ))}
        </nav>
        <form className="sm:ml-auto">
          <input type="hidden" name="clase" value={clase} />
          <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre o código" aria-label="Buscar"
                 className="min-h-11 w-full rounded-xl border border-borde bg-white px-3 sm:w-72" />
        </form>
      </div>
      {productos.length === 0 ? (
        <Tarjeta className="text-center text-suave">
          {q ? "No hay productos con esa búsqueda." : "Aún no hay productos de esta clase."}
        </Tarjeta>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {productos.map((p) => (
            <li key={p.id}>
              <Link href={`/productos/${p.id}`} className="block rounded-2xl border border-borde bg-white p-4 hover:border-morado">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.nombre}</p>
                    <p className="text-sm text-suave">{p.codigo}{p.categorias?.nombre ? ` · ${p.categorias.nombre}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {p.por_pedido && <Insignia tono="marca">Personalizada</Insignia>}
                    {!p.activo && <Insignia tono="error">Inactivo</Insignia>}
                  </div>
                </div>
                <p className="cifra mt-2 text-sm text-suave">
                  {p.variantes.filter((v) => v.activo).length} variante{p.variantes.length === 1 ? "" : "s"}
                  {tiene(sesion, "inventario.ver") && ` · ${Number(unidades.get(p.id) ?? 0).toLocaleString("es-CO")} en inventario`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
