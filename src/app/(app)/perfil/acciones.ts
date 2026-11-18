"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { exigirSesion } from "@/lib/sesion";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

export async function actualizarNombre(_: Estado, datos: FormData): Promise<Estado> {
  await exigirSesion();
  const r = z.string().trim().min(2, "Escribe tu nombre.").max(80).safeParse(datos.get("nombre"));
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("actualizar_mi_perfil", { p_nombre: r.data });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/", "layout");
  return { exito: "Nombre actualizado." };
}
