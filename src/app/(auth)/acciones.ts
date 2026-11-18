"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type EstadoFormulario = { error?: string; exito?: string; campos?: Record<string, string> };

const esquemaIngreso = z.object({
  correo: z.string().trim().toLowerCase().email("Escribe un correo válido."),
  clave: z.string().min(1, "Escribe tu contraseña."),
});

export async function ingresar(_: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const r = esquemaIngreso.safeParse({ correo: datos.get("correo"), clave: datos.get("clave") });
  if (!r.success) {
    return { error: r.error.issues[0]?.message, campos: { correo: String(datos.get("correo") ?? "") } };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: r.data.correo, password: r.data.clave });
  if (error) return { error: mensajeError(error), campos: { correo: r.data.correo } };
  redirect("/");
}

const esquemaRecuperar = z.object({ correo: z.string().trim().toLowerCase().email("Escribe un correo válido.") });

export async function recuperar(_: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const r = esquemaRecuperar.safeParse({ correo: datos.get("correo") });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.resetPasswordForEmail(r.data.correo, {
    redirectTo: `${sitio}/auth/confirmar?siguiente=/cambiar-clave`,
  });
  // Por seguridad la respuesta es la misma exista o no el correo
  if (error && error.message.includes("rate limit")) return { error: mensajeError(error) };
  return { exito: "Si el correo está registrado, te llegará un enlace para crear una contraseña nueva." };
}
