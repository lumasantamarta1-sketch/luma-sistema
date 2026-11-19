import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { detalleVariante } from "@/lib/catalogo";
import { ESTADO_LINEA, HECHOS, describirDescuento, estadoPago, estadoVenta, numeroVenta, pagadoNeto, saldoVenta } from "@/lib/ventas";
import { ESTADOS_ORDEN } from "@/lib/inventario";
import { fecha, pesos } from "@/lib/utilidades";
import { Aviso } from "@/components/ui/aviso";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import {
  AnularVenta, ApartarVenta, AutorizarDescuento, ConfirmarCotizacion, Devolucion, EntregarVenta, OrdenarEstampado,
  Reembolso, RegistrarPago, type Metodo,
} from "../formularios";

export const metadata: Metadata = { title: "Venta" };

type Variante = {
  sku: string; productos: { nombre: string; por_pedido: boolean } | null; tallas: { nombre: string } | null;
  colores: { nombre: string } | null; tipos_camiseta: { nombre: string } | null; disenos: { nombre: string } | null;
};
type Linea = {
  id: string; cantidad: number; precio_unitario: number; descuento: number; personalizacion: string | null; estado: string;
  cantidad_apartada: number; variantes: Variante | null; descuentos_autorizados: { nombre: string } | null;
};
type Venta = {
  id: string; numero: string | null; numero_cotizacion: string | null; estado: string; estado_entrega: string;
  subtotal: number; descuentos: number; total: number; observaciones: string | null; creado_en: string; confirmada_en: string | null;
  entregada_en: string | null; cancelada_en: string | null; motivo_cancelacion: string | null;
  bodegas: { nombre: string } | null; clientes: { nombre: string; documento: string | null; telefono: string | null } | null;
  perfiles: { nombre: string } | null; venta_lineas: Linea[];
  pagos_venta: { id: string; tipo: string; fecha: string; valor: number; referencia: string | null; metodos_pago: { nombre: string } | null }[];
  devoluciones_venta: { id: string; numero: string; motivo: string; valor_total: number; registrado_en: string;
    devolucion_venta_lineas: { venta_linea_id: string; cantidad: number; condicion: string }[] }[];
};

const AVISOS: Record<string, string> = {
  credito: "La venta quedó confirmada, pero no se entregó porque tiene saldo pendiente. Registra el pago o pide al administrador que autorice el crédito.",
  pendientes: "La venta quedó confirmada, pero aún hay productos sin apartar o por estampar. Entrégala cuando estén listos.",
  entrega: "La venta quedó confirmada, pero no se pudo entregar. Inténtalo desde aquí.",
};

const enlace = "inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50";

export default async function DetalleVenta({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string; hecho?: string }>;
}) {
  const [{ id }, { aviso, hecho }] = await Promise.all([params, searchParams]);
  const sesion = await exigirPermiso("ventas.ver", "ventas.ver_propias", "ventas.crear", "ventas.entregar");
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("ventas")
    .select(`id, numero, numero_cotizacion, estado, estado_entrega, subtotal, descuentos, total, observaciones, creado_en, confirmada_en,
      entregada_en, cancelada_en, motivo_cancelacion, bodegas(nombre), clientes(nombre, documento, telefono), perfiles(nombre),
      venta_lineas(id, cantidad, precio_unitario, descuento, personalizacion, estado, cantidad_apartada,
        variantes(sku, productos(nombre, por_pedido), tallas(nombre), colores(nombre), tipos_camiseta(nombre), disenos(nombre)),
        descuentos_autorizados(nombre)),
      pagos_venta(id, tipo, fecha, valor, referencia, metodos_pago(nombre)),
      devoluciones_venta(id, numero, motivo, valor_total, registrado_en, devolucion_venta_lineas(venta_linea_id, cantidad, condicion))`)
    .eq("id", id).maybeSingle();
  if (!data) notFound();
  const venta = data as unknown as Venta;

  const puede = (...p: string[]) => tiene(sesion, ...p);
  const esCotizacion = venta.estado === "cotizacion";
  const confirmada = venta.estado === "confirmada";
  const entregada = confirmada && venta.estado_entrega === "entregada";
  const cancelada = venta.estado === "cancelada";
  const saldo = saldoVenta(venta);
  const pagado = pagadoNeto(venta.pagos_venta);
  const devuelto = venta.devoluciones_venta.reduce((s, d) => s + Number(d.valor_total), 0);
  const { texto, tono } = estadoVenta(venta);
  const pago = estadoPago(venta);
  const lineas = [...venta.venta_lineas].sort((a, b) => (a.variantes?.sku ?? "").localeCompare(b.variantes?.sku ?? ""));
  const porEstampar = lineas.some((l) => l.estado === "por_estampar");
  const sinApartar = lineas.some((l) => l.estado === "pendiente");

  const [metodos, ordenes, puntuales, config] = await Promise.all([
    supabase.from("metodos_pago").select("id, nombre, tipo").eq("activo", true).order("nombre"),
    puede("estampado.ver") ? supabase.from("ordenes_estampado").select("id, numero, estado").eq("venta_id", id).order("numero")
      : Promise.resolve({ data: [] as { id: string; numero: string; estado: string }[] }),
    esCotizacion ? supabase.from("descuentos_autorizados").select("id, nombre, porcentaje, valor_por_unidad, valor_total, activo").eq("venta_id", id)
      : Promise.resolve({ data: [] }),
    esCotizacion ? supabase.from("configuracion_negocio").select("anticipo_minimo_pct").eq("id", 1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const listaMetodos = (metodos.data ?? []) as Metodo[];
  const ordenesActivas = (ordenes.data ?? []).filter((o) => o.estado === "borrador");
  const anticipoPct = Number((config.data as { anticipo_minimo_pct?: number } | null)?.anticipo_minimo_pct ?? 0);

  const devueltoPorLinea = new Map<string, number>();
  for (const d of venta.devoluciones_venta) for (const l of d.devolucion_venta_lineas)
    devueltoPorLinea.set(l.venta_linea_id, (devueltoPorLinea.get(l.venta_linea_id) ?? 0) + Number(l.cantidad));
  const nombreLinea = (l: Linea) => `${l.variantes?.productos?.nombre ?? ""}${l.variantes ? ` · ${detalleVariante(l.variantes) || l.variantes.sku}` : ""}`;

  return (
    <>
      <Encabezado
        titulo={`${esCotizacion ? "Cotización" : "Venta"} ${numeroVenta(venta)}`}
        descripcion={[venta.bodegas?.nombre, fecha(venta.confirmada_en ?? venta.creado_en), venta.perfiles?.nombre ? `Vendió ${venta.perfiles.nombre}` : null]
          .filter(Boolean).join(" · ")}
        acciones={<>
          {esCotizacion && puede("ventas.crear") && <Link href={`/ventas/${id}/editar`} className={enlace}>Editar</Link>}
          <Link href={`/comprobante/venta/${id}`} target="_blank" className={enlace}><Printer className="size-4" aria-hidden /> Comprobante</Link>
          <Link href="/ventas" className={enlace}>Volver</Link>
        </>}
      />
      {hecho && HECHOS[hecho] && <div className="mb-4"><Aviso tipo="exito">{HECHOS[hecho]}</Aviso></div>}
      {aviso && AVISOS[aviso] && <div className="mb-4"><Aviso tipo="info">{AVISOS[aviso]}</Aviso></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tarjeta>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-morado">
                {venta.clientes ? venta.clientes.nombre : "Cliente mostrador"}
              </h2>
              {venta.clientes && (venta.clientes.documento || venta.clientes.telefono) && (
                <span className="text-sm text-suave">{[venta.clientes.documento, venta.clientes.telefono].filter(Boolean).join(" · ")}</span>
              )}
              <span className="ml-auto flex flex-wrap gap-1">
                <Insignia tono={tono}>{texto}</Insignia>
                {pago && <Insignia tono={pago.tono}>{pago.texto}</Insignia>}
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-borde">
              {lineas.map((l) => {
                const bruto = Number(l.cantidad) * Number(l.precio_unitario);
                const devueltas = devueltoPorLinea.get(l.id) ?? 0;
                return (
                  <li key={l.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <p className="min-w-0 flex-1 font-semibold">{nombreLinea(l)}</p>
                      <p className="cifra font-semibold">{pesos(bruto - Number(l.descuento))}</p>
                    </div>
                    <p className="cifra text-sm text-suave">
                      {l.variantes?.sku} · {Number(l.cantidad)} × {pesos(l.precio_unitario)}
                      {Number(l.descuento) > 0 && ` · descuento ${pesos(l.descuento)}${l.descuentos_autorizados ? ` (${l.descuentos_autorizados.nombre})` : ""}`}
                    </p>
                    {l.personalizacion && <p className="text-sm">Personalización: <b>{l.personalizacion}</b></p>}
                    {confirmada && !entregada && (
                      <p className="text-sm">
                        <Insignia tono={l.estado === "apartada" ? "exito" : l.estado === "por_estampar" ? "marca" : "alerta"}>{ESTADO_LINEA[l.estado] ?? l.estado}</Insignia>
                        {l.estado === "pendiente" && <span className="ml-2 cifra text-suave">{Number(l.cantidad_apartada)} de {Number(l.cantidad)} apartadas</span>}
                      </p>
                    )}
                    {devueltas > 0 && <p className="text-sm text-suave">Devueltas: {devueltas}</p>}
                  </li>
                );
              })}
            </ul>
            <dl className="mt-3 flex flex-col gap-1 border-t border-borde pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-suave">Subtotal</dt><dd className="cifra">{pesos(venta.subtotal)}</dd></div>
              {Number(venta.descuentos) > 0 && <div className="flex justify-between"><dt className="text-suave">Descuentos</dt><dd className="cifra">− {pesos(venta.descuentos)}</dd></div>}
              <div className="flex justify-between text-lg font-semibold text-morado"><dt>Total</dt><dd className="cifra">{pesos(venta.total)}</dd></div>
              {!esCotizacion && (
                <>
                  <div className="flex justify-between"><dt className="text-suave">Pagado</dt><dd className="cifra">{pesos(pagado)}</dd></div>
                  {devuelto > 0 && <div className="flex justify-between"><dt className="text-suave">Devoluciones</dt><dd className="cifra">− {pesos(devuelto)}</dd></div>}
                  <div className={`flex justify-between font-semibold ${saldo > 0 ? "text-naranja" : "text-morado"}`}>
                    <dt>{saldo > 0 ? "Saldo pendiente" : saldo < 0 ? "Saldo a favor del cliente" : "Saldo"}</dt>
                    <dd className="cifra">{pesos(Math.abs(saldo))}</dd>
                  </div>
                </>
              )}
            </dl>
            {venta.observaciones && <p className="mt-3 rounded-xl bg-morado-50 p-3 text-sm">{venta.observaciones}</p>}
            {cancelada && (
              <p className="mt-3 rounded-xl bg-error/5 p-3 text-sm text-error">
                Anulada el {fecha(venta.cancelada_en)}{venta.motivo_cancelacion ? `: ${venta.motivo_cancelacion}` : ""}
              </p>
            )}
          </Tarjeta>

          {venta.pagos_venta.length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Pagos</h2>
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {[...venta.pagos_venta].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{fecha(p.fecha)} · {p.metodos_pago?.nombre}{p.referencia ? ` · ${p.referencia}` : ""}{p.tipo === "reembolso" && <b className="text-error"> · Devolución de dinero</b>}</span>
                    <span className="cifra font-semibold">{p.tipo === "reembolso" ? "− " : ""}{pesos(p.valor)}</span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {venta.devoluciones_venta.length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Devoluciones</h2>
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {venta.devoluciones_venta.map((d) => (
                  <li key={d.id} className="py-2">
                    <div className="flex justify-between gap-2"><b>{d.numero} · {fecha(d.registrado_en)}</b><span className="cifra">{pesos(d.valor_total)}</span></div>
                    <p className="text-suave">{d.motivo}</p>
                    <ul className="text-suave">
                      {d.devolucion_venta_lineas.map((x) => {
                        const l = lineas.find((y) => y.id === x.venta_linea_id);
                        return <li key={x.venta_linea_id}>· {l ? nombreLinea(l) : ""}: {Number(x.cantidad)} {x.condicion === "danada" ? "(dañadas)" : ""}</li>;
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {(ordenes.data ?? []).length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Estampado</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {(ordenes.data ?? []).map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <Link href={`/estampado/${o.id}`} className="font-semibold text-morado underline">Orden {o.numero}</Link>
                    <Insignia tono={ESTADOS_ORDEN[o.estado]?.tono}>{ESTADOS_ORDEN[o.estado]?.texto ?? o.estado}</Insignia>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {esCotizacion && puede("ventas.crear") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Confirmar</h2>
              <ConfirmarCotizacion ventaId={id} total={Number(venta.total)} metodos={listaMetodos} cobra={puede("ventas.cobrar")}
                                   anticipoMinimo={anticipoPct > 0 ? Math.round(Number(venta.total) * anticipoPct) / 100 : 0} />
            </Tarjeta>
          )}

          {esCotizacion && (puntuales.data ?? []).length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Descuentos autorizados para esta cotización</h2>
              <ul className="text-sm">
                {(puntuales.data as { id: string; nombre: string; porcentaje: number | null; valor_por_unidad: number | null; valor_total: number | null; activo: boolean }[])
                  .map((d) => <li key={d.id}>· {d.nombre}: {describirDescuento(d)}{d.activo ? "" : " (inactivo)"}</li>)}
              </ul>
              {puede("ventas.crear") && <p className="mt-2 text-sm text-suave">Para aplicarlo, toca «Editar» y elígelo en el producto.</p>}
            </Tarjeta>
          )}

          {esCotizacion && puede("descuentos.autorizar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Autorizar un descuento</h2>
              <AutorizarDescuento ventaId={id} />
            </Tarjeta>
          )}

          {confirmada && saldo > 0 && puede("ventas.cobrar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Registrar pago</h2>
              <RegistrarPago key={saldo} ventaId={id} saldo={saldo} metodos={listaMetodos} />
            </Tarjeta>
          )}

          {confirmada && !entregada && sinApartar && puede("ventas.crear", "ventas.entregar") && (
            <Tarjeta><ApartarVenta ventaId={id} /></Tarjeta>
          )}

          {confirmada && venta.estado_entrega === "en_preparacion" && puede("ventas.entregar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Entregar</h2>
              <EntregarVenta key={saldo} ventaId={id} saldo={saldo} credito={puede("ventas.credito")} />
            </Tarjeta>
          )}

          {confirmada && !entregada && porEstampar && ordenesActivas.length === 0 && puede("estampado.gestionar") && (
            <Tarjeta><OrdenarEstampado ventaId={id} /></Tarjeta>
          )}

          {entregada && puede("ventas.devolver") && lineas.some((l) => Number(l.cantidad) > (devueltoPorLinea.get(l.id) ?? 0)) && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Devolución del cliente</h2>
              <Devolucion ventaId={id} saldo={saldo} metodos={listaMetodos} puedeReembolsar={puede("ventas.devolver", "ventas.anular")}
                          lineas={lineas.filter((l) => Number(l.cantidad) > (devueltoPorLinea.get(l.id) ?? 0)).map((l) => ({
                            id: l.id, texto: `${nombreLinea(l)} (${l.variantes?.sku ?? ""})`,
                            maximo: Number(l.cantidad) - (devueltoPorLinea.get(l.id) ?? 0),
                            valorUnidad: (Number(l.cantidad) * Number(l.precio_unitario) - Number(l.descuento)) / Number(l.cantidad),
                          }))} />
            </Tarjeta>
          )}

          {!esCotizacion && saldo < 0 && puede("ventas.devolver", "ventas.anular") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Dinero a favor del cliente</h2>
              <Reembolso key={saldo} ventaId={id} maximo={-saldo} metodos={listaMetodos}
                         texto={cancelada ? "La venta se anuló con un anticipo pagado. Registra aquí cuando se lo devuelvas."
                           : "El cliente tiene un saldo a favor. Registra aquí cuando se lo devuelvas."} />
            </Tarjeta>
          )}

          {!cancelada && !entregada && (esCotizacion ? puede("ventas.crear", "ventas.anular") : puede("ventas.anular")) && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">{esCotizacion ? "Anular cotización" : "Anular venta"}</h2>
              <AnularVenta ventaId={id} ayuda={esCotizacion ? "La cotización queda anulada; no se borra."
                : `Se libera lo apartado y se anulan las órdenes de estampado sin empezar.${pagado > 0 ? ` El anticipo de ${pesos(pagado)} queda a favor del cliente hasta que se lo devuelvas.` : ""}`} />
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}
