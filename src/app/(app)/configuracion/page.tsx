import type { Metadata } from "next";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { Boton } from "@/components/ui/boton";
import { FormularioNegocio, NuevoPunto } from "./formularios";
import { cambiarEstadoPunto } from "./acciones";

export const metadata: Metadata = { title: "Configuración" };

const TIPOS: Record<string, string> = { punto_venta: "Punto de venta", taller: "Taller", bodega: "Bodega" };

export default async function PaginaConfiguracion() {
  await exigirPermiso("configuracion.gestionar");
  const supabase = await crearClienteServidor();
  const [{ data: negocio }, { data: puntos }] = await Promise.all([
    supabase.from("configuracion_negocio").select("*").eq("id", 1).single(),
    supabase.from("bodegas").select("id, codigo, nombre, tipo, direccion, activo").order("nombre"),
  ]);

  return (
    <>
      <Encabezado titulo="Configuración" descripcion="Negocio y puntos de venta. Impuestos, métodos de pago y descuentos llegan con sus módulos." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta>{negocio && <FormularioNegocio negocio={negocio} />}</Tarjeta>
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <h2 className="mb-3 text-lg font-semibold text-morado">Puntos de venta</h2>
            {(puntos ?? []).length === 0 && <p className="text-suave">Aún no hay puntos. Crea el primero.</p>}
            <ul className="flex flex-col divide-y divide-borde">
              {(puntos ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="font-semibold">{p.nombre}</span>
                  <span className="text-sm text-suave">{p.codigo}</span>
                  <Insignia>{TIPOS[p.tipo]}</Insignia>
                  {!p.activo && <Insignia tono="error">Inactivo</Insignia>}
                  <form action={cambiarEstadoPunto} className="ml-auto">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="activo" value={String(!p.activo)} />
                    <Boton type="submit" variante="fantasma">{p.activo ? "Desactivar" : "Activar"}</Boton>
                  </form>
                </li>
              ))}
            </ul>
          </Tarjeta>
          <Tarjeta><NuevoPunto /></Tarjeta>
        </div>
      </div>
    </>
  );
}
