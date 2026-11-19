import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { TIPOS_CUENTA } from "@/lib/caja";
import { Pestanas } from "@/components/app/pestanas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CambiarCuenta, NuevaCuenta } from "../formularios";

export const metadata: Metadata = { title: "Cuentas y métodos de pago" };

export default async function PaginaCuentas() {
  const sesion = await exigirPermiso("configuracion.gestionar");
  const supabase = await crearClienteServidor();
  const [{ data: cuentas }, { data: metodos }] = await Promise.all([
    supabase.from("cuentas_dinero").select("id, nombre, tipo, activo, bodegas(nombre)").order("tipo").order("nombre"),
    supabase.from("metodos_pago").select("id, nombre, tipo, activo, cuentas_dinero(nombre)").order("nombre"),
  ]);
  type FilaCuenta = { id: string; nombre: string; tipo: string; activo: boolean; bodegas: { nombre: string } | null };
  type FilaMetodo = { id: string; nombre: string; tipo: string; activo: boolean; cuentas_dinero: { nombre: string } | null };
  return (
    <>
      <Encabezado titulo="Cuentas y métodos de pago" descripcion="Dónde está el dinero y con qué se cobra y se paga." />
      <Pestanas actual="/caja/cuentas" etiqueta="Caja" items={[
        { ruta: "/caja", titulo: "Saldos y movimientos", ver: tiene(sesion, "caja.ver", "caja.gestionar", "caja.cerrar") },
        { ruta: "/caja/cuentas", titulo: "Cuentas y métodos de pago" },
      ]} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Cuentas</h2>
            <ul className="flex flex-col divide-y divide-borde">
              {((cuentas ?? []) as unknown as FilaCuenta[]).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.nombre}</p>
                    <p className="text-sm text-suave">{TIPOS_CUENTA[c.tipo] ?? c.tipo}{c.bodegas ? ` · caja del punto ${c.bodegas.nombre}` : ""}</p>
                  </div>
                  <Insignia tono={c.activo ? "exito" : "neutro"}>{c.activo ? "Activa" : "Inactiva"}</Insignia>
                  {c.tipo !== "efectivo" && <CambiarCuenta id={c.id} activo={c.activo} tabla="cuenta" />}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-suave">Cada punto de venta recibe su caja de efectivo al crearse.</p>
          </Tarjeta>
          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Métodos de pago</h2>
            <ul className="flex flex-col divide-y divide-borde">
              {((metodos ?? []) as unknown as FilaMetodo[]).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{m.nombre}</p>
                    <p className="text-sm text-suave">{m.tipo === "efectivo" ? "Va a la caja del punto donde se cobra o paga" : `Va a ${m.cuentas_dinero?.nombre ?? "su cuenta"}`}</p>
                  </div>
                  <Insignia tono={m.activo ? "exito" : "neutro"}>{m.activo ? "Activo" : "Inactivo"}</Insignia>
                  {m.tipo !== "efectivo" && <CambiarCuenta id={m.id} activo={m.activo} tabla="metodo" />}
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
        <Tarjeta className="h-fit"><NuevaCuenta /></Tarjeta>
      </div>
    </>
  );
}
