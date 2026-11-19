"use client";

import { Printer } from "lucide-react";

export function BotonImprimir() {
  return (
    <button type="button" onClick={() => window.print()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
      <Printer className="size-5" aria-hidden /> Imprimir o guardar PDF
    </button>
  );
}
