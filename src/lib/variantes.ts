import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { abreviar } from "@/lib/catalogo";
import { mensajeError } from "@/lib/utilidades";

// Creación de variantes (tipo × talla × color, y diseño en las estampadas), compartida por
// la ficha del producto y por «Agregar inventario». El SKU es RAÍZ-TIPO-TALLA-COLOR; si ya
// está ocupado por otro producto se le agrega un sufijo (-2, -3…).

type Opcion = { id: string; nombre: string };
export type Combinacion = { tipo: Opcion; talla: Opcion; color: Opcion };
export type ProductoVariantes = { id: string; codigo: string; clase: string; se_vende: boolean };

export const claveCombinacion = (tipo: string | null, talla: string | null, color: string | null, diseno: string | null) =>
  [tipo, talla, color, diseno].join("|");

export async function crearVariantesFaltantes(supabase: SupabaseClient, d: {
  producto: ProductoVariantes; disenoId: string | null; codigoDiseno?: string | null;
  combinaciones: Combinacion[]; precio: number | null; minimo: number;
}): Promise<{ creadas: number; error?: string }> {
  const { data: existentes, error: e1 } = await supabase.from("variantes")
    .select("tipo_id, talla_id, color_id, diseno_id").eq("producto_id", d.producto.id);
  if (e1) return { creadas: 0, error: mensajeError(e1) };
  const ya = new Set((existentes ?? []).map((v) => claveCombinacion(v.tipo_id, v.talla_id, v.color_id, v.diseno_id)));
  const raiz = d.producto.clase === "terminado" && d.codigoDiseno ? d.codigoDiseno : d.producto.codigo;
  const nuevas: { producto_id: string; tipo_id: string; talla_id: string; color_id: string; diseno_id: string | null;
    sku: string; precio_venta: number | null; stock_minimo: number }[] = [];
  for (const c of d.combinaciones) {
    const k = claveCombinacion(c.tipo.id, c.talla.id, c.color.id, d.disenoId);
    if (ya.has(k)) continue;
    ya.add(k);
    nuevas.push({
      producto_id: d.producto.id, tipo_id: c.tipo.id, talla_id: c.talla.id, color_id: c.color.id, diseno_id: d.disenoId,
      sku: [raiz, abreviar(c.tipo.nombre), c.talla.nombre.toUpperCase(), abreviar(c.color.nombre)].join("-"),
      precio_venta: d.producto.se_vende ? d.precio : null,
      stock_minimo: Number.isFinite(d.minimo) && d.minimo > 0 ? d.minimo : 0,
    });
  }
  if (!nuevas.length) return { creadas: 0 };

  const { data: usados } = await supabase.from("variantes").select("sku").in("sku", nuevas.map((n) => n.sku));
  const ocupados = new Set((usados ?? []).map((u) => u.sku as string));
  for (const n of nuevas) {
    let sku = n.sku;
    for (let i = 2; ocupados.has(sku); i++) sku = `${n.sku}-${i}`;
    ocupados.add(sku);
    n.sku = sku;
  }
  const { error } = await supabase.from("variantes").insert(nuevas);
  if (error) {
    if (error.message.includes("variantes_base_unica_idx")) {
      return { creadas: 0, error: "Esa camiseta base (tipo, talla y color) ya existe en otro producto: agrégala desde ese producto." };
    }
    return { creadas: 0, error: mensajeError(error) };
  }
  return { creadas: nuevas.length };
}

// Código libre a partir de un nombre: «Camiseta Navidad Roja» → CNR, CNR-2, CNR-3…
export async function codigoLibre(supabase: SupabaseClient, tabla: "productos" | "disenos", nombre: string, largo: number) {
  let base = abreviar(nombre, 6).replace(/[^A-Z0-9]/g, "");
  if (base.length < 2) base = `${base}CAM`.slice(0, 3);
  base = base.slice(0, largo - 3);
  const { data } = await supabase.from(tabla).select("codigo").ilike("codigo", `${base}%`).limit(1000);
  const usados = new Set((data ?? []).map((x) => String(x.codigo).toUpperCase()));
  let codigo = base;
  for (let i = 2; usados.has(codigo); i++) codigo = `${base}-${i}`;
  return codigo;
}
