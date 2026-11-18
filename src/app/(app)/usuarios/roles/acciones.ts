"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

export async function crearRol(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("usuarios.gestionar");
  const r = z
    .object({
      nombre: z.string().trim().min(3, "Escribe el nombre del rol.").max(40),
      descripcion: z.string().trim().max(200).optional(),
    })
    .safeParse({ nombre: datos.get("nombre"), descripcion: datos.get("descripcion") || undefined });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const codigo = r.data.nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (!codigo) return { error: "El nombre debe tener letras." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("roles").insert({ codigo, nombre: r.data.nombre, descripcion: r.data.descripcion });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/usuarios/roles");
  return { exito: `Rol «${r.data.nombre}» creado. Ahora marca sus permisos.` };
}

// Guarda la selección de permisos de un rol. La base de datos impide quitarle permisos al
// Administrador y dar a otros roles descuentos, crédito o todos los puntos.
export async function guardarPermisos(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("usuarios.gestionar");
  const rolId = z.string().uuid().safeParse(datos.get("rol_id"));
  if (!rolId.success) return { error: "Rol no válido." };
  const elegidos = new Set(datos.getAll("permisos").map(String));
  const supabase = await crearClienteServidor();
  const { data: actuales, error } = await supabase.from("rol_permisos").select("permiso_codigo").eq("rol_id", rolId.data);
  if (error) return { error: mensajeError(error) };
  const tiene = new Set((actuales ?? []).map((a) => a.permiso_codigo));
  const agregar = [...elegidos].filter((p) => !tiene.has(p));
  const quitar = [...tiene].filter((p) => !elegidos.has(p));
  if (agregar.length) {
    const { error: e } = await supabase.from("rol_permisos").insert(agregar.map((p) => ({ rol_id: rolId.data, permiso_codigo: p })));
    if (e) return { error: mensajeError(e) };
  }
  if (quitar.length) {
    const { error: e } = await supabase.from("rol_permisos").delete().eq("rol_id", rolId.data).in("permiso_codigo", quitar);
    if (e) return { error: mensajeError(e) };
  }
  revalidatePath("/usuarios/roles");
  return { exito: agregar.length || quitar.length ? "Permisos guardados." : "No hubo cambios." };
}
