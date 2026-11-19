import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { resolverPeriodo } from "@/lib/periodos";
import { pestanasInformes, type CuentasPendientes, type InformeVentas } from "@/lib/informes";
import { cn, fecha, mensajeError, pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { FiltroPeriodo } from "@/components/app/filtro-periodo";
import { Descargas } from "@/components/app/descargas";
import { BarrasHorizontales } from "@/components/ui/grafica-barras";
import { Cifra } from "@/components/ui/cifra";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Clientes y cuentas" };

// Ventas por cliente del periodo y, a hoy, lo que deben los clientes y lo que se debe a proveedores y gastos
export default async function InformeCuentas({ searchParams }: {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; punto?: string }>;
}) {
  const f = await searchParams;
  const sesion = await exigirPermiso("informes.ver", "informes.financieros");
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");
  const punto = puntos.some((p) => p.id === f.punto) ? f.punto : undefined;
  const periodo = resolverPeriodo(f);
  const veVentas = tiene(sesion, "informes.ver");
  const [ventas, cuentas] = await Promise.all([
    veVentas ? supabase.rpc("informe_ventas", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto ?? null }) : Promise.resolve({ data: null, error: null }),
    tiene(sesion, "informes.financieros", "ventas.ver", "compras.ver", "gastos.ver")
      ? supabase.rpc("cuentas_pendientes") : Promise.resolve({ data: null, error: null }),
  ]);
  const inf = ventas.data as InformeVentas | null;
  const cp = cuentas.data as CuentasPendientes | null;
  const cobrar = cp?.por_cobrar ?? null;
  const entregadas = (cobrar ?? []).filter((x) => x.entregada);
  const pedidos = (cobrar ?? []).filter((x) => !x.entregada);
  const suma = (l: { saldo?: number; valor?: number }[]) => l.reduce((s, x) => s + Number(x.saldo ?? x.valor ?? 0), 0);
  const filtro = `desde=${periodo.desde}&hasta=${periodo.hasta}${punto ? `&punto=${punto}` : ""}`;
  const exporta = tiene(sesion, "informes.exportar");
  const descargas = exporta ? [
    ...(veVentas ? [{ titulo: "Ventas por cliente", url: `/informes/exportar?tipo=clientes&${filtro}` }] : []),
    ...(cp?.por_cobrar ? [{ titulo: "Cuentas por cobrar", url: "/informes/exportar?tipo=cobrar" }] : []),
    ...(cp?.por_pagar || cp?.gastos_por_pagar ? [{ titulo: "Cuentas por pagar", url: "/informes/exportar?tipo=pagar" }] : []),
  ] : [];

  return (
    <>
      <Encabezado titulo="Clientes y cuentas"
                  descripcion={`Ventas por cliente del ${fecha(`${periodo.desde}T12:00:00`)} al ${fecha(`${periodo.hasta}T12:00:00`)}. Las cuentas son las de hoy.`}
                  acciones={<Descargas enlaces={descargas} />} />
      <Pestanas actual="/informes/cuentas" etiqueta="Informes" items={pestanasInformes(sesion.permisos)} />
      {veVentas && <FiltroPeriodo ruta="/informes/cuentas" clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} punto={punto} puntos={puntos} />}
      {(ventas.error || cuentas.error) && <Tarjeta className="mb-4 text-error">{mensajeError((ventas.error ?? cuentas.error)!)}</Tarjeta>}

      {cp && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cobrar && <Cifra titulo="Te deben clientes" valor={pesos(suma(entregadas))} detalle={`${entregadas.length} venta(s) entregada(s) con saldo`} tono={suma(entregadas) > 0 ? "alerta" : "normal"} />}
          {cobrar && <Cifra titulo="Saldo de pedidos" valor={pesos(suma(pedidos))} detalle={`${pedidos.length} pedido(s) sin entregar; se cobra al entregar`} />}
          {cp.por_pagar && <Cifra titulo="Debes a proveedores" valor={pesos(suma(cp.por_pagar))} detalle={`${cp.por_pagar.length} compra(s) recibida(s) con saldo`} tono={suma(cp.por_pagar) > 0 ? "alerta" : "normal"} />}
          {cp.gastos_por_pagar && <Cifra titulo="Gastos por pagar" valor={pesos(suma(cp.gastos_por_pagar))} detalle={`${cp.gastos_por_pagar.length} gasto(s) pendiente(s)`} tono={suma(cp.gastos_por_pagar) > 0 ? "alerta" : "normal"} />}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {inf && (
          <Tarjeta className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-semibold text-morado">Ventas por cliente</h2>
            {inf.por_cliente.length === 0 ? <p className="text-sm text-suave">No hay ventas entregadas en este periodo.</p> : (
              <div className="grid gap-4 lg:grid-cols-2">
                <BarrasHorizontales datos={inf.por_cliente.slice(0, 8).map((c) => ({ etiqueta: c.cliente, detalle: `${c.ventas} venta(s)`, valor: Number(c.valor) }))} />
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-suave"><th className="py-2 font-semibold">Cliente</th>
                      <th className="py-2 text-right font-semibold">Ventas</th><th className="py-2 text-right font-semibold">Valor</th></tr></thead>
                    <tbody>
                      {inf.por_cliente.map((c) => (
                        <tr key={c.cliente} className="border-t border-borde">
                          <td className="py-1.5">{c.cliente}</td>
                          <td className="cifra py-1.5 text-right">{c.ventas}</td>
                          <td className="cifra py-1.5 text-right">{pesos(c.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Tarjeta>
        )}

        {cobrar && (
          <Tarjeta>
            <h2 className="mb-1 text-lg font-semibold text-morado">Cuentas por cobrar</h2>
            <p className="mb-3 text-xs text-suave">Ventas confirmadas con saldo. Las más antiguas primero.</p>
            {cobrar.length === 0 ? <p className="text-sm text-suave">Nadie te debe.</p> : (
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {cobrar.map((x) => (
                  <li key={x.venta_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
                    <Link href={`/ventas/${x.venta_id}`} className="font-semibold text-morado underline-offset-2 hover:underline">{x.numero}</Link>
                    {x.cliente_id
                      ? <Link href={`/clientes/${x.cliente_id}`} className="min-w-0 truncate hover:underline">{x.cliente}</Link>
                      : <span className="min-w-0 truncate">{x.cliente}</span>}
                    <Insignia tono={x.entregada ? "alerta" : "neutro"}>{x.entregada ? "Entregada" : "Pedido"}</Insignia>
                    <span className="cifra ml-auto font-semibold text-naranja">{pesos(x.saldo)}</span>
                    <span className="basis-full text-xs text-suave">
                      {fecha(`${x.fecha}T12:00:00`)} · hace {x.dias} día(s) · {x.punto}{x.telefono ? ` · ${x.telefono}` : ""} · total {pesos(x.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        )}

        {(cp?.por_pagar || cp?.gastos_por_pagar) && (
          <Tarjeta>
            <h2 className="mb-1 text-lg font-semibold text-morado">Cuentas por pagar</h2>
            <p className="mb-3 text-xs text-suave">Compras recibidas con saldo y gastos registrados sin pagar.</p>
            {!(cp.por_pagar ?? []).length && !(cp.gastos_por_pagar ?? []).length ? <p className="text-sm text-suave">No hay nada por pagar.</p> : (
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {(cp.por_pagar ?? []).map((x) => (
                  <li key={x.compra_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
                    <Link href={`/compras/${x.compra_id}`} className="font-semibold text-morado underline-offset-2 hover:underline">{x.numero}</Link>
                    <span className="min-w-0 truncate">{x.proveedor}</span>
                    <Insignia tono="marca">Compra</Insignia>
                    <span className="cifra ml-auto font-semibold text-naranja">{pesos(x.saldo)}</span>
                    <span className="basis-full text-xs text-suave">{fecha(`${x.fecha}T12:00:00`)} · hace {x.dias} día(s) · total {pesos(x.total)}</span>
                  </li>
                ))}
                {(cp.gastos_por_pagar ?? []).map((x) => (
                  <li key={x.gasto_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
                    <Link href={`/gastos/${x.gasto_id}`} className="font-semibold text-morado underline-offset-2 hover:underline">{x.numero}</Link>
                    <span className="min-w-0 truncate">{x.descripcion}</span>
                    <Insignia tono="neutro">Gasto</Insignia>
                    <span className={cn("cifra ml-auto font-semibold", x.dias > 30 ? "text-error" : "text-naranja")}>{pesos(x.valor)}</span>
                    <span className="basis-full text-xs text-suave">
                      {x.categoria} · {fecha(`${x.fecha}T12:00:00`)} · hace {x.dias} día(s){x.proveedor ? ` · ${x.proveedor}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        )}
      </div>
    </>
  );
}
