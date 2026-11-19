import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Adjunto = { id: string; nombre: string; subido_en: string; url: string | null };

// Adjuntos de un documento con enlaces temporales (10 minutos) a los archivos privados
export async function obtenerAdjuntos(supabase: SupabaseClient, tipo: string, documentoId: string): Promise<Adjunto[]> {
  const { data } = await supabase.from("adjuntos").select("id, ruta, nombre_archivo, subido_en")
    .eq("documento_tipo", tipo).eq("documento_id", documentoId).order("subido_en");
  const filas = (data ?? []) as { id: string; ruta: string; nombre_archivo: string; subido_en: string }[];
  const enlaces = new Map<string, string>();
  if (filas.length) {
    const { data: firmados } = await supabase.storage.from("adjuntos").createSignedUrls(filas.map((f) => f.ruta), 600)
      .catch(() => ({ data: null }));
    for (const f of firmados ?? []) if (f.path && f.signedUrl) enlaces.set(f.path, f.signedUrl);
  }
  return filas.map((f) => ({ id: f.id, nombre: f.nombre_archivo, subido_en: f.subido_en, url: enlaces.get(f.ruta) ?? null }));
}
