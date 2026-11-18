"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type EstadoClave = { error?: string };

const esquema = z
  .object({
    clave: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(72, "Máximo 72 caracteres."),
    confirmacion: z.string(),
  })
  .refine((d) => d.clave === d.confirmacion, { message: "Las dos contraseñas no coinciden.", path: ["confirmacion"] });

export async function cambiarClave(_: EstadoClave, datos: FormData): Promise<EstadoClave> {
  const r = esquema.safeParse({ clave: datos.get("clave"), confirmacion: datos.get("confirmacion") });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/ingresar");
  const { error } = await supabase.auth.updateUser({ password: r.data.clave });
  if (error) return { error: mensajeError(error) };
  const { error: errorPerfil } = await supabase.rpc("actualizar_mi_perfil", { p_clave_cambiada: true });
  if (errorPerfil) return { error: mensajeError(errorPerfil) };
  redirect("/");
}
