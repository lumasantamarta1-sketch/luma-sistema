import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosFormularioVenta } from "@/lib/ventas-datos";
import { VentaRapida } from "../venta-rapida";

export const metadata: Metadata = { title: "Vender" };

// Venta de mostrador en tres pasos, pensada para quien no ha recibido capacitación
export default async function NuevaVenta() {
  const sesion = await exigirPermiso("ventas.crear");
  const supabase = await crearClienteServidor();
  const datos = await datosFormularioVenta(supabase, sesion);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-semibold text-morado sm:text-3xl">Vender</h1>
          <p className="text-suave">Toca las camisetas que se lleva el cliente y luego «Cobrar».</p>
        </div>
        <Link href="/ventas/nueva/completa"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 text-sm font-semibold text-morado hover:bg-morado-50">
          <SlidersHorizontal className="size-4" aria-hidden /> Cotización o más opciones
        </Link>
      </div>
      <VentaRapida datos={datos} />
    </>
  );
}
