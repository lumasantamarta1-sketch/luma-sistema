"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

const TABLAS = ["categorias", "tallas", "colores", "tipos_camiseta", "disenos"] as const;
const nombre = z.string().trim().min(1, "Escribe el nombre.").max(60);

export async function crearElemento(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("catalogo.gestionar");
  const tabla = z.enum(TABLAS).safeParse(datos.get("tabla"));
  if (!tabla.success) return { error: "Catálogo no válido." };
  const n = nombre.safeParse(datos.get("nombre"));
  if (!n.success) return { error: n.error.issues[0]?.message };
  const fila: Record<string, unknown> = { nombre: n.data };
  if (tabla.data === "tallas") {
    fila.nombre = n.data.toUpperCase();
    fila.orden = Number(datos.get("orden") || 0);
  }
  if (tabla.data === "colores") {
    const hex = String(datos.get("hex") || "");
    if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) return { error: "Color no válido." };
    fila.hex = hex || null;
  }
  if (tabla.data === "disenos") {
    const codigo = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "El código del diseño lleva de 2 a 12 letras o números.")
      .safeParse(datos.get("codigo"));
    if (!codigo.success) return { error: codigo.error.issues[0]?.message };
    fila.codigo = codigo.data;
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from(tabla.data).insert(fila);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/productos", "layout");
  return { exito: "Agregado." };
}

export async function cambiarEstado(datos: FormData) {
  await exigirPermiso("catalogo.gestionar");
  const tabla = z.enum(TABLAS).parse(datos.get("tabla"));
  const id = z.string().uuid().parse(datos.get("id"));
  const supabase = await crearClienteServidor();
  await supabase.from(tabla).update({ activo: datos.get("activo") === "true" }).eq("id", id);
  revalidatePath("/productos", "layout");
}

// Receta: cuánto material gasta una camiseta de este diseño (puede variar por talla)
export async function agregarMaterial(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("catalogo.gestionar");
  const r = z.object({
    diseno_id: z.string().uuid(),
    material_id: z.string().uuid({ message: "Elige el material." }),
    talla_id: z.string().uuid().or(z.literal("")).transform((v) => v || null),
    cantidad: z.coerce.number().positive("La cantidad debe ser mayor que cero."),
  }).safeParse(Object.fromEntries(datos));
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("diseno_materiales").insert(r.data);
  if (error) return { error: error.code === "23505" ? "Ese material ya está en la receta para esa talla." : mensajeError(error) };
  revalidatePath("/productos/catalogos");
  return { exito: "Material agregado a la receta." };
}

export async function quitarMaterial(datos: FormData) {
  await exigirPermiso("catalogo.gestionar");
  const id = z.string().uuid().parse(datos.get("id"));
  const supabase = await crearClienteServidor();
  await supabase.from("diseno_materiales").delete().eq("id", id);
  revalidatePath("/productos/catalogos");
}
