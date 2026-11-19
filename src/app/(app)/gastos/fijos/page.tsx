import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FRECUENCIAS } from "@/lib/gastos";
import { pesos } from "@/lib/utilidades";
import { PestanasGastos } from "@/components/app/pestanas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CambiarActivo, CambiarValorRecurrente, GenerarRecurrentes, NuevoRecurrente } from "../formularios";

export const metadata: Metadata = { title: "Gastos fijos" };

type Fijo = {
  id: string; nombre: string; valor: number; frecuencia: string; dia: number | null; activo: boolean; beneficiario: string | null;
  categorias_gasto: { nombre: string } | null; proveedores: { nombre: string } | null;
};

export default async function PaginaFijos() {
  const sesion = await exigirPermiso("gastos.ver", "gastos.configurar");
  const supabase = await crearClienteServidor();
  const configura = tiene(sesion, "gastos.configurar");
  const [{ data }, { data: categorias }, { data: proveedores }] = await Promise.all([
    supabase.from("gastos_recurrentes")
      .select("id, nombre, valor, frecuencia, dia, activo, beneficiario, categorias_gasto(nombre), proveedores(nombre)")
      .order("activo", { ascending: false }).order("nombre"),
    configura ? supabase.from("categorias_gasto").select("id, nombre").eq("tipo", "operativo").eq("activo", true).order("nombre") : Promise.resolve({ data: [] }),
    configura && tiene(sesion, "proveedores.ver", "proveedores.gestionar")
      ? supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre") : Promise.resolve({ data: [] }),
  ]);
  const fijos = (data ?? []) as unknown as Fijo[];
  const mensual = fijos.filter((f) => f.activo).reduce((s, f) => s + Number(f.valor) * (f.frecuencia === "mensual" ? 1 : f.frecuencia === "quincenal" ? 2 : 52 / 12), 0);

  return (
    <>
      <Encabezado titulo="Gastos fijos" descripcion="Lo que se paga cada periodo. Se crean como gastos por pagar y se pagan desde Gastos." />
      <PestanasGastos actual="/gastos/fijos" permisos={sesion.permisos} />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-4">
          <Tarjeta className="flex flex-wrap items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-suave">Costo fijo aproximado al mes</p>
              <p className="cifra font-titulo text-2xl font-semibold text-morado">{pesos(mensual)}</p>
              <p className="text-xs text-suave">Calculado con los gastos fijos activos</p>
            </div>
            {tiene(sesion, "gastos.registrar") && fijos.some((f) => f.activo) && <GenerarRecurrentes />}
          </Tarjeta>
          <Tarjeta>
            {fijos.length === 0 && <p className="text-sm text-suave">Aún no hay gastos fijos. Agrega el arriendo, los servicios o la nómina para no olvidarlos.</p>}
            <ul className="flex flex-col divide-y divide-borde">
              {fijos.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{f.nombre} <span className="cifra font-normal text-morado">· {pesos(f.valor)}</span></p>
                    <p className="text-sm text-suave">
                      {f.categorias_gasto?.nombre} · {FRECUENCIAS[f.frecuencia]}{f.frecuencia === "mensual" && f.dia ? `, el día ${f.dia}` : ""}
                      {f.proveedores?.nombre || f.beneficiario ? ` · ${f.proveedores?.nombre ?? f.beneficiario}` : ""}
                    </p>
                  </div>
                  <Insignia tono={f.activo ? "exito" : "neutro"}>{f.activo ? "Activo" : "Inactivo"}</Insignia>
                  {configura && <CambiarValorRecurrente id={f.id} valor={Number(f.valor)} />}
                  {configura && <CambiarActivo id={f.id} activo={f.activo} tipo="recurrente" />}
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
        {configura && (
          <Tarjeta className="h-fit">
            <NuevoRecurrente categorias={(categorias ?? []) as { id: string; nombre: string }[]} proveedores={(proveedores ?? []) as { id: string; nombre: string }[]} />
          </Tarjeta>
        )}
      </div>
    </>
  );
}
