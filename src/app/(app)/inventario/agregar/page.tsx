import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { todasLasFilas } from "@/lib/exportar";
import { Encabezado } from "@/components/ui/tarjeta";
import { Aviso } from "@/components/ui/aviso";
import { PestanasInventario } from "@/components/app/pestanas-inventario";
import { AgregarInventario, type DatosAgregar } from "./agregar-inventario";

export const metadata: Metadata = { title: "Agregar inventario" };

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Agregar camisetas al inventario por talla y color, en un solo paso
export default async function PaginaAgregar({ searchParams }: { searchParams: Promise<{ producto?: string }> }) {
  const sesion = await exigirPermiso("inventario.ajustar", "compras.gestionar");
  const { producto } = await searchParams;
  const supabase = await crearClienteServidor();
  if (!tiene(sesion, "costos.ver")) {
    return (
      <>
        <Encabezado titulo="Agregar inventario" />
        <Aviso tipo="info">Agregar inventario lleva el costo de las camisetas; lo hace quien administra. Si llegó mercancía de un pedido, recíbela en Compras.</Aviso>
      </>
    );
  }
  type Variante = DatosAgregar["variantes"][number];
  type Existencia = { variante_id: string; bodega_id: string; cantidad: number };
  const [productos, variantes, existencias, tipos, tallas, colores, disenos, proveedores, cuentas] = await Promise.all([
    supabase.from("productos").select("id, codigo, nombre, clase, se_vende").in("clase", ["terminado", "base"])
      .eq("por_pedido", false).eq("activo", true).order("nombre").limit(1000),
    todasLasFilas<Variante>((a, b) => supabase.from("variantes")
      .select("id, producto_id, sku, tipo_id, talla_id, color_id, diseno_id, precio_venta, activo")
      .in("clase", ["terminado", "base"]).order("id").range(a, b) as unknown as Pagina<Variante>),
    todasLasFilas<Existencia>((a, b) => supabase.from("existencias_detalle")
      .select("variante_id, bodega_id, cantidad").in("clase", ["terminado", "base"]).order("variante_id").order("bodega_id")
      .range(a, b) as unknown as Pagina<Existencia>),
    supabase.from("tipos_camiseta").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("tallas").select("id, nombre, orden").eq("activo", true).order("orden"),
    supabase.from("colores").select("id, nombre, hex").eq("activo", true).order("nombre"),
    supabase.from("disenos").select("id, codigo, nombre").eq("activo", true).order("nombre"),
    tiene(sesion, "compras.gestionar")
      ? supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre").limit(1000)
      : Promise.resolve({ data: [] }),
    tiene(sesion, "compras.pagar")
      ? supabase.from("cuentas_dinero").select("id, nombre, tipo, bodega_id").eq("activo", true).order("tipo").order("nombre")
      : Promise.resolve({ data: [] }),
  ]);
  const datos: DatosAgregar = {
    productos: (productos.data ?? []) as DatosAgregar["productos"],
    variantes,
    existencias: existencias.map((e) => ({ ...e, cantidad: Number(e.cantidad) })),
    tipos: tipos.data ?? [], tallas: tallas.data ?? [], colores: colores.data ?? [], disenos: disenos.data ?? [],
    puntos: sesion.bodegas.map((b) => ({ id: b.id, nombre: b.nombre })),
    proveedores: proveedores.data ?? [], cuentas: (cuentas.data ?? []) as DatosAgregar["cuentas"],
    permisos: {
      catalogo: tiene(sesion, "catalogo.gestionar"), directo: tiene(sesion, "inventario.ajustar"),
      compra: tiene(sesion, "compras.gestionar"), pagar: tiene(sesion, "compras.pagar"), proveedores: tiene(sesion, "proveedores.gestionar"),
    },
    productoInicial: productos.data?.some((p) => p.id === producto) ? producto! : null,
  };
  return (
    <>
      <Encabezado titulo="Agregar inventario"
                  descripcion="Elige la camiseta, marca las tallas y los colores y escribe cuántas llegan de cada una."
                  acciones={<Link href="/inventario" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <PestanasInventario actual="/inventario/agregar" permisos={sesion.permisos} />
      {!datos.puntos.length
        ? <Aviso>No tienes un punto o bodega asignado. Créalo en Configuración.</Aviso>
        : <AgregarInventario datos={datos} />}
    </>
  );
}
