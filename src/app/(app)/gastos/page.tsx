import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ESTADO_GASTO, inicioMesBogota } from "@/lib/gastos";
import { hoyBogota } from "@/lib/ventas";
import { cn, fecha, pesos } from "@/lib/utilidades";
import { PestanasGastos } from "@/components/app/pestanas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { GenerarRecurrentes } from "./formularios";

export const metadata: Metadata = { title: "Gastos" };

const ESTADOS = [
  { valor: "", titulo: "Todos" },
  { valor: "pendiente", titulo: "Por pagar" },
  { valor: "pagado", titulo: "Pagados" },
  { valor: "anulado", titulo: "Anulados" },
];

type Fila = {
  id: string; numero: string; fecha: string; descripcion: string; valor: number; estado: string; beneficiario: string | null;
  categorias_gasto: { nombre: string } | null; bodegas: { nombre: string } | null; proveedores: { nombre: string } | null;
};

const fechaValida = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "");

export default async function PaginaGastos({ searchParams }: {
  searchParams: Promise<{ estado?: string; categoria?: string; punto?: string; desde?: string; hasta?: string; q?: string }>;
}) {
  const f = await searchParams;
  const sesion = await exigirPermiso("gastos.ver", "gastos.registrar", "gastos.configurar");
  const supabase = await crearClienteServidor();
  const registra = tiene(sesion, "gastos.registrar");
  const boton = registra ? (
    <Link href="/gastos/nuevo" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
      <Plus className="size-5" aria-hidden /> Registrar gasto
    </Link>
  ) : null;

  if (!tiene(sesion, "gastos.ver")) {
    return (
      <>
        <Encabezado titulo="Gastos" descripcion="Registra lo que se paga para operar el negocio." acciones={boton ?? undefined} />
        <PestanasGastos actual="/gastos" permisos={sesion.permisos} />
        <Tarjeta className="text-suave">Puedes registrar gastos; la lista la consulta quien tiene permiso de ver gastos.</Tarjeta>
      </>
    );
  }

  const estado = ESTADOS.some((e) => e.valor === f.estado) ? f.estado ?? "" : "";
  const desde = fechaValida(f.desde) || (f.desde === "" ? "" : inicioMesBogota());
  const hasta = fechaValida(f.hasta);
  const q = (f.q ?? "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 60);
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");

  const [{ data: categorias }, { data: fijos }] = await Promise.all([
    supabase.from("categorias_gasto").select("id, nombre").eq("tipo", "operativo").order("nombre"),
    registra ? supabase.from("gastos_recurrentes").select("id").eq("activo", true).limit(1) : Promise.resolve({ data: [] }),
  ]);
  const categoria = (categorias ?? []).some((c) => c.id === f.categoria) ? f.categoria : undefined;
  const punto = f.punto === "general" || puntos.some((p) => p.id === f.punto) ? f.punto : undefined;

  let consulta = supabase.from("gastos")
    .select("id, numero, fecha, descripcion, valor, estado, beneficiario, categorias_gasto(nombre), bodegas(nombre), proveedores(nombre)")
    .order("fecha", { ascending: false }).order("numero", { ascending: false }).limit(1000);
  if (estado) consulta = consulta.eq("estado", estado);
  if (categoria) consulta = consulta.eq("categoria_id", categoria);
  if (punto === "general") consulta = consulta.is("bodega_id", null);
  else if (punto) consulta = consulta.eq("bodega_id", punto);
  if (desde) consulta = consulta.gte("fecha", desde);
  if (hasta) consulta = consulta.lte("fecha", hasta);
  if (q) consulta = consulta.or(`descripcion.ilike.%${q}%,numero.ilike.%${q}%,beneficiario.ilike.%${q}%`);
  const { data } = await consulta;
  const gastos = (data ?? []) as unknown as Fila[];
  const vigentes = gastos.filter((g) => g.estado !== "anulado");
  const total = vigentes.reduce((s, g) => s + Number(g.valor), 0);
  const porPagar = gastos.filter((g) => g.estado === "pendiente").reduce((s, g) => s + Number(g.valor), 0);
  const parametros = (cambio: Record<string, string>) => {
    const p = new URLSearchParams({ ...(estado ? { estado } : {}), ...(categoria ? { categoria } : {}), ...(punto ? { punto } : {}),
      desde, ...(hasta ? { hasta } : {}), ...(q ? { q } : {}), ...cambio });
    for (const [k, v] of [...p.entries()]) if (v === "" && k !== "desde") p.delete(k);
    return `/gastos?${p}`;
  };

  return (
    <>
      <Encabezado titulo="Gastos" descripcion="Lo que se paga para operar el negocio. La mercancía se registra en Compras." acciones={<>
        {tiene(sesion, "informes.exportar") && (
          <a href={`/informes/exportar?tipo=gastos&desde=${desde || "2000-01-01"}&hasta=${hasta || hoyBogota()}${punto && punto !== "general" ? `&punto=${punto}` : ""}`}
             className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50">
            <Download className="size-4" aria-hidden /> Exportar (Excel)
          </a>
        )}
        {boton}
      </>} />
      <PestanasGastos actual="/gastos" permisos={sesion.permisos} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tarjeta className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-suave">Gastos del periodo</p>
          <p className="cifra font-titulo text-2xl font-semibold text-morado">{pesos(total)}</p>
          <p className="text-xs text-suave">{vigentes.length} gasto(s) sin contar anulados</p>
        </Tarjeta>
        <Tarjeta className={cn("flex flex-col gap-1", porPagar > 0 && "border-naranja")}>
          <p className="text-sm font-semibold text-suave">Por pagar</p>
          <p className="cifra font-titulo text-2xl font-semibold text-morado">{pesos(porPagar)}</p>
          <p className="text-xs text-suave">Cuentan en el resultado; aún no salen de caja</p>
        </Tarjeta>
        {registra && (fijos ?? []).length > 0 && (
          <Tarjeta className="col-span-2 flex flex-col justify-center gap-1 lg:col-span-1">
            <p className="text-sm font-semibold text-suave">Gastos fijos</p>
            <GenerarRecurrentes />
          </Tarjeta>
        )}
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto" role="group" aria-label="Filtrar por estado">
        {ESTADOS.map((e) => (
          <Link key={e.valor} href={parametros({ estado: e.valor })} aria-current={estado === e.valor ? "true" : undefined}
                className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold",
                              estado === e.valor ? "border-morado bg-morado text-white" : "border-borde bg-white text-suave hover:border-morado")}>
            {e.titulo}
          </Link>
        ))}
      </div>

      <form className="mb-4 grid gap-2 rounded-2xl border border-borde bg-white p-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto] lg:items-end">
        {estado && <input type="hidden" name="estado" value={estado} />}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Buscar
          <input type="search" name="q" defaultValue={q} placeholder="Descripción, número o a quién se pagó"
                 className="min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Categoría
          <select name="categoria" defaultValue={categoria ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
            <option value="">Todas</option>
            {(categorias ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Punto
          <select name="punto" defaultValue={punto ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
            <option value="">Todos</option>
            <option value="general">General del negocio</option>
            {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Desde
          <input type="date" name="desde" defaultValue={desde} max={hoyBogota()} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Hasta
          <input type="date" name="hasta" defaultValue={hasta} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Filtrar</button>
      </form>

      {gastos.length === 0 ? (
        <Tarjeta className="text-center text-suave">
          {desde && !hasta && !estado && !categoria && !punto && !q ? "No hay gastos registrados este mes." : "No hay gastos con esos filtros."}
        </Tarjeta>
      ) : (
        <ul className="flex flex-col gap-2">
          {gastos.map((g) => {
            const e = ESTADO_GASTO[g.estado] ?? { texto: g.estado, tono: "neutro" as const };
            return (
              <li key={g.id}>
                <Link href={`/gastos/${g.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-borde bg-white p-4 hover:border-morado">
                  <span className="font-semibold">{g.numero}</span>
                  <span className="text-sm text-suave">{fecha(`${g.fecha}T12:00:00`)} · {g.categorias_gasto?.nombre}</span>
                  <Insignia tono={e.tono}>{e.texto}</Insignia>
                  <span className={cn("ml-auto cifra text-lg font-semibold", g.estado === "anulado" ? "text-suave line-through" : "text-morado")}>{pesos(g.valor)}</span>
                  <span className="basis-full text-sm">
                    {g.descripcion}
                    <span className="text-suave"> · {g.bodegas?.nombre ?? "General"}{g.proveedores?.nombre || g.beneficiario ? ` · ${g.proveedores?.nombre ?? g.beneficiario}` : ""}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {gastos.length === 1000 && <p className="mt-3 text-sm text-suave">Se muestran los 1.000 más recientes del periodo. Acota las fechas para ver otros.</p>}
    </>
  );
}
