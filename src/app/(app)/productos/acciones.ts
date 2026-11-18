"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";
import { abreviar } from "@/lib/catalogo";

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
  const [{ data: producto }, { data: catT }, { data: catTa }, { data: catC }, { data: catD }, { data: existentes }] = await Promise.all([
    supabase.from("productos").select("id, codigo, clase, se_vende, por_pedido").eq("id", productoId.data).single(),
    supabase.from("tipos_camiseta").select("id, nombre").in("id", tipos),
    supabase.from("tallas").select("id, nombre").in("id", tallas),
    supabase.from("colores").select("id, nombre").in("id", colores),
    diseno ? supabase.from("disenos").select("id, codigo").eq("id", diseno) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
    supabase.from("variantes").select("tipo_id, talla_id, color_id, diseno_id").eq("producto_id", productoId.data),
  ]);
  if (!producto) return { error: "Producto no encontrado." };
  if (producto.clase === "material") return { error: "Los materiales tienen una sola variante." };
  if (producto.clase === "terminado" && !producto.por_pedido && !diseno) return { error: "Elige el diseño de la camiseta." };
  if (producto.se_vende && precio === null) return { error: "Indica el precio de venta." };

  const disenoId = producto.clase === "terminado" && diseno ? diseno : null;
  const codDiseno = (catD ?? [])[0]?.codigo;
  const ya = new Set((existentes ?? []).map((v) => [v.tipo_id, v.talla_id, v.color_id, v.diseno_id].join("|")));
  const nuevas: Record<string, unknown>[] = [];
  for (const t of catT ?? []) for (const ta of catTa ?? []) for (const c of catC ?? []) {
    if (ya.has([t.id, ta.id, c.id, disenoId].join("|"))) continue;
    const raiz = producto.clase === "terminado" && codDiseno ? codDiseno : producto.codigo;
    nuevas.push({
      producto_id: producto.id, tipo_id: t.id, talla_id: ta.id, color_id: c.id, diseno_id: disenoId,
      sku: [raiz, abreviar(t.nombre), ta.nombre.toUpperCase(), abreviar(c.nombre)].join("-"),
      precio_venta: producto.se_vende ? precio : null, stock_minimo: Number.isFinite(minimo) && minimo > 0 ? minimo : 0,
    });
  }
  if (!nuevas.length) return { error: "Esas combinaciones ya existen." };

  // SKU únicos: si alguno ya existe en otro producto, se le agrega un sufijo
  const { data: usados } = await supabase.from("variantes").select("sku").in("sku", nuevas.map((n) => n.sku as string));
  const ocupados = new Set((usados ?? []).map((u) => u.sku));
  for (const n of nuevas) {
    let sku = n.sku as string; let i = 2;
    while (ocupados.has(sku)) sku = `${n.sku}-${i++}`;
    ocupados.add(sku); n.sku = sku;
  }
  const { error } = await supabase.from("variantes").insert(nuevas);
  if (error) {
    if (error.message.includes("variantes_base_unica_idx")) return { error: "Ya existe una camiseta base con ese tipo, talla y color en otro producto." };
    return { error: mensajeError(error) };
  }
  revalidatePath(`/productos/${producto.id}`);
  return { exito: `${nuevas.length} variante${nuevas.length === 1 ? "" : "s"} creada${nuevas.length === 1 ? "" : "s"}.` };
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
