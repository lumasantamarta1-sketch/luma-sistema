"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ADJUNTO_MAXIMO, ADJUNTO_TIPOS } from "@/lib/archivos";
import { mensajeError } from "@/lib/utilidades";

// Documentos que reciben adjuntos desde la aplicación y la página donde se ven
const PAGINAS: Record<string, string> = { gasto: "/gastos", compra: "/compras" };

// El navegador ya subió el archivo al depósito privado; aquí solo se registra.
// La base de datos verifica que quien lo registra pueda adjuntar a ese documento.
export async function registrarAdjunto(entrada: {
  tipo: string; documentoId: string; ruta: string; nombre: string; mime: string; tamano: number;
}): Promise<{ error?: string }> {
  await exigirSesion();
  const pagina = PAGINAS[entrada.tipo];
  if (!pagina || !z.string().uuid().safeParse(entrada.documentoId).success
      || !entrada.ruta.startsWith(`${entrada.tipo}/${entrada.documentoId}/`)) {
    return { error: "Archivo no válido." };
  }
  if (!ADJUNTO_TIPOS.includes(entrada.mime) || !(entrada.tamano > 0 && entrada.tamano <= ADJUNTO_MAXIMO)) {
    return { error: "Solo se aceptan fotos (JPG, PNG, WEBP) o PDF de hasta 10 MB." };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("adjuntos").insert({
    documento_tipo: entrada.tipo, documento_id: entrada.documentoId, ruta: entrada.ruta,
    nombre_archivo: entrada.nombre.slice(0, 200), tipo_mime: entrada.mime, tamano_bytes: entrada.tamano,
  });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`${pagina}/${entrada.documentoId}`);
  return {};
}
