import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosFormularioCompra } from "@/lib/compras-datos";
import { Encabezado } from "@/components/ui/tarjeta";
import { FormularioCompra } from "../../formulario-compra";

export const metadata: Metadata = { title: "Editar compra" };

export default async function EditarCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await exigirPermiso("compras.gestionar");
  const supabase = await crearClienteServidor();
  const datos = await datosFormularioCompra(supabase, sesion, id);
  // Solo se editan los borradores; una compra confirmada se ve en su detalle
  if (!datos.inicial) redirect(`/compras/${id}`);
  return (
    <>
      <Encabezado titulo={`Compra ${datos.inicial.numero}`} descripcion="Borrador: cambia lo que necesites y confírmala cuando la hagas."
                  acciones={<Link href={`/compras/${id}`} className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <FormularioCompra datos={datos} />
    </>
  );
}
