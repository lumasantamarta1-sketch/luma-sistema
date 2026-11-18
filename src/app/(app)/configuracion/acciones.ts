"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

const numero = (min: number, max: number) => z.coerce.number().min(min).max(max);

export async function guardarNegocio(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("configuracion.gestionar");
  const r = z
    .object({
      nombre_comercial: z.string().trim().min(2, "Escribe el nombre comercial.").max(60),
      eslogan: z.string().trim().max(80),
      permite_venta_bajo_pedido: z.boolean(),
      anticipo_minimo_pct: numero(0, 100),
      umbral_aprobacion_ajuste: numero(0, 1_000_000_000),
      umbral_pocas_unidades: numero(0, 100_000),
      dias_sin_movimiento: numero(1, 3650),
      minutos_inactividad: numero(1, 1440),
    })
    .safeParse({
      ...Object.fromEntries(datos),
      permite_venta_bajo_pedido: datos.get("permite_venta_bajo_pedido") === "on",
    });
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los valores." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("configuracion_negocio")
    .update({ ...r.data, actualizado_en: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/", "layout");
  return { exito: "Configuración guardada." };
}

const esquemaPunto = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "El código lleva de 2 a 12 letras o números."),
  nombre: z.string().trim().min(2, "Escribe el nombre del punto.").max(60),
  tipo: z.enum(["punto_venta", "taller", "bodega"]),
  direccion: z.string().trim().max(120).optional(),
});

export async function crearPunto(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("configuracion.gestionar");
  const r = esquemaPunto.safeParse({ ...Object.fromEntries(datos), direccion: datos.get("direccion") || undefined });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("bodegas").insert(r.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/", "layout");
  return { exito: r.data.tipo === "punto_venta" ? `«${r.data.nombre}» creado con su caja de efectivo.` : `«${r.data.nombre}» creado.` };
}

export async function cambiarEstadoPunto(datos: FormData) {
  await exigirPermiso("configuracion.gestionar");
  const id = z.string().uuid().parse(datos.get("id"));
  const activo = datos.get("activo") === "true";
  const supabase = await crearClienteServidor();
  await supabase.from("bodegas").update({ activo }).eq("id", id);
  revalidatePath("/", "layout");
}
