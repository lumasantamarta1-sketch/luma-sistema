import { notFound, redirect } from "next/navigation";
import { Construction } from "lucide-react";
import { exigirSesion, tiene } from "@/lib/sesion";
import { itemPorRuta } from "@/lib/menu";
import { Tarjeta } from "@/components/ui/tarjeta";

// Secciones del menú que aún no se construyen: muestra en qué fase llegan
export default async function SeccionPendiente({ params }: { params: Promise<{ seccion: string }> }) {
  const { seccion } = await params;
  const item = itemPorRuta(`/${seccion}`);
  if (!item?.fase) notFound();
  const sesion = await exigirSesion();
  if (item.permisos.length && !tiene(sesion, ...item.permisos)) redirect("/sin-permiso");
  return (
    <Tarjeta className="mx-auto mt-8 max-w-lg text-center">
      <Construction className="mx-auto size-10 text-naranja" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold text-morado">{item.titulo}</h1>
      <p className="mt-2 text-suave">Esta sección se construye en la fase {item.fase}. La base de datos ya está lista para ella.</p>
    </Tarjeta>
  );
}
