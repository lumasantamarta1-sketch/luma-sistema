import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosFormularioVenta } from "@/lib/ventas-datos";
import { Encabezado } from "@/components/ui/tarjeta";
import { FormularioVenta } from "../../formulario-venta";

export const metadata: Metadata = { title: "Venta con más opciones" };

// Formulario completo: cotizaciones, varios pagos, descuentos autorizados, cambio de precio y notas
export default async function VentaCompleta() {
  const sesion = await exigirPermiso("ventas.crear");
  const supabase = await crearClienteServidor();
  const datos = await datosFormularioVenta(supabase, sesion);
  return (
    <>
      <Encabezado titulo="Venta con más opciones"
                  descripcion="Para cotizaciones, varios pagos, descuentos autorizados o notas. Para vender rápido en el mostrador usa «Vender»."
                  acciones={<Link href="/ventas/nueva" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver a vender</Link>} />
      <FormularioVenta datos={datos} />
    </>
  );
}
