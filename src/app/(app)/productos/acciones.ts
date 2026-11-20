"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";
import { crearVariantesFaltantes } from "@/lib/variantes";

export type Estado = { error?: string; exito?: string };

const uuid = z.string().uuid();
const opcionalUuid = uuid.or(z.literal("")).transform((v) => v || null);

const esquemaProducto = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "El código lleva de 2 a 20 letras, números o guiones."),
  nombre: z.string().trim().min(2, "Escribe el nombre.").max(80),
  clase: z.enum(["terminado", "base", "material"]),
  categoria_id: opcionalUuid,
  unidad_medida: z.enum(["unidad", "metro", "hoja", "gramo", "mililitro"]),
  se_vende: z.boolean(),
  por_pedido: z.boolean(),
  descripcion: z.string().trim().max(500).transform((v) => v || null),
  activo: z.boolean(),
});

function leerProducto(datos: FormData) {
  const clase = String(datos.get("clase") ?? "");
  return esquemaProducto.safeParse({
    codigo: datos.get("codigo"),
    nombre: datos.get("nombre"),
    clase,
    categoria_id: datos.get("categoria_id") ?? "",
    unidad_medida: clase === "material" ? datos.get("unidad_medida") : "unidad",
    se_vende: clase === "terminado" ? true : datos.get("se_vende") === "on",
    por_pedido: clase === "terminado" && datos.get("por_pedido") === "on",
    descripcion: datos.get("descripcion") ?? "",
    activo: datos.has("con_estado") ? datos.get("activo") === "on" : true,
  });
}

export async function crearProducto(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("catalogo.gestionar");
  const r = leerProducto(datos);
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from("productos").insert(r.data).select("id").single();
  if (error) return { error: mensajeError(error) };
  // Un material tiene una sola variante, con su mismo código
  if (r.data.clase === "material") {
    const { error: e } = await supabase.from("variantes").insert({ producto_id: data.id, sku: r.data.codigo });
    if (e) return { error: mensajeError(e) };
  }
  revalidatePath("/productos");
  redirect(`/productos/${data.id}`);
}

export async function actualizarProducto(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("catalogo.gestionar");
  const id = uuid.safeParse(datos.get("id"));
  const r = leerProducto(datos);
  if (!id.success || !r.success) return { error: r.success ? "Producto no válido." : r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { codigo, nombre, categoria_id, descripcion, se_vende, por_pedido, activo } = r.data;
  const { error } = await supabase.from("productos")
    .update({ codigo, nombre, categoria_id, descripcion, se_vende, por_pedido, activo }).eq("id", id.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/productos/${id.data}`);
  return { exito: "Producto guardado." };
}

// Crea las combinaciones elegidas que aún no existan, con SKU único
export async function generarVariantes(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("catalogo.gestionar");
  const productoId = uuid.safeParse(datos.get("producto_id"));
  if (!productoId.success) return { error: "Producto no válido." };
  const tipos = datos.getAll("tipos").map(String).filter((v) => uuid.safeParse(v).success);
  const tallas = datos.getAll("tallas").map(String).filter((v) => uuid.safeParse(v).success);
  const colores = datos.getAll("colores").map(String).filter((v) => uuid.safeParse(v).success);
  const diseno = String(datos.get("diseno_id") ?? "");
  const precioTexto = String(datos.get("precio_venta") ?? "").trim();
  const precio = precioTexto === "" ? null : Number(precioTexto);
  const minimo = Number(datos.get("stock_minimo") || 0);
  if (!tipos.length || !tallas.length || !colores.length) return { error: "Elige al menos un tipo, una talla y un color." };
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) return { error: "El precio no es válido." };

  const supabase = await crearClienteServidor();
  const [{ data: producto }, { data: catT }, { data: catTa }, { data: catC }, { data: catD }] = await Promise.all([
    supabase.from("productos").select("id, codigo, clase, se_vende, por_pedido").eq("id", productoId.data).single(),
    supabase.from("tipos_camiseta").select("id, nombre").in("id", tipos),
    supabase.from("tallas").select("id, nombre").in("id", tallas),
    supabase.from("colores").select("id, nombre").in("id", colores),
    diseno ? supabase.from("disenos").select("id, codigo").eq("id", diseno) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
  ]);
  if (!producto) return { error: "Producto no encontrado." };
  if (producto.clase === "material") return { error: "Los materiales tienen una sola variante." };
  if (producto.clase === "terminado" && !producto.por_pedido && !diseno) return { error: "Elige el diseño de la camiseta." };
  if (producto.se_vende && precio === null) return { error: "Indica el precio de venta." };

  const disenoId = producto.clase === "terminado" && diseno ? diseno : null;
  const combinaciones = (catT ?? []).flatMap((tipo) => (catTa ?? []).flatMap((talla) => (catC ?? []).map((color) => ({ tipo, talla, color }))));
  const r = await crearVariantesFaltantes(supabase, {
    producto, disenoId, codigoDiseno: (catD ?? [])[0]?.codigo, combinaciones,
    precio, minimo: Number.isFinite(minimo) ? minimo : 0,
  });
  if (r.error) return { error: r.error };
  if (!r.creadas) return { error: "Esas combinaciones ya existen." };
  revalidatePath(`/productos/${producto.id}`);
  return { exito: `${r.creadas} variante${r.creadas === 1 ? "" : "s"} creada${r.creadas === 1 ? "" : "s"}.` };
}

export async function actualizarVariante(_: Estado, datos: FormData): Promise<Estado> {
  const sesion = await exigirPermiso("catalogo.gestionar", "precios.gestionar");
  const id = uuid.safeParse(datos.get("id"));
  if (!id.success) return { error: "Variante no válida." };
  const supabase = await crearClienteServidor();
  const cambios: Record<string, unknown> = {};
  if (sesion.permisos.includes("precios.gestionar") && datos.has("precio_venta")) {
    const p = String(datos.get("precio_venta")).trim();
    cambios.precio_venta = p === "" ? null : Number(p);
    if (cambios.precio_venta !== null && (!Number.isFinite(cambios.precio_venta) || (cambios.precio_venta as number) < 0))
      return { error: "El precio no es válido." };
  }
  if (sesion.permisos.includes("catalogo.gestionar")) {
    const minimo = Number(datos.get("stock_minimo") || 0);
    if (!Number.isFinite(minimo) || minimo < 0) return { error: "El mínimo no es válido." };
    cambios.stock_minimo = minimo;
    cambios.activo = datos.get("activo") === "on";
  }
  const { error } = await supabase.from("variantes").update(cambios).eq("id", id.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/productos", "layout");
  return { exito: "Guardado." };
}
