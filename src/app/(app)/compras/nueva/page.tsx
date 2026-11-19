import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosFormularioCompra } from "@/lib/compras-datos";
import { Encabezado } from "@/components/ui/tarjeta";
import { FormularioCompra } from "../formulario-compra";

export const metadata: Metadata = { title: "Nueva compra" };

export default async function NuevaCompra() {
  const sesion = await exigirPermiso("compras.gestionar");
  const supabase = await crearClienteServidor();
  const datos = await datosFormularioCompra(supabase, sesion);
  return (
    <>
      <Encabezado titulo="Nueva compra" descripcion="Lo que compras al proveedor, con su costo. Entra al inventario cuando se recibe."
                  acciones={<Link href="/compras" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <FormularioCompra datos={datos} />
    </>
  );
}
