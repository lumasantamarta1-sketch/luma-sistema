import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosFormularioVenta } from "@/lib/ventas-datos";
import { Encabezado } from "@/components/ui/tarjeta";
import { FormularioVenta } from "../../formulario-venta";

export const metadata: Metadata = { title: "Editar cotización" };

export default async function EditarCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await exigirPermiso("ventas.crear");
  const supabase = await crearClienteServidor();
  const datos = await datosFormularioVenta(supabase, sesion, id);
  // Solo las cotizaciones se editan; una venta confirmada o anulada se ve en su detalle
  if (!datos.inicial) redirect(`/ventas/${id}`);
  return (
    <>
      <Encabezado titulo={`Cotización ${datos.inicial.numero}`} descripcion="Cambia lo que necesites y confírmala cuando el cliente decida."
                  acciones={<Link href={`/ventas/${id}`} className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <FormularioVenta datos={datos} />
    </>
  );
}
