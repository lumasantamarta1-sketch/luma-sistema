"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };
export type ClienteCreado = { id: string; nombre: string; documento: string | null; telefono: string | null };

const opcional = z.string().trim().max(200).transform((v) => v || null);
const esquema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre del cliente.").max(160),
  documento: opcional,
  telefono: opcional,
  whatsapp: opcional,
  correo: z.string().trim().max(200).transform((v) => v || null)
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "El correo no es válido."),
  ciudad: opcional,
  direccion: opcional,
});

// El documento es único: se avisa con un mensaje que diga qué hacer
function errorCliente(error: { message?: string; code?: string }) {
  return error.code === "23505" ? "Ya hay un cliente con ese documento: búscalo por su número." : mensajeError(error);
}

function leer(datos: FormData) {
  const v = (k: string) => String(datos.get(k) ?? "");
  return esquema.safeParse({
    nombre: v("nombre"), documento: v("documento"), telefono: v("telefono"), whatsapp: v("whatsapp"),
    correo: v("correo"), ciudad: v("ciudad"), direccion: v("direccion"),
  });
}

export async function crearCliente(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("clientes.crear", "clientes.gestionar");
  const r = leer(datos);
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("clientes").insert(r.data);
  if (error) return { error: errorCliente(error) };
  revalidatePath("/clientes");
  return { exito: `Cliente «${r.data.nombre}» registrado.` };
}

export async function editarCliente(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("clientes.gestionar");
  const id = z.string().uuid().safeParse(datos.get("id"));
  if (!id.success) return { error: "Cliente no válido." };
  const r = leer(datos);
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("clientes")
    .update({ ...r.data, activo: datos.get("activo") === "on" }).eq("id", id.data);
  if (error) return { error: errorCliente(error) };
  revalidatePath("/clientes");
  return { exito: "Cambios guardados." };
}

// Alta rápida desde el formulario de venta: solo nombre, teléfono y documento
export async function crearClienteRapido(entrada: { nombre: string; telefono?: string; documento?: string }):
  Promise<{ error?: string; cliente?: ClienteCreado }> {
  await exigirPermiso("clientes.crear", "clientes.gestionar");
  const r = esquema.pick({ nombre: true, telefono: true, documento: true })
    .safeParse({ nombre: entrada.nombre ?? "", telefono: entrada.telefono ?? "", documento: entrada.documento ?? "" });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from("clientes").insert(r.data).select("id, nombre, documento, telefono").single();
  if (error) return { error: errorCliente(error) };
  revalidatePath("/clientes");
  return { cliente: data as ClienteCreado };
}
