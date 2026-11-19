import type { Metadata } from "next";
import { DatabaseBackup } from "lucide-react";
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
      <Encabezado titulo="Configuración" descripcion="Negocio y puntos de venta. Las cuentas y los métodos de pago están en Caja; los descuentos, en Ventas." />
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
          <Tarjeta>
            <h2 className="mb-1 text-lg font-semibold text-morado">Copia de seguridad</h2>
            <p className="mb-3 text-sm text-suave">
              Descarga todos los datos en un archivo de Excel: productos, inventario, ventas, compras, gastos, caja, clientes y proveedores.
              Descargarla no cambia nada. Guárdala en un lugar seguro, por ejemplo una vez por semana.
            </p>
            <a href="/configuracion/respaldo" download className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
              <DatabaseBackup className="size-5" aria-hidden /> Descargar copia de seguridad
            </a>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
