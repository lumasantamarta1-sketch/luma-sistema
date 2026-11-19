import { Download } from "lucide-react";
import { BotonImprimir } from "@/components/app/boton-imprimir";

export type Descarga = { titulo: string; url: string };

// Descargas de un informe (Excel o CSV) y botón para imprimir o guardar en PDF
export function Descargas({ enlaces, imprimir = true }: { enlaces: Descarga[]; imprimir?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {enlaces.length > 0 && (
        <details className="relative">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50 [&::-webkit-details-marker]:hidden">
            <Download className="size-4" aria-hidden /> Descargar
          </summary>
          <div className="absolute left-0 z-30 mt-2 w-80 max-w-[85vw] rounded-2xl border border-borde bg-white p-2 shadow-xl sm:left-auto sm:right-0">
            <p className="px-2 pb-1 text-xs text-suave">Excel se abre directo; CSV sirve para otros programas.</p>
            {enlaces.map((e) => (
              <div key={e.url} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-morado-50/60">
                <span className="flex-1 text-sm font-semibold">{e.titulo}</span>
                <a href={`${e.url}${e.url.includes("?") ? "&" : "?"}formato=xlsx`} aria-label={`${e.titulo} en Excel`}
                   className="rounded-lg border border-borde bg-white px-2.5 py-1 text-sm font-semibold text-morado hover:border-morado">Excel</a>
                <a href={e.url} aria-label={`${e.titulo} en CSV`}
                   className="rounded-lg border border-borde bg-white px-2.5 py-1 text-sm font-semibold text-morado hover:border-morado">CSV</a>
              </div>
            ))}
          </div>
        </details>
      )}
      {imprimir && <BotonImprimir />}
    </div>
  );
}
