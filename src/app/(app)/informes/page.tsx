import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { diasEntre, resolverPeriodo } from "@/lib/periodos";
import { diaCorto, pestanasInformes, type InformeVentas } from "@/lib/informes";
import { fecha, mensajeError, pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { FiltroPeriodo } from "@/components/app/filtro-periodo";
import { BarrasHorizontales, GraficaBarras } from "@/components/ui/grafica-barras";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Informes" };

export default async function InformeVentasPagina({ searchParams }: {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; punto?: string }>;
}) {
  const f = await searchParams;
  const sesion = await exigirPermiso("informes.ver", "informes.inventario", "informes.financieros");
  if (!tiene(sesion, "informes.ver")) redirect(tiene(sesion, "informes.financieros") ? "/informes/resultado" : "/informes/inventario");
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");
  const punto = puntos.some((p) => p.id === f.punto) ? f.punto : undefined;
  const periodo = resolverPeriodo(f);
  const { data, error } = await supabase.rpc("informe_ventas", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto ?? null });
  const inf = data as InformeVentas | null;
  const t = inf?.totales;
  const porDia = new Map((inf?.por_dia ?? []).map((d) => [d.fecha, d]));
  const dias = diasEntre(periodo.desde, periodo.hasta);
  const exportar = tiene(sesion, "informes.exportar")
    ? `/informes/exportar?desde=${periodo.desde}&hasta=${periodo.hasta}${punto ? `&punto=${punto}` : ""}` : null;
  const boton = "inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50";

  return (
    <>
      <Encabezado titulo="Informes" descripcion={`Ventas entregadas del ${fecha(`${periodo.desde}T12:00:00`)} al ${fecha(`${periodo.hasta}T12:00:00`)}.`}
                  acciones={exportar ? (<>
                    <a href={`${exportar}&tipo=ventas`} className={boton}><Download className="size-4" aria-hidden /> Productos (Excel)</a>
                    <a href={`${exportar}&tipo=ventas_lista`} className={boton}><Download className="size-4" aria-hidden /> Ventas (Excel)</a>
                  </>) : undefined} />
      <Pestanas actual="/informes" etiqueta="Informes" items={pestanasInformes(sesion.permisos)} />
      <FiltroPeriodo ruta="/informes" clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} punto={punto} puntos={puntos} />
      {error && <Tarjeta className="text-error">{mensajeError(error)}</Tarjeta>}
      {inf && t && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Vendido" valor={pesos(t.valor)} detalle={`${t.ventas} venta(s) entregada(s)`} />
            <Cifra titulo="Unidades" valor={new Intl.NumberFormat("es-CO").format(Number(t.unidades))} detalle={t.ventas ? `${pesos(Number(t.valor) / t.ventas)} por venta en promedio` : "Sin ventas"} />
            <Cifra titulo="Descuentos" valor={pesos(t.descuentos)} detalle={`Devoluciones: ${pesos(t.devoluciones)}`} />
            {inf.con_costos && t.costo !== null ? (
              <Cifra titulo="Utilidad bruta" valor={pesos(Number(t.valor) - Number(t.costo))}
                     detalle={`Costo ${pesos(t.costo)}${Number(t.valor) > 0 ? ` · margen ${Math.round(((Number(t.valor) - Number(t.costo)) / Number(t.valor)) * 100)} %` : ""}`} />
            ) : (
              <Cifra titulo="Dinero recibido" valor={pesos(inf.recibido_por_metodo.reduce((s, m) => s + Number(m.valor), 0))} detalle="Pagos del periodo" />
            )}
          </div>

          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Ventas por día</h2>
            {t.ventas === 0 ? <p className="text-sm text-suave">No hay ventas entregadas en este periodo.</p> : (
              <GraficaBarras titulo="Valor vendido por día" datos={dias.map((d) => ({
                etiqueta: diaCorto(d), valor: Number(porDia.get(d)?.valor ?? 0), detalle: `${porDia.get(d)?.ventas ?? 0} venta(s)`,
              }))} />
            )}
          </Tarjeta>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta>
              <h2 className="mb-3 text-lg font-semibold text-morado">Productos más vendidos</h2>
              {inf.por_producto.length === 0 ? <p className="text-sm text-suave">Sin datos.</p> : (
                <BarrasHorizontales datos={inf.por_producto.slice(0, 10).map((p) => ({
                  etiqueta: `${p.producto}${p.detalle ? ` · ${p.detalle}` : ""}`,
                  detalle: `${new Intl.NumberFormat("es-CO").format(Number(p.unidades))} und${inf.con_costos && p.utilidad !== null ? ` · utilidad ${pesos(p.utilidad)}` : ""}`,
                  valor: Number(p.valor),
                }))} />
              )}
            </Tarjeta>
            <div className="flex flex-col gap-4">
              <Tarjeta>
                <h2 className="mb-3 text-lg font-semibold text-morado">Por vendedor</h2>
                {inf.por_vendedor.length === 0 ? <p className="text-sm text-suave">Sin datos.</p> : (
                  <BarrasHorizontales datos={inf.por_vendedor.map((v) => ({ etiqueta: v.vendedor, detalle: `${v.ventas} venta(s)`, valor: Number(v.valor) }))} />
                )}
              </Tarjeta>
              {inf.por_punto.length > 1 && (
                <Tarjeta>
                  <h2 className="mb-3 text-lg font-semibold text-morado">Por punto de venta</h2>
                  <BarrasHorizontales datos={inf.por_punto.map((v) => ({ etiqueta: v.punto, detalle: `${v.ventas} venta(s)`, valor: Number(v.valor) }))} />
                </Tarjeta>
              )}
              <Tarjeta>
                <h2 className="mb-1 text-lg font-semibold text-morado">Dinero recibido por medio de pago</h2>
                <p className="mb-3 text-xs text-suave">Pagos recibidos en el periodo, incluidos anticipos; se restan las devoluciones de dinero.</p>
                {inf.recibido_por_metodo.length === 0 ? <p className="text-sm text-suave">Sin pagos.</p> : (
                  <BarrasHorizontales datos={inf.recibido_por_metodo.map((m) => ({ etiqueta: m.metodo, valor: Number(m.valor) }))} />
                )}
              </Tarjeta>
            </div>
          </div>
          {inf.por_producto.length > 0 && (
            <Tarjeta>
              <h2 className="mb-3 text-lg font-semibold text-morado">Detalle por producto</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="text-left text-suave">
                    <th className="py-2 font-semibold">Producto</th><th className="py-2 text-right font-semibold">Unidades</th>
                    <th className="py-2 text-right font-semibold">Vendido</th>
                    {inf.con_costos && <><th className="py-2 text-right font-semibold">Costo</th><th className="py-2 text-right font-semibold">Utilidad</th></>}
                  </tr></thead>
                  <tbody>
                    {inf.por_producto.map((p) => (
                      <tr key={p.sku} className="border-t border-borde">
                        <td className="py-2">{p.producto}<span className="block text-xs text-suave">{p.sku}{p.detalle ? ` · ${p.detalle}` : ""}</span></td>
                        <td className="cifra py-2 text-right">{new Intl.NumberFormat("es-CO").format(Number(p.unidades))}</td>
                        <td className="cifra py-2 text-right">{pesos(p.valor)}</td>
                        {inf.con_costos && <><td className="cifra py-2 text-right">{pesos(p.costo)}</td><td className="cifra py-2 text-right">{pesos(p.utilidad)}</td></>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tarjeta>
          )}
        </div>
      )}
    </>
  );
}

function Cifra({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <Tarjeta className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-suave">{titulo}</p>
      <p className="cifra font-titulo text-2xl font-semibold text-morado">{valor}</p>
      {detalle && <p className="text-xs text-suave">{detalle}</p>}
    </Tarjeta>
  );
}
