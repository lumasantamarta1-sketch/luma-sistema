import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { hoyBogota } from "@/lib/ventas";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";
import { NuevoGasto } from "../formularios";

export const metadata: Metadata = { title: "Registrar gasto" };

export default async function NuevoGastoPagina() {
  const sesion = await exigirPermiso("gastos.registrar");
  const supabase = await crearClienteServidor();
  const [{ data: categorias }, { data: proveedores }, { data: metodos }] = await Promise.all([
    supabase.from("categorias_gasto").select("id, nombre, tipo").eq("activo", true).order("nombre"),
    tiene(sesion, "proveedores.ver", "proveedores.gestionar")
      ? supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre")
      : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
    supabase.from("metodos_pago").select("id, nombre, tipo").eq("activo", true).order("nombre"),
  ]);
  const todas = (categorias ?? []) as { id: string; nombre: string; tipo: string }[];
  return (
    <>
      <Encabezado titulo="Registrar gasto" descripcion="Transporte, empaques, servicios, arriendo… Lo que se paga para operar."
                  acciones={<Link href="/gastos" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      <Tarjeta className="max-w-2xl">
        <NuevoGasto
          categorias={todas.filter((c) => c.tipo === "operativo")}
          mercancia={todas.filter((c) => c.tipo === "mercancia").map((c) => c.nombre)}
          puntos={sesion.bodegas.filter((b) => b.tipo === "punto_venta").map((b) => ({ id: b.id, nombre: b.nombre }))}
          proveedores={(proveedores ?? []) as { id: string; nombre: string }[]}
          metodos={(metodos ?? []) as { id: string; nombre: string; tipo: string }[]}
          hoy={hoyBogota()}
          puedePagar={tiene(sesion, "gastos.registrar")}
        />
      </Tarjeta>
    </>
  );
}
