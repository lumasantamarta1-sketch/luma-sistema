import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ORIGENES, TIPOS_CUENTA } from "@/lib/caja";
import { hoyBogota } from "@/lib/ventas";
import { cn, fecha, pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { CierreCaja, NuevoMovimiento } from "./formularios";

export const metadata: Metadata = { title: "Caja" };

type Saldo = { cuenta_id: string; nombre: string; tipo: string; bodega_id: string | null; saldo: number };
type Movimiento = {
  id: number; ocurrido_en: string; cuenta_id: string; sentido: string; origen: string; valor: number;
  documento_tipo: string | null; documento_id: string | null; descripcion: string | null; usuario_id: string | null;
};

const fechaValida = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "");
const hora = (t: string) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(new Date(t));

export default async function PaginaCaja({ searchParams }: { searchParams: Promise<{ cuenta?: string; desde?: string; hasta?: string }> }) {
  const f = await searchParams;
  const sesion = await exigirPermiso("caja.ver", "caja.gestionar", "caja.cerrar");
  const supabase = await crearClienteServidor();
  const ve = tiene(sesion, "caja.ver");
  const hoy = hoyBogota();

  const [{ data: cuentasData }, { data: saldosData }, { data: cierresHoy }] = await Promise.all([
    supabase.from("cuentas_dinero").select("id, nombre, tipo, bodega_id").eq("activo", true).order("tipo").order("nombre"),
    ve ? supabase.rpc("saldos_cuentas") : Promise.resolve({ data: null }),
    supabase.from("cierres_caja").select("id, cuenta_id, saldo_esperado, saldo_contado, justificacion").eq("fecha", hoy),
  ]);
  const misPuntos = new Set(sesion.bodegas.map((b) => b.id));
  const cuentas = ((cuentasData ?? []) as { id: string; nombre: string; tipo: string; bodega_id: string | null }[])
    .filter((c) => !c.bodega_id || misPuntos.has(c.bodega_id) || tiene(sesion, "bodegas.todas"));
  const saldos = (saldosData ?? []) as Saldo[];
  const saldoDe = new Map(saldos.map((s) => [s.cuenta_id, Number(s.saldo)]));
  const total = saldos.reduce((s, x) => s + Number(x.saldo), 0);
  const cajas = cuentas.filter((c) => c.tipo === "efectivo");
  const cerradas = new Map((cierresHoy ?? []).map((c) => [c.cuenta_id as string, c]));

  // Movimientos del periodo (por defecto, hoy)
  const desde = fechaValida(f.desde) || hoy;
  const hasta = fechaValida(f.hasta) || hoy;
  const cuentaFiltro = cuentas.some((c) => c.id === f.cuenta) ? f.cuenta : undefined;
  let movimientos: Movimiento[] = [];
  const enlaces = new Map<string, string>();
  const nombres = new Map<string, string>();
  if (ve) {
    let consulta = supabase.from("movimientos_caja")
      .select("id, ocurrido_en, cuenta_id, sentido, origen, valor, documento_tipo, documento_id, descripcion, usuario_id")
      .gte("ocurrido_en", `${desde}T00:00:00-05:00`).lte("ocurrido_en", `${hasta}T23:59:59.999-05:00`)
      .order("ocurrido_en", { ascending: false }).limit(500);
    if (cuentaFiltro) consulta = consulta.eq("cuenta_id", cuentaFiltro);
    const [{ data }, { data: usuarios }] = await Promise.all([consulta, supabase.rpc("usuarios_nombres")]);
    movimientos = (data ?? []) as Movimiento[];
    for (const u of (usuarios ?? []) as { id: string; nombre: string }[]) nombres.set(u.id, u.nombre);
    // Cada cobro o pago enlaza con su documento
    const pagosVenta = movimientos.filter((m) => m.documento_tipo === "pago_venta" && m.documento_id).map((m) => m.documento_id as string);
    const pagosCompra = movimientos.filter((m) => m.documento_tipo === "pago_compra" && m.documento_id).map((m) => m.documento_id as string);
    const [{ data: pv }, { data: pc }] = await Promise.all([
      pagosVenta.length ? supabase.from("pagos_venta").select("id, venta_id").in("id", pagosVenta) : Promise.resolve({ data: [] }),
      pagosCompra.length ? supabase.from("pagos_compra").select("id, compra_id").in("id", pagosCompra) : Promise.resolve({ data: [] }),
    ]);
    for (const p of (pv ?? []) as { id: string; venta_id: string }[]) enlaces.set(p.id, `/ventas/${p.venta_id}`);
    for (const p of (pc ?? []) as { id: string; compra_id: string }[]) enlaces.set(p.id, `/compras/${p.compra_id}`);
    for (const m of movimientos) if (m.documento_tipo === "gasto" && m.documento_id) enlaces.set(m.documento_id, `/gastos/${m.documento_id}`);
  }
  const entradas = movimientos.filter((m) => m.sentido === "entrada").reduce((s, m) => s + Number(m.valor), 0);
  const salidas = movimientos.filter((m) => m.sentido === "salida").reduce((s, m) => s + Number(m.valor), 0);
  const nombreCuenta = new Map(cuentas.map((c) => [c.id, c.nombre]));

  return (
    <>
      <Encabezado titulo="Caja" descripcion="Dinero real en cada cuenta: cajas de los puntos, Nequi y banco." />
      <Pestanas actual="/caja" etiqueta="Caja" items={[
        { ruta: "/caja", titulo: "Saldos y movimientos" },
        { ruta: "/caja/cuentas", titulo: "Cuentas y métodos de pago", ver: tiene(sesion, "configuracion.gestionar") },
      ]} />

      {ve && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {saldos.map((s) => (
            <Tarjeta key={s.cuenta_id} className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-suave">{s.nombre}</p>
              <p className={cn("cifra font-titulo text-2xl font-semibold", Number(s.saldo) < 0 ? "text-error" : "text-morado")}>{pesos(s.saldo)}</p>
              <p className="text-xs text-suave">{TIPOS_CUENTA[s.tipo] ?? s.tipo} · Dinero real</p>
            </Tarjeta>
          ))}
          {saldos.length > 1 && (
            <Tarjeta className="flex flex-col gap-1 bg-morado-50">
              <p className="text-sm font-semibold text-suave">Total</p>
              <p className="cifra font-titulo text-2xl font-semibold text-morado">{pesos(total)}</p>
              <p className="text-xs text-suave">Suma de las cuentas que puedes ver</p>
            </Tarjeta>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {ve ? (
            <Tarjeta>
              <h2 className="mb-3 text-lg font-semibold text-morado">Movimientos</h2>
              <form className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Cuenta
                  <select name="cuenta" defaultValue={cuentaFiltro ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
                    <option value="">Todas</option>
                    {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Desde
                  <input type="date" name="desde" defaultValue={desde} max={hoy} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Hasta
                  <input type="date" name="hasta" defaultValue={hasta} max={hoy} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
                </label>
                <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Ver</button>
              </form>
              <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div><dt className="inline text-suave">Entradas: </dt><dd className="cifra inline font-semibold text-morado">{pesos(entradas)}</dd></div>
                <div><dt className="inline text-suave">Salidas: </dt><dd className="cifra inline font-semibold text-morado">{pesos(salidas)}</dd></div>
              </dl>
              {movimientos.length === 0 && <p className="text-sm text-suave">No hay movimientos en esas fechas.</p>}
              <ul className="flex flex-col divide-y divide-borde">
                {movimientos.map((m) => {
                  const destino = m.documento_id ? enlaces.get(m.documento_id) : undefined;
                  return (
                    <li key={m.id} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{ORIGENES[m.origen] ?? m.origen}
                          {destino && <Link href={destino} className="ml-2 font-normal text-morado underline">ver</Link>}</p>
                        <p className="text-suave">
                          {fecha(m.ocurrido_en)} {hora(m.ocurrido_en)} · {nombreCuenta.get(m.cuenta_id) ?? "Cuenta"}
                          {m.descripcion ? ` · ${m.descripcion}` : ""}{m.usuario_id && nombres.get(m.usuario_id) ? ` · ${nombres.get(m.usuario_id)}` : ""}
                        </p>
                      </div>
                      <span className={cn("cifra whitespace-nowrap font-semibold", m.sentido === "entrada" ? "text-morado" : "text-error")}>
                        {m.sentido === "entrada" ? "+" : "−"} {pesos(m.valor)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {movimientos.length === 500 && <p className="mt-2 text-sm text-suave">Se muestran los 500 más recientes. Acota las fechas para ver otros.</p>}
            </Tarjeta>
          ) : (
            <Tarjeta className="text-suave">Puedes hacer el cierre de tu caja; los saldos y movimientos los consulta quien tiene permiso de ver caja.</Tarjeta>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {tiene(sesion, "caja.cerrar") && cajas.map((c) => {
            const cierre = cerradas.get(c.id);
            return (
              <Tarjeta key={c.id}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="flex-1 text-lg font-semibold text-morado">Cierre de {c.nombre}</h2>
                  {cierre && <Insignia tono="exito">Cerrada hoy</Insignia>}
                </div>
                {cierre ? (
                  <p className="text-sm">
                    Contado <b className="cifra">{pesos(cierre.saldo_contado)}</b>
                    {Number(cierre.saldo_contado) !== Number(cierre.saldo_esperado)
                      ? <> · {Number(cierre.saldo_contado) < Number(cierre.saldo_esperado) ? "faltaron" : "sobraron"}{" "}
                          <b className="cifra">{pesos(Math.abs(Number(cierre.saldo_contado) - Number(cierre.saldo_esperado)))}</b>
                          {cierre.justificacion ? ` (${cierre.justificacion})` : ""}</>
                      : " · cuadró exacto"}
                  </p>
                ) : (
                  <CierreCaja cuenta={c} esperado={ve ? saldoDe.get(c.id) ?? 0 : null} />
                )}
              </Tarjeta>
            );
          })}
          {tiene(sesion, "caja.gestionar") && cuentas.length > 0 && (
            <Tarjeta><NuevoMovimiento cuentas={cuentas} /></Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}
