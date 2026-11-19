import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { estadoVenta, numeroVenta, saldoVenta } from "@/lib/ventas";
import { cn, fecha, pesos } from "@/lib/utilidades";
import { PestanasVentas } from "@/components/app/pestanas-ventas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Ventas" };

const FILTROS = [
  { valor: "", titulo: "Todas" },
  { valor: "cotizacion", titulo: "Cotizaciones" },
  { valor: "pendientes", titulo: "Por entregar" },
  { valor: "entregadas", titulo: "Entregadas" },
  { valor: "anuladas", titulo: "Anuladas" },
];

type Fila = {
  id: string; numero: string | null; numero_cotizacion: string | null; estado: string; estado_entrega: string; total: number;
  creado_en: string; confirmada_en: string | null; bodegas: { nombre: string } | null; clientes: { nombre: string } | null;
  perfiles: { nombre: string } | null; pagos_venta: { tipo: string; valor: number }[]; devoluciones_venta: { valor_total: number }[];
};

const fechaValida = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "");

export default async function PaginaVentas({ searchParams }: {
  searchParams: Promise<{ estado?: string; punto?: string; q?: string; desde?: string; hasta?: string }>;
}) {
  const filtros = await searchParams;
  const sesion = await exigirPermiso("ventas.ver", "ventas.ver_propias", "ventas.crear", "ventas.entregar");
  const supabase = await crearClienteServidor();
  const estado = FILTROS.some((f) => f.valor === filtros.estado) ? filtros.estado ?? "" : "";
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");
  const punto = puntos.some((p) => p.id === filtros.punto) ? filtros.punto : undefined;
  // Solo letras, números, espacios y guiones: el texto va dentro de un filtro de PostgREST
  const q = (filtros.q ?? "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 60);
  const desde = fechaValida(filtros.desde);
  const hasta = fechaValida(filtros.hasta);
  const veTodas = tiene(sesion, "ventas.ver");

  let consulta = supabase.from("ventas")
    .select("id, numero, numero_cotizacion, estado, estado_entrega, total, creado_en, confirmada_en, bodegas(nombre), clientes(nombre), perfiles(nombre), pagos_venta(tipo, valor), devoluciones_venta(valor_total)")
    .order("creado_en", { ascending: false }).limit(100);
  if (estado === "cotizacion") consulta = consulta.eq("estado", "cotizacion");
  if (estado === "pendientes") consulta = consulta.eq("estado", "confirmada").neq("estado_entrega", "entregada");
  if (estado === "entregadas") consulta = consulta.eq("estado", "confirmada").eq("estado_entrega", "entregada");
  if (estado === "anuladas") consulta = consulta.eq("estado", "cancelada");
  if (punto) consulta = consulta.eq("bodega_id", punto);
  if (desde) consulta = consulta.gte("creado_en", `${desde}T00:00:00-05:00`);
  if (hasta) consulta = consulta.lte("creado_en", `${hasta}T23:59:59.999-05:00`);
  if (q) {
    const { data: clientes } = await supabase.from("clientes").select("id").or(`nombre.ilike.%${q}%,documento.ilike.%${q}%,telefono.ilike.%${q}%`).limit(50);
    const ids = (clientes ?? []).map((c) => c.id);
    consulta = consulta.or([`numero.ilike.%${q}%`, `numero_cotizacion.ilike.%${q}%`, ...(ids.length ? [`cliente_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  const { data } = await consulta;
  const ventas = (data ?? []) as unknown as Fila[];
  const enlaceFiltro = (valor: string) => {
    const p = new URLSearchParams();
    if (valor) p.set("estado", valor);
    if (punto) p.set("punto", punto);
    if (q) p.set("q", q);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    return `/ventas${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <Encabezado titulo="Ventas" descripcion={veTodas ? "Cotizaciones, ventas y entregas de tus puntos." : "Tus cotizaciones, ventas y entregas."}
                  acciones={tiene(sesion, "ventas.crear") && puntos.length > 0 ? (
                    <Link href="/ventas/nueva" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
                      <Plus className="size-5" aria-hidden /> Nueva venta
                    </Link>
                  ) : undefined} />
      <PestanasVentas actual="/ventas" permisos={sesion.permisos} />

      <div className="mb-3 flex gap-1 overflow-x-auto" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <Link key={f.valor} href={enlaceFiltro(f.valor)} aria-current={estado === f.valor ? "true" : undefined}
                className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold",
                              estado === f.valor ? "border-morado bg-morado text-white" : "border-borde bg-white text-suave hover:border-morado")}>
            {f.titulo}
          </Link>
        ))}
      </div>

      <form className="mb-4 grid gap-2 rounded-2xl border border-borde bg-white p-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
        {estado && <input type="hidden" name="estado" value={estado} />}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Buscar
          <input type="search" name="q" defaultValue={q} placeholder="Número, cliente, documento o teléfono"
                 className="min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
        </label>
        {puntos.length > 1 && (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Punto
            <select name="punto" defaultValue={punto ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
              <option value="">Todos</option>
              {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Desde
          <input type="date" name="desde" defaultValue={desde} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Hasta
          <input type="date" name="hasta" defaultValue={hasta} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Filtrar</button>
      </form>

      {ventas.length === 0 ? (
        <Tarjeta className="text-center text-suave">
          {q || desde || hasta || estado ? "No hay ventas con esos filtros." : "Aún no hay ventas registradas."}
        </Tarjeta>
      ) : (
        <ul className="flex flex-col gap-2">
          {ventas.map((v) => {
            const { texto, tono } = estadoVenta(v);
            const saldo = v.estado === "cotizacion" ? 0 : saldoVenta(v);
            return (
              <li key={v.id}>
                <Link href={`/ventas/${v.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-borde bg-white p-4 hover:border-morado">
                  <span className="font-semibold">{numeroVenta(v)}</span>
                  <span className="text-sm text-suave">{fecha(v.confirmada_en ?? v.creado_en)} · {v.bodegas?.nombre}</span>
                  <Insignia tono={tono}>{texto}</Insignia>
                  <span className="ml-auto cifra text-lg font-semibold text-morado">{pesos(v.total)}</span>
                  <span className="basis-full text-sm">
                    {v.clientes?.nombre ?? "Cliente mostrador"}
                    {veTodas && v.perfiles?.nombre && <span className="text-suave"> · vendió {v.perfiles.nombre}</span>}
                    {saldo > 0 && <b className="cifra text-naranja"> · debe {pesos(saldo)}</b>}
                    {saldo < 0 && <b className="cifra text-morado"> · a favor {pesos(-saldo)}</b>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {ventas.length === 100 && <p className="mt-3 text-sm text-suave">Se muestran las 100 más recientes. Usa los filtros para encontrar otras.</p>}
    </>
  );
}
