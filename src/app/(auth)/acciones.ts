"use server";

import { headers } from "next/headers";
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

/**
 * Dirección pública de la aplicación para el enlace del correo. Si NEXT_PUBLIC_SITE_URL no está
 * configurada se usa la dirección desde la que se hizo la solicitud. Supabase solo acepta
 * direcciones que estén en su lista de Redirect URLs, así que esto no abre redirecciones a terceros.
 */
async function direccionDelSitio() {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configurada) return configurada.replace(/\/+$/, "");
  const h = await headers();
  const origen = h.get("origin");
  if (origen) return origen;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocolo = h.get("x-forwarded-proto") ?? "https";
  return host ? `${protocolo}://${host}` : "http://localhost:3000";
}

export async function recuperar(_: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const r = esquemaRecuperar.safeParse({ correo: datos.get("correo") });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const sitio = await direccionDelSitio();
  const { error } = await supabase.auth.resetPasswordForEmail(r.data.correo, {
    redirectTo: `${sitio}/auth/confirmar?siguiente=/cambiar-clave`,
  });
  // Por seguridad la respuesta es la misma exista o no el correo
  if (error && error.message.includes("rate limit")) return { error: mensajeError(error) };
  return { exito: "Si el correo está registrado, te llegará un enlace para crear una contraseña nueva." };
}
