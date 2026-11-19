"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { registrarAdjunto } from "@/app/acciones-adjuntos";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { ADJUNTO_MAXIMO, ADJUNTO_TIPOS } from "@/lib/archivos";
import { Aviso } from "@/components/ui/aviso";

// Sube la foto o el PDF directo al depósito privado (no pasa por el servidor) y luego lo registra
export function SubirAdjunto({ tipo, documentoId, texto = "Adjuntar foto o PDF", ayuda }: {
  tipo: "gasto" | "compra"; documentoId: string; texto?: string; ayuda?: string;
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [subiendo, iniciar] = useTransition();
  const id = `adjunto-${tipo}-${documentoId}`;

  function subir(archivo: File) {
    setError("");
    if (!ADJUNTO_TIPOS.includes(archivo.type)) { setError("Solo se aceptan fotos (JPG, PNG, WEBP) o PDF."); return; }
    if (archivo.size > ADJUNTO_MAXIMO) { setError("El archivo pesa más de 10 MB."); return; }
    iniciar(async () => {
      const nombre = archivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
      const ruta = `${tipo}/${documentoId}/${Date.now()}-${nombre}`;
      const { error: errorSubida } = await crearClienteNavegador().storage.from("adjuntos")
        .upload(ruta, archivo, { contentType: archivo.type, upsert: false });
      if (errorSubida) { setError("No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo."); return; }
      const r = await registrarAdjunto({ tipo, documentoId, ruta, nombre: archivo.name, mime: archivo.type, tamano: archivo.size });
      if (r.error) { setError(r.error); return; }
      if (entrada.current) entrada.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input ref={entrada} type="file" accept={ADJUNTO_TIPOS.join(",")} className="hidden" id={id}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
      <label htmlFor={id}
             className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 self-start rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50">
        {subiendo ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
        {subiendo ? "Subiendo…" : texto}
      </label>
      {ayuda && <p className="text-xs text-suave">{ayuda}</p>}
      {error && <Aviso>{error}</Aviso>}
    </div>
  );
}
