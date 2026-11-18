"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

export async function crearOrden(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("estampado.gestionar");
  let lineas: { variante_id: string; cantidad: number }[] = [];
  try { lineas = JSON.parse(String(datos.get("lineas") ?? "[]")); } catch { /* vacío */ }
  if (!lineas.length) return { error: "Agrega al menos una camiseta para estampar." };
  const costos = String(datos.get("costos_adicionales") ?? "").trim();
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("guardar_orden_estampado", {
    p_orden: null,
    p_datos: {
      bodega_id: datos.get("bodega_id"), observaciones: datos.get("observaciones"),
      lineas: lineas.map((l) => ({ variante_id: l.variante_id, cantidad: l.cantidad })),
      ...(costos ? { costos_adicionales: Number(costos) } : {}),
    },
  });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/estampado");
  redirect(`/estampado/${data}`);
}

// Arma el resultado de cada línea desde el formulario: buenas, dañadas y consumo real opcional
export async function registrarEstampado(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("estampado.gestionar");
  const orden = z.string().uuid().safeParse(datos.get("orden_id"));
  if (!orden.success) return { error: "Orden no válida." };
  const lineas = new Map<string, { linea_id: string; buenas: number; danadas: number; consumos: { variante_id: string; cantidad: number }[] }>();
  for (const [clave, valor] of datos.entries()) {
    const [campo, lineaId, varianteId] = clave.split("__");
    if (!lineaId || !["buenas", "danadas", "consumo"].includes(campo)) continue;
    const l = lineas.get(lineaId) ?? { linea_id: lineaId, buenas: 0, danadas: 0, consumos: [] };
    const n = Number(String(valor).trim() || "NaN");
    if (campo === "buenas") l.buenas = Number.isFinite(n) ? n : 0;
    if (campo === "danadas") l.danadas = Number.isFinite(n) ? n : 0;
    if (campo === "consumo" && Number.isFinite(n) && varianteId) l.consumos.push({ variante_id: varianteId, cantidad: n });
    lineas.set(lineaId, l);
  }
  const p_datos: Record<string, unknown> = { lineas: [...lineas.values()] };
  const costos = String(datos.get("costos_adicionales") ?? "").trim();
  if (costos) p_datos.costos_adicionales = Number(costos);
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_estampado", { p_orden: orden.data, p_datos });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/estampado", "layout");
  revalidatePath("/inventario", "layout");
  return { exito: "Estampado registrado: salieron la base y los materiales, y entraron las camisetas." };
}

export async function anularOrden(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("estampado.anular");
  const orden = z.string().uuid().safeParse(datos.get("orden_id"));
  if (!orden.success) return { error: "Orden no válida." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("anular_estampado", { p_orden: orden.data, p_motivo: String(datos.get("motivo") ?? "") });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/estampado", "layout");
  revalidatePath("/inventario", "layout");
  return { exito: "Orden anulada." };
}
