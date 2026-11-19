import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ESTADO_GASTO, FRECUENCIAS, HECHOS_GASTO } from "@/lib/gastos";
import { fecha, pesos } from "@/lib/utilidades";
import { Aviso } from "@/components/ui/aviso";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { AnularGasto, PagarGasto } from "../formularios";
import { SubirAdjunto } from "@/components/app/adjuntos";
import { obtenerAdjuntos } from "@/lib/adjuntos";

export const metadata: Metadata = { title: "Gasto" };

type Gasto = {
  id: string; numero: string; fecha: string; descripcion: string; valor: number; estado: string; beneficiario: string | null;
  bodega_id: string | null; pagado_en: string | null; periodo: string | null; registrado_por: string | null; registrado_en: string;
  anulado_por: string | null; anulado_en: string | null; motivo_anulacion: string | null;
  categorias_gasto: { nombre: string } | null; bodegas: { nombre: string } | null; proveedores: { nombre: string } | null;
  metodos_pago: { nombre: string } | null; cuentas_dinero: { nombre: string } | null;
  gastos_recurrentes: { nombre: string; frecuencia: string } | null;
};

const enlace = "inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50";

export default async function DetalleGasto({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ hecho?: string }>;
}) {
  const [{ id }, { hecho }] = await Promise.all([params, searchParams]);
  const sesion = await exigirPermiso("gastos.ver");
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("gastos")
    .select(`id, numero, fecha, descripcion, valor, estado, beneficiario, bodega_id, pagado_en, periodo, registrado_por, registrado_en,
      anulado_por, anulado_en, motivo_anulacion, categorias_gasto(nombre), bodegas(nombre), proveedores(nombre),
      metodos_pago(nombre), cuentas_dinero(nombre), gastos_recurrentes(nombre, frecuencia)`)
    .eq("id", id).maybeSingle();
  if (!data) notFound();
  const g = data as unknown as Gasto;

  const [soportes, { data: nombres }, { data: metodos }] = await Promise.all([
    obtenerAdjuntos(supabase, "gasto", id),
    supabase.rpc("usuarios_nombres"),
    g.estado === "pendiente" && tiene(sesion, "gastos.pagar")
      ? supabase.from("metodos_pago").select("id, nombre, tipo").eq("activo", true).order("nombre")
      : Promise.resolve({ data: [] }),
  ]);
  const nombre = (uid: string | null) => (nombres as { id: string; nombre: string }[] | null)?.find((n) => n.id === uid)?.nombre ?? "";
  const e = ESTADO_GASTO[g.estado] ?? { texto: g.estado, tono: "neutro" as const };

  return (
    <>
      <Encabezado titulo={`Gasto ${g.numero}`} descripcion={`${g.categorias_gasto?.nombre ?? ""} · ${fecha(`${g.fecha}T12:00:00`)}`}
                  acciones={<Link href="/gastos" className={enlace}>Volver</Link>} />
      {hecho && HECHOS_GASTO[hecho] && <div className="mb-4"><Aviso tipo="exito">{HECHOS_GASTO[hecho]}</Aviso></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-lg font-semibold text-morado">{g.descripcion}</h2>
              <Insignia tono={e.tono}>{e.texto}</Insignia>
            </div>
            <p className={`cifra font-titulo text-3xl font-semibold ${g.estado === "anulado" ? "text-suave line-through" : "text-morado"}`}>{pesos(g.valor)}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-suave">Punto de venta</dt><dd>{g.bodegas?.nombre ?? "General del negocio"}</dd></div>
              {(g.proveedores?.nombre || g.beneficiario) && (
                <div><dt className="text-suave">Se le pagó a</dt><dd>{[g.proveedores?.nombre, g.beneficiario].filter(Boolean).join(" · ")}</dd></div>
              )}
              {g.estado === "pagado" && (
                <div><dt className="text-suave">Pagado</dt><dd>{fecha(g.pagado_en)} · {g.metodos_pago?.nombre}{g.cuentas_dinero ? ` (${g.cuentas_dinero.nombre})` : ""}</dd></div>
              )}
              {g.gastos_recurrentes && (
                <div><dt className="text-suave">Gasto fijo</dt><dd>{g.gastos_recurrentes.nombre} · {FRECUENCIAS[g.gastos_recurrentes.frecuencia] ?? ""}{g.periodo ? ` · periodo ${g.periodo}` : ""}</dd></div>
              )}
              <div><dt className="text-suave">Registrado</dt><dd>{fecha(g.registrado_en)}{nombre(g.registrado_por) ? ` por ${nombre(g.registrado_por)}` : ""}</dd></div>
            </dl>
            {g.estado === "anulado" && (
              <p className="mt-3 rounded-xl bg-error/5 p-3 text-sm text-error">
                Anulado el {fecha(g.anulado_en)}{nombre(g.anulado_por) ? ` por ${nombre(g.anulado_por)}` : ""}{g.motivo_anulacion ? `: ${g.motivo_anulacion}` : ""}
              </p>
            )}
          </Tarjeta>

          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Soportes</h2>
            {soportes.length === 0 && <p className="mb-3 text-sm text-suave">Aún no hay factura ni recibo adjunto.</p>}
            <ul className="mb-3 flex flex-col gap-2">
              {soportes.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-suave" aria-hidden />
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-morado underline">{s.nombre}</a>
                    : <span>{s.nombre}</span>}
                  <span className="text-suave">· {fecha(s.subido_en)}</span>
                </li>
              ))}
            </ul>
            {g.estado !== "anulado" && tiene(sesion, "gastos.registrar") && (
              <SubirAdjunto tipo="gasto" documentoId={g.id} ayuda="Factura, recibo o comprobante. Queda privado: solo lo ven quienes pueden ver este gasto." />
            )}
          </Tarjeta>
        </div>

        <div className="flex flex-col gap-4">
          {g.estado === "pendiente" && tiene(sesion, "gastos.pagar") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Pagar</h2>
              <PagarGasto gastoId={g.id} metodos={(metodos ?? []) as { id: string; nombre: string; tipo: string }[]} sinPunto={!g.bodega_id} />
            </Tarjeta>
          )}
          {g.estado !== "anulado" && tiene(sesion, "gastos.anular") && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold text-morado">Anular</h2>
              <AnularGasto gastoId={g.id} pagado={g.estado === "pagado"} />
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}
