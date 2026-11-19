import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { detalleVariante } from "@/lib/catalogo";
import { ESTADO_COMPRA, HECHOS_COMPRA, saldoCompra } from "@/lib/compras";
import { obtenerAdjuntos } from "@/lib/adjuntos";
import { fecha, pesos } from "@/lib/utilidades";
import { numero } from "@/lib/inventario";
import { Aviso } from "@/components/ui/aviso";
import { SubirAdjunto } from "@/components/app/adjuntos";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { AnularCompra, ConfirmarBorrador, DevolverAProveedor, PagarCompra, RecibirCompra } from "../formularios";

export const metadata: Metadata = { title: "Compra" };

type ConNombre = { nombre: string } | null;
type Linea = {
  id: string; cantidad: number; cantidad_recibida: number; cantidad_devuelta: number; costo_unitario: number; descuento: number;
  impuesto_pct: number; costo_neto_unitario: number | null;
  variantes: { sku: string; productos: { nombre: string; unidad_medida: string } | null; tallas: ConNombre; colores: ConNombre; tipos_camiseta: ConNombre; disenos: ConNombre } | null;
};
type Compra = {
  id: string; numero: string; fecha: string; estado: string; forma_pago: string | null; observaciones: string | null; bodega_id: string;
  subtotal: number; descuentos: number; impuestos: number; costos_adicionales: number; total: number;
  creado_por: string | null; creado_en: string; confirmado_por: string | null; confirmado_en: string | null;
  proveedores: { nombre: string; telefono: string | null } | null; bodegas: ConNombre;
  compra_lineas: Linea[]; compra_costos_adicionales: { concepto: string; valor: number }[];
  pagos_compra: { id: string; tipo: string; fecha: string; valor: number; referencia: string | null; cuentas_dinero: ConNombre }[];
  devoluciones_proveedor: { id: string; numero: string; fecha: string; motivo: string; valor_total: number;
    devolucion_proveedor_lineas: { compra_linea_id: string; cantidad: number }[] }[];
};

const enlace = "inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50";

export default async function DetalleCompra({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hecho?: string }> }) {
  const [{ id }, { hecho }] = await Promise.all([params, searchParams]);
  const sesion = await exigirPermiso("compras.ver");
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("compras")
    .select(`id, numero, fecha, estado, forma_pago, observaciones, bodega_id, subtotal, descuentos, impuestos, costos_adicionales, total,
      creado_por, creado_en, confirmado_por, confirmado_en, proveedores(nombre, telefono), bodegas(nombre),
      compra_lineas(id, cantidad, cantidad_recibida, cantidad_devuelta, costo_unitario, descuento, impuesto_pct, costo_neto_unitario,
        variantes(sku, productos(nombre, unidad_medida), tallas(nombre), colores(nombre), tipos_camiseta(nombre), disenos(nombre))),
      compra_costos_adicionales(concepto, valor),
      pagos_compra(id, tipo, fecha, valor, referencia, cuentas_dinero(nombre)),
      devoluciones_proveedor(id, numero, fecha, motivo, valor_total, devolucion_proveedor_lineas(compra_linea_id, cantidad))`)
    .eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as unknown as Compra;
  const puede = (...p: string[]) => tiene(sesion, ...p);
  const saldo = saldoCompra(c);
  const pagado = c.pagos_compra.reduce((s, p) => s + (p.tipo === "pago" ? 1 : -1) * Number(p.valor), 0);
  const devuelto = c.devoluciones_proveedor.reduce((s, d) => s + Number(d.valor_total), 0);
  const lineas = [...c.compra_lineas].sort((a, b) => (a.variantes?.sku ?? "").localeCompare(b.variantes?.sku ?? ""));
  const nombreLinea = (l: Linea) => `${l.variantes?.productos?.nombre ?? ""}${l.variantes ? ` · ${detalleVariante(l.variantes) || l.variantes.sku}` : ""}`;
  const abierta = c.estado === "confirmada" || c.estado === "recibida_parcial";
  const recibido = lineas.some((l) => Number(l.cantidad_recibida) > 0);

  const [adjuntos, { data: nombres }, { data: cuentasData }, { data: saldosData }] = await Promise.all([
    obtenerAdjuntos(supabase, "compra", id),
    supabase.rpc("usuarios_nombres"),
    supabase.from("cuentas_dinero").select("id, nombre, tipo, bodega_id").eq("activo", true).order("tipo").order("nombre"),
    puede("caja.ver") ? supabase.rpc("saldos_cuentas") : Promise.resolve({ data: null }),
  ]);
  const nombre = (uid: string | null) => (nombres as { id: string; nombre: string }[] | null)?.find((n) => n.id === uid)?.nombre ?? "";
  const misPuntos = new Set(sesion.bodegas.map((b) => b.id));
  const saldoDe = new Map(((saldosData ?? []) as { cuenta_id: string; saldo: number }[]).map((s) => [s.cuenta_id, Number(s.saldo)]));
  const cuentas = ((cuentasData ?? []) as { id: string; nombre: string; tipo: string; bodega_id: string | null }[])
    .filter((x) => !x.bodega_id || misPuntos.has(x.bodega_id) || puede("bodegas.todas"))
    .map((x) => ({ id: x.id, nombre: x.nombre, saldo: saldoDe.has(x.id) ? saldoDe.get(x.id) : undefined }));
  const e = ESTADO_COMPRA[c.estado];

  return (
    <>
      <Encabezado titulo={`Compra ${c.numero}`}
                  descripcion={[c.proveedores?.nombre, `llega a ${c.bodegas?.nombre ?? ""}`, fecha(`${c.fecha}T12:00:00`)].filter(Boolean).join(" · ")}
                  acciones={<>
                    {c.estado === "borrador" && puede("compras.gestionar") && <Link href={`/compras/${id}/editar`} className={enlace}>Editar</Link>}
                    <Link href="/compras" className={enlace}>Volver</Link>
                  </>} />
      {hecho && HECHOS_COMPRA[hecho] && <div className="mb-4"><Aviso tipo="exito">{HECHOS_COMPRA[hecho]}</Aviso></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tarjeta>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-lg font-semibold text-morado">{c.proveedores?.nombre}</h2>
              <Insignia tono={e?.tono}>{e?.texto ?? c.estado}</Insignia>
            </div>
            <ul className="flex flex-col divide-y divide-borde">
              {lineas.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <p className="min-w-0 flex-1 font-semibold">{nombreLinea(l)}</p>
                    <p className="cifra font-semibold">{pesos(Number(l.cantidad) * Number(l.costo_unitario) - Number(l.descuento))}</p>
                  </div>
                  <p className="cifra text-sm text-suave">
                    {l.variantes?.sku} · {numero(l.cantidad)} × {pesos(l.costo_unitario)}
                    {Number(l.descuento) > 0 && ` · descuento ${pesos(l.descuento)}`}
                    {Number(l.impuesto_pct) > 0 && ` · IVA ${Number(l.impuesto_pct)} %`}
                    {l.costo_neto_unitario !== null && ` · costo final ${pesos(l.costo_neto_unitario)} c/u`}
                  </p>
                  {c.estado !== "borrador" && c.estado !== "anulada" && (
                    <p className="text-sm">
                      Recibidas <b className="cifra">{numero(l.cantidad_recibida)}</b> de {numero(l.cantidad)}
                      {Number(l.cantidad_devuelta) > 0 && <> · devueltas <b className="cifra">{numero(l.cantidad_devuelta)}</b></>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1 border-t border-borde pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-suave">Subtotal</dt><dd className="cifra">{pesos(c.subtotal)}</dd></div>
              {Number(c.descuentos) > 0 && <div className="flex justify-between"><dt className="text-suave">Descuentos</dt><dd className="cifra">− {pesos(c.descuentos)}</dd></div>}
              {Number(c.impuestos) > 0 && <div className="flex justify-between"><dt className="text-suave">IVA</dt><dd className="cifra">{pesos(c.impuestos)}</dd></div>}
              {c.compra_costos_adicionales.map((a, i) => (
                <div key={i} className="flex justify-between"><dt className="text-suave">{a.concepto}</dt><dd className="cifra">{pesos(a.valor)}</dd></div>
              ))}
              <div className="flex justify-between text-lg font-semibold text-morado"><dt>Total</dt><dd className="cifra">{pesos(c.total)}</dd></div>
              {c.estado !== "borrador" && (
                <>
                  <div className="flex justify-between"><dt className="text-suave">Pagado</dt><dd className="cifra">{pesos(pagado)}</dd></div>
                  {devuelto > 0 && <div className="flex justify-between"><dt className="text-suave">Devuelto al proveedor</dt><dd className="cifra">− {pesos(devuelto)}</dd></div>}
                  <div className={`flex justify-between font-semibold ${saldo > 0 ? "text-naranja" : "text-morado"}`}>
                    <dt>{saldo > 0 ? "Por pagar" : saldo < 0 ? "Saldo a favor de LUMA" : "Saldo"}</dt><dd className="cifra">{pesos(Math.abs(saldo))}</dd>
                  </div>
                </>
              )}
            </dl>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {c.forma_pago && <div><dt className="inline text-suave">Forma de pago: </dt><dd className="inline">{c.forma_pago}</dd></div>}
              <div><dt className="inline text-suave">Creada: </dt><dd className="inline">{fecha(c.creado_en)}{nombre(c.creado_por) ? ` por ${nombre(c.creado_por)}` : ""}</dd></div>
              {c.confirmado_en && <div><dt className="inline text-suave">Confirmada: </dt><dd className="inline">{fecha(c.confirmado_en)}{nombre(c.confirmado_por) ? ` por ${nombre(c.confirmado_por)}` : ""}</dd></div>}
            </dl>
            {c.observaciones && <p className="mt-3 rounded-xl bg-morado-50 p-3 text-sm">{c.observaciones}</p>}
          </Tarjeta>

          {c.pagos_compra.length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Pagos</h2>
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {[...c.pagos_compra].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{fecha(p.fecha)} · {p.cuentas_dinero?.nombre}{p.referencia ? ` · ${p.referencia}` : ""}{p.tipo === "reembolso" && <b> · Reembolso del proveedor</b>}</span>
                    <span className="cifra font-semibold">{p.tipo === "reembolso" ? "− " : ""}{pesos(p.valor)}</span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {c.devoluciones_proveedor.length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Devoluciones al proveedor</h2>
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {c.devoluciones_proveedor.map((d) => (
                  <li key={d.id} className="py-2">
                    <div className="flex justify-between gap-2"><b>{d.numero} · {fecha(`${d.fecha}T12:00:00`)}</b><span className="cifra">{pesos(d.valor_total)}</span></div>
                    <p className="text-suave">{d.motivo}</p>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Factura del proveedor</h2>
            {adjuntos.length === 0 && <p className="mb-3 text-sm text-suave">Aún no hay factura ni remisión adjunta.</p>}
            <ul className="mb-3 flex flex-col gap-2">
              {adjuntos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-suave" aria-hidden />
                  {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-morado underline">{a.nombre}</a> : <span>{a.nombre}</span>}
                  <span className="text-suave">· {fecha(a.subido_en)}</span>
                </li>
              ))}
            </ul>
            {c.estado !== "anulada" && puede("compras.gestionar") && (
              <SubirAdjunto tipo="compra" documentoId={c.id} texto="Adjuntar factura (foto o PDF)" ayuda="Queda privada: solo la ven quienes pueden ver compras." />
            )}
          </Tarjeta>
        </div>

        <div className="flex flex-col gap-4">
          {c.estado === "borrador" && puede("compras.gestionar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Confirmar</h2>
              <ConfirmarBorrador compraId={c.id} />
            </Tarjeta>
          )}
          {abierta && puede("compras.recibir", "compras.gestionar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Recibir mercancía</h2>
              <RecibirCompra compraId={c.id} lineas={lineas.filter((l) => Number(l.cantidad) > Number(l.cantidad_recibida)).map((l) => ({
                id: l.id, texto: `${nombreLinea(l)} (${l.variantes?.sku ?? ""})`, pendiente: Number(l.cantidad) - Number(l.cantidad_recibida),
                unidad: l.variantes?.productos?.unidad_medida ?? "unidad",
              }))} />
            </Tarjeta>
          )}
          {c.estado !== "borrador" && c.estado !== "anulada" && saldo > 0 && puede("compras.pagar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Pagar al proveedor</h2>
              {!recibido && <p className="mb-2 text-sm text-suave">La mercancía aún no llega: lo que pagues queda como anticipo.</p>}
              <PagarCompra key={saldo} compraId={c.id} cuentas={cuentas} valor={saldo} />
            </Tarjeta>
          )}
          {saldo < 0 && puede("compras.pagar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Reembolso del proveedor</h2>
              <p className="mb-2 text-sm text-suave">El proveedor te debe {pesos(-saldo)} por mercancía devuelta. Regístralo cuando te devuelva el dinero.</p>
              <PagarCompra key={saldo} compraId={c.id} cuentas={cuentas} valor={-saldo} tipo="reembolso" />
            </Tarjeta>
          )}
          {(c.estado === "recibida" || c.estado === "recibida_parcial") && puede("compras.gestionar")
            && lineas.some((l) => Number(l.cantidad_recibida) > Number(l.cantidad_devuelta)) && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Devolver al proveedor</h2>
              <DevolverAProveedor compraId={c.id} lineas={lineas.filter((l) => Number(l.cantidad_recibida) > Number(l.cantidad_devuelta)).map((l) => ({
                id: l.id, texto: `${nombreLinea(l)} (${l.variantes?.sku ?? ""})`, maximo: Number(l.cantidad_recibida) - Number(l.cantidad_devuelta),
                costo: Number(l.costo_neto_unitario ?? l.costo_unitario),
              }))} />
            </Tarjeta>
          )}
          {c.estado !== "anulada" && !recibido && pagado === 0 && puede("compras.gestionar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Anular</h2>
              <AnularCompra compraId={c.id} />
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}
