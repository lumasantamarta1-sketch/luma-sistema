import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosFormularioVenta } from "@/lib/ventas-datos";
import { Encabezado } from "@/components/ui/tarjeta";
import { FormularioVenta } from "../formulario-venta";

export const metadata: Metadata = { title: "Nueva venta" };

export default async function NuevaVenta() {
  const sesion = await exigirPermiso("ventas.crear");
  const supabase = await crearClienteServidor();
  const datos = await datosFormularioVenta(supabase, sesion);
  return (
    <>
      <Encabezado titulo="Nueva venta"
                  descripcion="Agrega los productos, el cliente si lo tienes y lo que te pagó. Puedes guardarla como cotización y confirmarla después."
                  acciones={<Link href="/ventas" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <FormularioVenta datos={datos} />
    </>
  );
}
