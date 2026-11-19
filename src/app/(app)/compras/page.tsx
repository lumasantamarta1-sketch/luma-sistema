import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ESTADO_COMPRA, saldoCompra } from "@/lib/compras";
import { cn, fecha, mensajeError, pesos } from "@/lib/utilidades";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Compras" };

const FILTROS = [
  { valor: "", titulo: "Todas" },
  { valor: "borrador", titulo: "Borradores" },
  { valor: "por_recibir", titulo: "Por recibir" },
  { valor: "recibidas", titulo: "Recibidas" },
  { valor: "por_pagar", titulo: "Por pagar" },
  { valor: "anulada", titulo: "Anuladas" },
];

type Fila = {
  id: string; numero: string; fecha: string; estado: string; total: number; forma_pago: string | null;
  proveedores: { nombre: string } | null; bodegas: { nombre: string } | null;
  pagos_compra: { tipo: string; valor: number }[]; devoluciones_proveedor: { valor_total: number }[];
};
type PorRecibir = { compra_id: string; numero: string; fecha: string; estado: string; proveedor: string; bodega: string; unidades_pendientes: number; productos_pendientes: number };

export default async function PaginaCompras({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string; q?: string }> }) {
  const f = await searchParams;
  const sesion = await exigirPermiso("compras.ver", "compras.gestionar", "compras.recibir");
  const supabase = await crearClienteServidor();
  const boton = tiene(sesion, "compras.gestionar") ? (
    <Link href="/compras/nueva" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
      <Plus className="size-5" aria-hidden /> Nueva compra
    </Link>
  ) : undefined;

  // Quien solo recibe mercancía ve las compras pendientes, sin costos
  if (!tiene(sesion, "compras.ver")) {
    const { data, error } = await supabase.rpc("compras_por_recibir", {});
    const pendientes = (data ?? []) as PorRecibir[];
    return (
      <>
        <Encabezado titulo="Compras por recibir" descripcion="Mercancía que el proveedor debe entregar. Cuenta lo que llega y regístralo." acciones={boton} />
        {error && <Tarjeta className="text-error">{mensajeError(error)}</Tarjeta>}
        {!error && pendientes.length === 0 && <Tarjeta className="text-center text-suave">No hay mercancía pendiente por recibir.</Tarjeta>}
        <ul className="flex flex-col gap-2">
          {pendientes.map((c) => (
            <li key={c.compra_id}>
              <Link href={`/compras/${c.compra_id}/recibir`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-borde bg-white p-4 hover:border-morado">
                <span className="font-semibold">{c.numero}</span>
                <span className="text-sm text-suave">{fecha(`${c.fecha}T12:00:00`)} · {c.proveedor} · llega a {c.bodega}</span>
                <span className="ml-auto"><Insignia tono={ESTADO_COMPRA[c.estado]?.tono}>{ESTADO_COMPRA[c.estado]?.texto}</Insignia></span>
                <span className="basis-full text-sm">{Number(c.unidades_pendientes)} unidad(es) pendientes de {c.productos_pendientes} producto(s)</span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const estado = FILTROS.some((x) => x.valor === f.estado) ? f.estado ?? "" : "";
  const q = (f.q ?? "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 40);
  const { data: proveedores } = await supabase.from("proveedores").select("id, nombre").order("nombre");
  const proveedor = (proveedores ?? []).some((p) => p.id === f.proveedor) ? f.proveedor : undefined;
  let consulta = supabase.from("compras")
    .select("id, numero, fecha, estado, total, forma_pago, proveedores(nombre), bodegas(nombre), pagos_compra(tipo, valor), devoluciones_proveedor(valor_total)")
    .order("fecha", { ascending: false }).order("numero", { ascending: false }).limit(300);
  if (estado === "borrador" || estado === "anulada") consulta = consulta.eq("estado", estado);
  if (estado === "por_recibir") consulta = consulta.in("estado", ["confirmada", "recibida_parcial"]);
  if (estado === "recibidas") consulta = consulta.in("estado", ["recibida_parcial", "recibida"]);
  if (estado === "por_pagar") consulta = consulta.in("estado", ["confirmada", "recibida_parcial", "recibida"]);
  if (proveedor) consulta = consulta.eq("proveedor_id", proveedor);
  if (q) consulta = consulta.ilike("numero", `%${q}%`);
  const { data } = await consulta;
  let compras = (data ?? []) as unknown as Fila[];
  if (estado === "por_pagar") compras = compras.filter((c) => saldoCompra(c) > 0);
  const porPagar = compras.filter((c) => ["recibida_parcial", "recibida"].includes(c.estado)).reduce((s, c) => s + Math.max(saldoCompra(c), 0), 0);
  const enlace = (cambio: Record<string, string>) => {
    const p = new URLSearchParams({ ...(estado ? { estado } : {}), ...(proveedor ? { proveedor } : {}), ...(q ? { q } : {}), ...cambio });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/compras${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <Encabezado titulo="Compras" descripcion="Camisetas base, materiales y mercancía: lo que se pide, lo que llega y lo que se paga." acciones={boton} />
      <div className="mb-3 flex gap-1 overflow-x-auto" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((x) => (
          <Link key={x.valor} href={enlace({ estado: x.valor })} aria-current={estado === x.valor ? "true" : undefined}
                className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold",
                              estado === x.valor ? "border-morado bg-morado text-white" : "border-borde bg-white text-suave hover:border-morado")}>
            {x.titulo}
          </Link>
        ))}
      </div>
      <form className="mb-4 grid gap-2 rounded-2xl border border-borde bg-white p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {estado && <input type="hidden" name="estado" value={estado} />}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Proveedor
          <select name="proveedor" defaultValue={proveedor ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
            <option value="">Todos</option>
            {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Número
          <input type="search" name="q" defaultValue={q} placeholder="C-00001" className="min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Filtrar</button>
      </form>
      {porPagar > 0 && (
        <Tarjeta className="mb-4 flex flex-wrap items-center gap-2 border-naranja">
          <span className="text-sm font-semibold text-suave">Por pagar a proveedores (mercancía recibida)</span>
          <span className="cifra ml-auto font-titulo text-xl font-semibold text-morado">{pesos(porPagar)}</span>
        </Tarjeta>
      )}
      {compras.length === 0 ? (
        <Tarjeta className="text-center text-suave">{estado || proveedor || q ? "No hay compras con esos filtros." : "Aún no hay compras registradas."}</Tarjeta>
      ) : (
        <ul className="flex flex-col gap-2">
          {compras.map((c) => {
            const e = ESTADO_COMPRA[c.estado];
            const saldo = saldoCompra(c);
            return (
              <li key={c.id}>
                <Link href={`/compras/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-borde bg-white p-4 hover:border-morado">
                  <span className="font-semibold">{c.numero}</span>
                  <span className="text-sm text-suave">{fecha(`${c.fecha}T12:00:00`)} · {c.bodegas?.nombre}</span>
                  <Insignia tono={e?.tono}>{e?.texto ?? c.estado}</Insignia>
                  <span className="ml-auto cifra text-lg font-semibold text-morado">{pesos(c.total)}</span>
                  <span className="basis-full text-sm">
                    {c.proveedores?.nombre}{c.forma_pago ? <span className="text-suave"> · {c.forma_pago}</span> : null}
                    {c.estado !== "borrador" && c.estado !== "anulada" && saldo > 0 && <b className="cifra text-naranja"> · debe {pesos(saldo)}</b>}
                    {saldo < 0 && <b className="cifra text-morado"> · a favor {pesos(-saldo)}</b>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
