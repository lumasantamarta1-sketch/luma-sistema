import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { describirDescuento, hoyBogota, numeroVenta } from "@/lib/ventas";
import { fecha } from "@/lib/utilidades";
import { PestanasVentas } from "@/components/app/pestanas-ventas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CambiarDescuento, NuevaPromocion } from "../formularios";

export const metadata: Metadata = { title: "Descuentos" };

type Descuento = {
  id: string; tipo: string; nombre: string; porcentaje: number | null; valor_por_unidad: number | null; valor_total: number | null;
  vigente_desde: string | null; vigente_hasta: string | null; activo: boolean; creado_en: string; venta_id: string | null;
  productos: { nombre: string } | null; ventas: { numero: string | null; numero_cotizacion: string | null; estado: string } | null;
};

export default async function PaginaDescuentos() {
  const sesion = await exigirPermiso("descuentos.autorizar");
  const supabase = await crearClienteServidor();
  const [{ data }, { data: productos }] = await Promise.all([
    supabase.from("descuentos_autorizados")
      .select("id, tipo, nombre, porcentaje, valor_por_unidad, valor_total, vigente_desde, vigente_hasta, activo, creado_en, venta_id, productos(nombre), ventas!descuentos_autorizados_venta_id_fkey(numero, numero_cotizacion, estado)")
      .order("creado_en", { ascending: false }).limit(200),
    supabase.from("productos").select("id, nombre").eq("se_vende", true).eq("activo", true).order("nombre"),
  ]);
  const descuentos = (data ?? []) as unknown as Descuento[];
  const hoy = hoyBogota();
  const vigente = (d: Descuento) => d.activo && (!d.vigente_desde || d.vigente_desde <= hoy) && (!d.vigente_hasta || d.vigente_hasta >= hoy);
  const promociones = descuentos.filter((d) => d.tipo === "promocion");
  const puntuales = descuentos.filter((d) => d.tipo === "puntual");

  return (
    <>
      <Encabezado titulo="Descuentos" descripcion="Solo se aplican los descuentos que autorizas aquí o en cada cotización." />
      <PestanasVentas actual="/ventas/descuentos" permisos={sesion.permisos} />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Promociones</h2>
            {promociones.length === 0 && <p className="text-sm text-suave">Aún no hay promociones.</p>}
            <ul className="flex flex-col divide-y divide-borde">
              {promociones.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.nombre} <span className="font-normal text-suave">· {describirDescuento(d)}</span></p>
                    <p className="text-sm text-suave">
                      {d.productos?.nombre ?? "Todos los productos"}
                      {d.vigente_desde || d.vigente_hasta ? ` · ${d.vigente_desde ? `desde ${fecha(`${d.vigente_desde}T12:00:00`)}` : ""}${d.vigente_hasta ? ` hasta ${fecha(`${d.vigente_hasta}T12:00:00`)}` : ""}` : " · sin fecha límite"}
                    </p>
                  </div>
                  <Insignia tono={vigente(d) ? "exito" : "neutro"}>{vigente(d) ? "Vigente" : d.activo ? "Fuera de fecha" : "Inactiva"}</Insignia>
                  <CambiarDescuento id={d.id} activo={d.activo} />
                </li>
              ))}
            </ul>
          </Tarjeta>
          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Autorizados para una cotización</h2>
            {puntuales.length === 0 && <p className="text-sm text-suave">Se autorizan desde el detalle de cada cotización.</p>}
            <ul className="flex flex-col divide-y divide-borde">
              {puntuales.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.nombre} <span className="font-normal text-suave">· {describirDescuento(d)}</span></p>
                    {d.venta_id && d.ventas && (
                      <Link href={`/ventas/${d.venta_id}`} className="text-sm font-semibold text-morado underline">{numeroVenta(d.ventas)}</Link>
                    )}
                  </div>
                  <Insignia tono={d.activo ? "exito" : "neutro"}>{d.activo ? "Activo" : "Inactivo"}</Insignia>
                  {d.ventas?.estado === "cotizacion" && <CambiarDescuento id={d.id} activo={d.activo} />}
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
        <Tarjeta className="h-fit">
          <NuevaPromocion productos={(productos ?? []) as { id: string; nombre: string }[]} />
        </Tarjeta>
      </div>
    </>
  );
}
