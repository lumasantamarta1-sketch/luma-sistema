import type { Metadata } from "next";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";
import { FormularioProducto } from "../formularios";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NuevoProducto() {
  await exigirPermiso("catalogo.gestionar");
  const supabase = await crearClienteServidor();
  const { data: categorias } = await supabase.from("categorias").select("id, nombre").eq("activo", true).order("nombre");
  return (
    <>
      <Encabezado titulo="Nuevo producto" descripcion="Después de crearlo generas sus variantes por tipo, talla y color." />
      <Tarjeta className="max-w-2xl"><FormularioProducto categorias={categorias ?? []} /></Tarjeta>
    </>
  );
}
