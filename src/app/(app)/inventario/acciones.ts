"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

function leerLineas(datos: FormData) {
  try {
    const l = JSON.parse(String(datos.get("lineas") ?? "[]"));
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

export async function solicitarAjuste(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("inventario.ajustar");
  const lineas = leerLineas(datos);
  if (!lineas.length) return { error: "Agrega al menos un producto con su cantidad." };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("solicitar_ajuste", {
    p_datos: { bodega_id: datos.get("bodega_id"), tipo: datos.get("tipo"), motivo: datos.get("motivo"), lineas },
  });
  if (error) return { error: mensajeError(error) };
  const { data: ajuste } = await supabase.from("ajustes_inventario").select("numero, estado").eq("id", data).maybeSingle();
  revalidatePath("/inventario", "layout");
  return {
    exito: ajuste?.estado === "aprobado"
      ? `Ajuste ${ajuste.numero} aplicado al inventario.`
      : `Ajuste ${ajuste?.numero ?? ""} registrado. Queda pendiente de aprobación.`,
  };
}

export async function resolverAjuste(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("inventario.aprobar_ajuste");
  const id = z.string().uuid().safeParse(datos.get("id"));
  if (!id.success) return { error: "Ajuste no válido." };
  const aprobar = datos.get("decision") === "aprobar";
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("resolver_ajuste", {
    p_ajuste: id.data, p_aprobar: aprobar, p_observacion: String(datos.get("observacion") ?? "") || null,
  });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/inventario", "layout");
  return { exito: aprobar ? "Ajuste aprobado y aplicado." : "Ajuste rechazado." };
}

export async function guardarTraslado(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("traslados.gestionar");
  const lineas = leerLineas(datos);
  if (!lineas.length) return { error: "Agrega al menos un producto con su cantidad." };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("guardar_traslado", {
    p_traslado: null,
    p_datos: { origen_id: datos.get("origen_id"), destino_id: datos.get("destino_id"), observaciones: datos.get("observaciones"), lineas },
  });
  if (error) return { error: mensajeError(error) };
  if (datos.get("enviar") === "on") {
    const { error: e } = await supabase.rpc("enviar_traslado", { p_traslado: data });
    if (e) return { error: `El traslado quedó en borrador: ${mensajeError(e)}` };
  }
  revalidatePath("/inventario", "layout");
  return { exito: datos.get("enviar") === "on" ? "Traslado enviado: las unidades salieron del origen." : "Traslado guardado en borrador." };
}

export async function accionTraslado(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("traslados.gestionar");
  const id = z.string().uuid().safeParse(datos.get("id"));
  const accion = z.enum(["enviar", "recibir", "anular"]).safeParse(datos.get("accion"));
  if (!id.success || !accion.success) return { error: "Acción no válida." };
  const supabase = await crearClienteServidor();
  const { error } =
    accion.data === "enviar" ? await supabase.rpc("enviar_traslado", { p_traslado: id.data })
    : accion.data === "recibir" ? await supabase.rpc("recibir_traslado", { p_traslado: id.data })
    : await supabase.rpc("anular_traslado", { p_traslado: id.data, p_motivo: String(datos.get("motivo") || "") });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/inventario", "layout");
  return { exito: accion.data === "enviar" ? "Enviado." : accion.data === "recibir" ? "Recibido en el destino." : "Traslado anulado." };
}
