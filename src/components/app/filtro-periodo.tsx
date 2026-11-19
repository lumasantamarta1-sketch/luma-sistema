import Link from "next/link";
import { PERIODOS } from "@/lib/periodos";
import { cn } from "@/lib/utilidades";

// Periodo y punto de un informe: atajos como enlaces y fechas libres con un formulario GET
export function FiltroPeriodo({ ruta, clave, desde, hasta, punto, puntos, compacto }: {
  ruta: string; clave: string; desde: string; hasta: string; punto?: string; puntos?: { id: string; nombre: string }[];
  compacto?: boolean; // las fechas libres quedan plegadas
}) {
  const enlace = (periodo: string) => `${ruta}?periodo=${periodo}${punto ? `&punto=${punto}` : ""}`;
  return (
    <div className="mb-4 flex flex-col gap-3 print:hidden">
      <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Periodo">
        {PERIODOS.map((p) => (
          <Link key={p.valor} href={enlace(p.valor)} aria-current={clave === p.valor ? "true" : undefined}
                className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold",
                              clave === p.valor ? "border-morado bg-morado text-white" : "border-borde bg-white text-suave hover:border-morado")}>
            {p.titulo}
          </Link>
        ))}
      </div>
      {compacto ? (
        <details className={cn("rounded-2xl", clave === "personalizado" && "border border-borde bg-white p-3")} open={clave === "personalizado"}>
          <summary className="cursor-pointer text-sm font-semibold text-morado">Elegir fechas</summary>
          <div className="mt-2"><FormularioFechas ruta={ruta} desde={desde} hasta={hasta} punto={punto} puntos={puntos} /></div>
        </details>
      ) : <FormularioFechas ruta={ruta} desde={desde} hasta={hasta} punto={punto} puntos={puntos} />}
    </div>
  );
}

function FormularioFechas({ ruta, desde, hasta, punto, puntos }: {
  ruta: string; desde: string; hasta: string; punto?: string; puntos?: { id: string; nombre: string }[];
}) {
  return (
      <form action={ruta} className="grid gap-2 rounded-2xl border border-borde bg-white p-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Desde
          <input type="date" name="desde" defaultValue={desde} required className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Hasta
          <input type="date" name="hasta" defaultValue={hasta} required className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal" />
        </label>
        {puntos && puntos.length > 1 ? (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Punto
            <select name="punto" defaultValue={punto ?? ""} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
              <option value="">Todos</option>
              {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        ) : <span />}
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Ver</button>
      </form>
  );
}
