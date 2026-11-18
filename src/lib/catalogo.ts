import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type VarianteOpcion = {
  id: string;
  sku: string;
  clase: "terminado" | "base" | "material";
  producto: string;
  unidad: string;
  detalle: string; // tipo · talla · color · diseño
  precio: number | null;
  activo: boolean;
};

export const CLASES: Record<string, string> = {
  terminado: "Camisetas terminadas",
  base: "Camisetas base",
  material: "Materiales",
};

export const UNIDADES: Record<string, string> = {
  unidad: "unidad", metro: "metro", hoja: "hoja", gramo: "gramo", mililitro: "mililitro",
};

type Fila = {
  id: string; sku: string; clase: VarianteOpcion["clase"]; activo: boolean; precio_venta: number | null;
  productos: { nombre: string; unidad_medida: string } | null;
  tallas: { nombre: string; orden: number } | null;
  colores: { nombre: string } | null;
  tipos_camiseta: { nombre: string } | null;
  disenos: { nombre: string } | null;
};

export function detalleVariante(f: Pick<Fila, "tallas" | "colores" | "tipos_camiseta" | "disenos">) {
  return [f.disenos?.nombre, f.tipos_camiseta?.nombre, f.tallas?.nombre, f.colores?.nombre].filter(Boolean).join(" · ");
}

// Variantes para los selectores de los formularios (respeta RLS: requiere catalogo.ver)
export async function obtenerVariantes(
  supabase: SupabaseClient,
  opciones: { clases?: VarianteOpcion["clase"][]; soloActivas?: boolean } = {},
): Promise<VarianteOpcion[]> {
  let consulta = supabase
    .from("variantes")
    .select("id, sku, clase, activo, precio_venta, productos(nombre, unidad_medida), tallas(nombre, orden), colores(nombre), tipos_camiseta(nombre), disenos(nombre)")
    .order("sku");
  if (opciones.clases?.length) consulta = consulta.in("clase", opciones.clases);
  if (opciones.soloActivas ?? true) consulta = consulta.eq("activo", true);
  const { data } = await consulta;
  return ((data ?? []) as unknown as Fila[])
    .map((f) => ({
      id: f.id,
      sku: f.sku,
      clase: f.clase,
      producto: f.productos?.nombre ?? "",
      unidad: f.productos?.unidad_medida ?? "unidad",
      detalle: detalleVariante(f),
      precio: f.precio_venta,
      activo: f.activo,
    }))
    .sort((a, b) => a.producto.localeCompare(b.producto, "es") || a.sku.localeCompare(b.sku));
}

// Abreviatura para armar SKU: «Cuello redondo» → CR, «Blanco» → BLA
export function abreviar(texto: string, largo = 3) {
  const limpio = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  const palabras = limpio.split(/\s+/).filter(Boolean);
  if (palabras.length > 1) return palabras.map((p) => p[0]).join("").slice(0, 4);
  return limpio.slice(0, largo);
}
