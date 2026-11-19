"use client";

import { Printer } from "lucide-react";

// Abre la ventana de impresión del navegador; desde ahí también se guarda como PDF
export function BotonImprimir({ texto = "Imprimir o PDF" }: { texto?: string }) {
  return (
    <button type="button" onClick={() => window.print()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50 print:hidden">
      <Printer className="size-4" aria-hidden /> {texto}
    </button>
  );
}
