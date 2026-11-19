import type { Metadata } from "next";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { PestanasGastos } from "@/components/app/pestanas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CambiarActivo, NuevaCategoria } from "../formularios";

export const metadata: Metadata = { title: "Categorías de gasto" };

export default async function PaginaCategorias() {
  const sesion = await exigirPermiso("gastos.configurar");
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("categorias_gasto").select("id, nombre, tipo, activo").order("tipo", { ascending: false }).order("nombre");
  const categorias = (data ?? []) as { id: string; nombre: string; tipo: string; activo: boolean }[];
  return (
    <>
      <Encabezado titulo="Categorías de gasto" descripcion="Agrupan los gastos para ver en qué se va el dinero." />
      <PestanasGastos actual="/gastos/categorias" permisos={sesion.permisos} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Tarjeta>
          <ul className="flex flex-col divide-y divide-borde">
            {categorias.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{c.nombre}</p>
                  {c.tipo === "mercancia" && <p className="text-sm text-suave">Mercancía: se registra en Compras para que entre al inventario.</p>}
                </div>
                <Insignia tono={c.activo ? "exito" : "neutro"}>{c.activo ? "Activa" : "Inactiva"}</Insignia>
                {c.tipo === "operativo" && <CambiarActivo id={c.id} activo={c.activo} tipo="categoria" />}
              </li>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta className="h-fit"><NuevaCategoria /></Tarjeta>
      </div>
    </>
  );
}
