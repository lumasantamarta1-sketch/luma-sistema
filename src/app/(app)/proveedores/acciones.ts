"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

const opcional = z.string().trim().max(200).transform((v) => v || null);
const esquema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre del proveedor.").max(160),
  identificacion_tributaria: opcional,
  contacto: opcional,
  telefono: opcional,
  correo: z.string().trim().max(200).transform((v) => v || null)
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "El correo no es válido."),
  direccion: opcional,
  observaciones: z.string().trim().max(500).transform((v) => v || null),
});

function leer(datos: FormData) {
  const v = (k: string) => String(datos.get(k) ?? "");
  return esquema.safeParse({
    nombre: v("nombre"), identificacion_tributaria: v("identificacion_tributaria"), contacto: v("contacto"),
    telefono: v("telefono"), correo: v("correo"), direccion: v("direccion"), observaciones: v("observaciones"),
  });
}

// La identificación es única: el mensaje dice qué hacer
function errorProveedor(error: { message?: string; code?: string }) {
  return error.code === "23505" ? "Ya hay un proveedor con esa identificación: búscalo en la lista." : mensajeError(error);
}

export async function crearProveedor(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("proveedores.gestionar");
  const r = leer(datos);
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("proveedores").insert(r.data);
  if (error) return { error: errorProveedor(error) };
  revalidatePath("/proveedores");
  revalidatePath("/compras", "layout");
  return { exito: `Proveedor «${r.data.nombre}» registrado.` };
}

export async function editarProveedor(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("proveedores.gestionar");
  const id = z.string().uuid().safeParse(datos.get("id"));
  if (!id.success) return { error: "Proveedor no válido." };
  const r = leer(datos);
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("proveedores").update({ ...r.data, activo: datos.get("activo") === "on" }).eq("id", id.data);
  if (error) return { error: errorProveedor(error) };
  revalidatePath("/proveedores");
  revalidatePath("/compras", "layout");
  return { exito: "Cambios guardados." };
}
