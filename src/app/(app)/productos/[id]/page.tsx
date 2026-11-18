import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CLASES, detalleVariante } from "@/lib/catalogo";
import { pesos } from "@/lib/utilidades";
import { FilaVariante, FormularioProducto, GeneradorVariantes } from "../formularios";

export const metadata: Metadata = { title: "Producto" };

type Variante = {
  id: string; sku: string; precio_venta: number | null; stock_minimo: number; activo: boolean;
  tallas: { nombre: string; orden: number } | null; colores: { nombre: string } | null;
  tipos_camiseta: { nombre: string } | null; disenos: { nombre: string } | null;
};

export default async function PaginaProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await exigirPermiso("catalogo.ver");
  const supabase = await crearClienteServidor();
  const { data: producto } = await supabase.from("productos").select("*").eq("id", id).maybeSingle();
  if (!producto) notFound();
  const veCostos = tiene(sesion, "costos.ver");
  const [{ data: variantes }, { data: categorias }, { data: existencias }, { data: costos }, catalogos] = await Promise.all([
    supabase.from("variantes")
      .select("id, sku, precio_venta, stock_minimo, activo, tallas(nombre, orden), colores(nombre), tipos_camiseta(nombre), disenos(nombre)")
      .eq("producto_id", id),
    supabase.from("categorias").select("id, nombre").eq("activo", true).order("nombre"),
    tiene(sesion, "inventario.ver")
      ? supabase.from("existencias_detalle").select("variante_id, cantidad, apartada").eq("producto_id", id)
      : Promise.resolve({ data: [] as { variante_id: string; cantidad: number; apartada: number }[] }),
    veCostos
      ? supabase.from("variante_costos").select("variante_id, costo_promedio")
      : Promise.resolve({ data: [] as { variante_id: string; costo_promedio: number }[] }),
    Promise.all([
      supabase.from("tipos_camiseta").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("tallas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("colores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("disenos").select("id, nombre").eq("activo", true).order("nombre"),
    ]),
  ]);
  const stock = new Map<string, { cantidad: number; apartada: number }>();
  for (const e of existencias ?? []) {
    const s = stock.get(e.variante_id) ?? { cantidad: 0, apartada: 0 };
    stock.set(e.variante_id, { cantidad: s.cantidad + Number(e.cantidad), apartada: s.apartada + Number(e.apartada) });
  }
  const costo = new Map((costos ?? []).map((c) => [c.variante_id, Number(c.costo_promedio)]));
  const lista = ((variantes ?? []) as unknown as Variante[]).sort(
    (a, b) => (a.tallas?.orden ?? 0) - (b.tallas?.orden ?? 0) || a.sku.localeCompare(b.sku));
  const puedeCatalogo = tiene(sesion, "catalogo.gestionar");
  const puedePrecio = tiene(sesion, "precios.gestionar") && producto.se_vende;

  return (
    <>
      <Encabezado titulo={producto.nombre} descripcion={`${producto.codigo} · ${CLASES[producto.clase]}`}
                  acciones={<Link href={`/productos?clase=${producto.clase}`} className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <h2 className="mb-3 text-lg font-semibold text-morado">Variantes</h2>
            {lista.length === 0 && <p className="text-suave">Aún no tiene variantes.</p>}
            <ul className="flex flex-col divide-y divide-borde">
              {lista.map((v) => {
                const s = stock.get(v.id);
                const c = costo.get(v.id);
                const margen = veCostos && c && v.precio_venta ? (Number(v.precio_venta) - c) / Number(v.precio_venta) : null;
                return (
                  <li key={v.id} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{v.sku}</span>
                      <span className="text-sm text-suave">{detalleVariante(v)}</span>
                      {!v.activo && <Insignia tono="error">Inactiva</Insignia>}
                      <span className="cifra ml-auto text-sm">
                        {v.precio_venta !== null && <span className="font-semibold">{pesos(v.precio_venta)}</span>}
                        {s && <span className="text-suave"> · {s.cantidad.toLocaleString("es-CO")} und{s.apartada ? ` (${s.apartada} apartadas)` : ""}</span>}
                      </span>
                    </div>
                    {veCostos && c !== undefined && (
                      <p className="cifra text-sm text-suave">Costo promedio {pesos(c)}{margen !== null && ` · margen ${(margen * 100).toFixed(1)} %`}</p>
                    )}
                    <FilaVariante variante={v} puedePrecio={puedePrecio} puedeCatalogo={puedeCatalogo} />
                  </li>
                );
              })}
            </ul>
          </Tarjeta>
          {puedeCatalogo && producto.clase !== "material" && (
            <Tarjeta>
              <GeneradorVariantes productoId={producto.id} clase={producto.clase} seVende={producto.se_vende}
                                  porPedido={producto.por_pedido}
                                  catalogos={{ tipos: catalogos[0].data ?? [], tallas: catalogos[1].data ?? [],
                                               colores: catalogos[2].data ?? [], disenos: catalogos[3].data ?? [] }} />
            </Tarjeta>
          )}
        </div>
        {puedeCatalogo && (
          <Tarjeta className="h-fit">
            <h2 className="mb-3 text-lg font-semibold text-morado">Datos del producto</h2>
            <FormularioProducto producto={producto} categorias={categorias ?? []} />
          </Tarjeta>
        )}
      </div>
    </>
  );
}
