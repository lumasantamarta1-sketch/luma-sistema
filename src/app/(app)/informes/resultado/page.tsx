import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { resolverPeriodo } from "@/lib/periodos";
import { mesCorto, pestanasInformes, type InformeComprasGastos, type ResumenFinanciero, type SerieMes } from "@/lib/informes";
import { cn, fecha, mensajeError, pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { FiltroPeriodo } from "@/components/app/filtro-periodo";
import { BarrasHorizontales, GraficaColumnas } from "@/components/ui/grafica-barras";
import { Descargas } from "@/components/app/descargas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Resultado y dinero" };

function Fila({ titulo, valor, signo, fuerte, ayuda }: { titulo: string; valor: number; signo?: "+" | "−"; fuerte?: boolean; ayuda?: string }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1.5", fuerte && "border-t border-borde pt-2 text-base font-semibold text-morado")}>
      <dt>{titulo}{ayuda && <span className="block text-xs font-normal text-suave">{ayuda}</span>}</dt>
      <dd className={cn("cifra whitespace-nowrap", valor < 0 && fuerte && "text-error")}>{signo ? `${signo} ` : ""}{pesos(Math.abs(valor))}{valor < 0 && !signo ? " (pérdida)" : ""}</dd>
    </div>
  );
}

export default async function InformeResultado({ searchParams }: {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; punto?: string }>;
}) {
  const f = await searchParams;
  const sesion = await exigirPermiso("informes.financieros");
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");
  const punto = puntos.some((p) => p.id === f.punto) ? f.punto : undefined;
  const periodo = resolverPeriodo(f);
  const [{ data, error }, compras, mensual] = await Promise.all([
    supabase.rpc("resumen_financiero", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto ?? null }),
    supabase.rpc("informe_compras_gastos", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto ?? null }),
    supabase.rpc("serie_mensual", { p_meses: 12 }),
  ]);
  const r = data as ResumenFinanciero | null;
  // Solo los gastos operativos van al resultado; los de mercancía se vuelven costo al vender
  const porCategoria = ((compras.data as InformeComprasGastos | null)?.gastos_por_categoria ?? [])
    .filter((g) => g.tipo === "operativo" && Number(g.valor) > 0);
  const serie = (mensual.data ?? []) as SerieMes[];
  const conCostos = serie.some((m) => m.utilidad_bruta !== null);
  const filtro = `desde=${periodo.desde}&hasta=${periodo.hasta}${punto ? `&punto=${punto}` : ""}`;
  const descargas = tiene(sesion, "informes.exportar") ? [
    { titulo: "Resultado y mes a mes", url: `/informes/exportar?tipo=resultado&${filtro}` },
    ...(tiene(sesion, "caja.ver") ? [{ titulo: "Flujo de caja (libro)", url: `/informes/exportar?tipo=caja&${filtro}` }] : []),
    { titulo: "Gastos y compras por categoría", url: `/informes/exportar?tipo=gastos_resumen&${filtro}` },
  ] : [];

  return (
    <>
      <Encabezado titulo="Resultado y dinero" descripcion={`Del ${fecha(`${periodo.desde}T12:00:00`)} al ${fecha(`${periodo.hasta}T12:00:00`)}. Los resultados son cálculos; el dinero real sale del libro de caja.`}
                  acciones={<Descargas enlaces={descargas} />} />
      <Pestanas actual="/informes/resultado" etiqueta="Informes" items={pestanasInformes(sesion.permisos)} />
      <FiltroPeriodo ruta="/informes/resultado" clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} punto={punto} puntos={puntos} />
      {error && <Tarjeta className="text-error">{mensajeError(error)}</Tarjeta>}
      {r && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flex-1 text-lg font-semibold text-morado">Estado de resultados</h2>
              <Insignia tono="marca">Calculado</Insignia>
            </div>
            <dl className="text-sm">
              <Fila titulo="Ventas entregadas" valor={r.calculado.ventas_brutas} />
              <Fila titulo="Descuentos" valor={r.calculado.descuentos} signo="−" />
              {r.calculado.impuestos > 0 && <Fila titulo="Impuestos incluidos en el precio" valor={r.calculado.impuestos} signo="−" />}
              {r.calculado.devoluciones > 0 && <Fila titulo="Devoluciones de clientes" valor={r.calculado.devoluciones} signo="−" />}
              <Fila titulo="Ventas netas" valor={r.calculado.ventas_netas} fuerte />
              <Fila titulo="Costo de lo vendido" valor={r.calculado.costo_mercancia_vendida} signo="−" ayuda="Al costo promedio del momento de la entrega" />
              <Fila titulo="Utilidad bruta" valor={r.calculado.utilidad_bruta} fuerte
                    ayuda={r.calculado.margen_bruto !== null ? `Margen ${Math.round(Number(r.calculado.margen_bruto) * 100)} %` : undefined} />
              <Fila titulo="Gastos operativos" valor={r.calculado.gastos_registrados} signo="−" ayuda="Pagados o por pagar" />
              {r.calculado.perdidas_inventario !== 0 && <Fila titulo="Pérdidas y ajustes de inventario" valor={r.calculado.perdidas_inventario} signo={r.calculado.perdidas_inventario > 0 ? "−" : "+"} />}
              <Fila titulo="Resultado operativo" valor={r.calculado.resultado_operativo} fuerte />
            </dl>
            <p className="mt-2 text-xs text-suave">Compras recibidas en el periodo: {pesos(r.calculado.compras_recibidas)} (van al inventario; cuentan como costo cuando se venden).</p>
          </Tarjeta>

          <div className="flex flex-col gap-4">
            <Tarjeta>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="flex-1 text-lg font-semibold text-morado">Dinero real</h2>
                <Insignia tono="exito">Libro de caja</Insignia>
              </div>
              <dl className="text-sm">
                <Fila titulo="Entró" valor={r.dinero_real.entradas} ayuda="Cobros de ventas y reembolsos de proveedores" />
                <Fila titulo="Salió" valor={r.dinero_real.salidas} signo="−" ayuda="Pagos a proveedores, gastos y devoluciones a clientes" />
                <Fila titulo="Flujo de caja" valor={r.dinero_real.flujo_de_caja} fuerte />
                {(r.dinero_real.aportes > 0 || r.dinero_real.retiros > 0) && (
                  <p className="pt-1 text-xs text-suave">Aparte: aportes {pesos(r.dinero_real.aportes)} y retiros {pesos(r.dinero_real.retiros)}.</p>
                )}
              </dl>
            </Tarjeta>
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Saldos de hoy</h2>
              <dl className="text-sm">
                <Fila titulo="Te deben clientes" valor={r.saldos.cuentas_por_cobrar} ayuda="Ventas entregadas con saldo" />
                <Fila titulo="Anticipos de clientes" valor={r.saldos.anticipos_de_clientes} ayuda="Pagos de pedidos aún sin entregar" />
                <Fila titulo="Debes a proveedores" valor={r.saldos.compras_por_pagar} />
                <Fila titulo="Gastos por pagar" valor={r.saldos.gastos_por_pagar} />
                <Fila titulo="Inventario a costo" valor={r.saldos.valor_inventario.total} fuerte
                      ayuda={`Terminadas ${pesos(r.saldos.valor_inventario.terminado)} · base ${pesos(r.saldos.valor_inventario.base)} · materiales ${pesos(r.saldos.valor_inventario.material)}`} />
              </dl>
            </Tarjeta>
          </div>

          {porCategoria.length > 0 && (
            <Tarjeta className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-semibold text-morado">Gastos por categoría</h2>
              <BarrasHorizontales datos={porCategoria.map((g) => ({ etiqueta: g.categoria, valor: Number(g.valor) }))} />
            </Tarjeta>
          )}

          {serie.length > 0 && (
            <Tarjeta className="lg:col-span-2">
              <h2 className="mb-1 text-lg font-semibold text-morado">Mes a mes</h2>
              <p className="mb-3 text-xs text-suave">Últimos 12 meses de todos tus puntos, con las mismas fórmulas del estado de resultados.</p>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold">Ventas netas</h3>
                  <GraficaColumnas titulo="Ventas netas por mes" datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.ventas_netas), detalle: `${m.ventas} venta(s)` }))} />
                </div>
                {conCostos && (
                  <div>
                    <h3 className="text-sm font-semibold">Utilidad bruta</h3>
                    <GraficaColumnas titulo="Utilidad bruta por mes" datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.utilidad_bruta ?? 0) }))} />
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-semibold">Gastos</h3>
                  <GraficaColumnas titulo="Gastos por mes" datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.gastos ?? 0) }))} />
                </div>
                {conCostos && (
                  <div>
                    <h3 className="text-sm font-semibold">Resultado operativo</h3>
                    <GraficaColumnas titulo="Resultado operativo por mes" datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.resultado ?? 0) }))} />
                  </div>
                )}
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="text-left text-suave">
                    <th className="py-2 font-semibold">Mes</th><th className="py-2 text-right font-semibold">Ventas netas</th>
                    {conCostos && <th className="py-2 text-right font-semibold">Utilidad bruta</th>}
                    <th className="py-2 text-right font-semibold">Gastos</th>
                    {conCostos && <th className="py-2 text-right font-semibold">Resultado</th>}
                    {conCostos && <th className="py-2 text-right font-semibold">Inventario a costo</th>}
                  </tr></thead>
                  <tbody>
                    {serie.slice().reverse().map((m) => (
                      <tr key={m.mes} className="border-t border-borde">
                        <td className="py-1.5">{mesCorto(m.mes)}</td>
                        <td className="cifra py-1.5 text-right">{pesos(m.ventas_netas)}</td>
                        {conCostos && <td className="cifra py-1.5 text-right">{pesos(m.utilidad_bruta)}</td>}
                        <td className="cifra py-1.5 text-right">{pesos(m.gastos)}</td>
                        {conCostos && <td className={cn("cifra py-1.5 text-right font-semibold", Number(m.resultado) < 0 ? "text-error" : "text-morado")}>{pesos(m.resultado)}</td>}
                        {conCostos && <td className="cifra py-1.5 text-right">{pesos(m.inventario_valor)}</td>}
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
