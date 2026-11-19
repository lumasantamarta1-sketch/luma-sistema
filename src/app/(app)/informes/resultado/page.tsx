import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { resolverPeriodo } from "@/lib/periodos";
import { pestanasInformes, type ResumenFinanciero } from "@/lib/informes";
import { cn, fecha, mensajeError, pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { FiltroPeriodo } from "@/components/app/filtro-periodo";
import { BarrasHorizontales } from "@/components/ui/grafica-barras";
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
  const [{ data, error }, { data: gastos }] = await Promise.all([
    supabase.rpc("resumen_financiero", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto ?? null }),
    tiene(sesion, "gastos.ver")
      ? (() => {
          let q = supabase.from("gastos").select("valor, categorias_gasto(nombre, tipo)").neq("estado", "anulado")
            .gte("fecha", periodo.desde).lte("fecha", periodo.hasta);
          if (punto) q = q.eq("bodega_id", punto);
          return q;
        })()
      : Promise.resolve({ data: [] }),
  ]);
  const r = data as ResumenFinanciero | null;
  const porCategoria = new Map<string, number>();
  for (const g of (gastos ?? []) as unknown as { valor: number; categorias_gasto: { nombre: string; tipo: string } | null }[]) {
    if (g.categorias_gasto?.tipo !== "operativo") continue;
    porCategoria.set(g.categorias_gasto.nombre, (porCategoria.get(g.categorias_gasto.nombre) ?? 0) + Number(g.valor));
  }

  return (
    <>
      <Encabezado titulo="Resultado y dinero" descripcion={`Del ${fecha(`${periodo.desde}T12:00:00`)} al ${fecha(`${periodo.hasta}T12:00:00`)}. Los resultados son cálculos; el dinero real sale del libro de caja.`} />
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

          {porCategoria.size > 0 && (
            <Tarjeta className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-semibold text-morado">Gastos por categoría</h2>
              <BarrasHorizontales datos={[...porCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([etiqueta, valor]) => ({ etiqueta, valor }))} />
            </Tarjeta>
          )}
        </div>
      )}
    </>
  );
}
