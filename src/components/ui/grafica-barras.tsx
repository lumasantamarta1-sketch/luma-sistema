import { pesos } from "@/lib/utilidades";

type Dato = { etiqueta: string; valor: number; detalle?: string };

// Gráfica de barras en SVG, sin JavaScript. Lleva una tabla oculta para lectores de pantalla.
export function GraficaBarras({ datos, titulo, formato = "pesos", alto = 180 }: {
  datos: Dato[]; titulo: string; formato?: "pesos" | "numero"; alto?: number;
}) {
  const ancho = 640;
  const margenIzq = 8;
  const base = alto - 24;
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  const paso = datos.length ? (ancho - margenIzq) / datos.length : 0;
  const barra = Math.max(2, Math.min(36, paso * 0.7));
  const fmt = (v: number) => (formato === "pesos" ? pesos(v) : new Intl.NumberFormat("es-CO").format(v));
  // Se rotulan pocas fechas para que no se encimen
  const cada = Math.max(1, Math.ceil(datos.length / 8));

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{titulo}</figcaption>
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-auto w-full" role="img" aria-label={titulo}>
        <line x1={margenIzq} x2={ancho} y1={base} y2={base} className="stroke-borde" strokeWidth={1} />
        {datos.map((d, i) => {
          const h = d.valor > 0 ? Math.max(2, (d.valor / maximo) * (base - 16)) : 0;
          const x = margenIzq + i * paso + (paso - barra) / 2;
          return (
            <g key={`${d.etiqueta}-${i}`}>
              <rect x={x} y={base - h} width={barra} height={h} rx={3} className="fill-morado">
                <title>{`${d.etiqueta}: ${fmt(d.valor)}${d.detalle ? ` · ${d.detalle}` : ""}`}</title>
              </rect>
              {i % cada === 0 && (
                <text x={x + barra / 2} y={alto - 6} textAnchor="middle" className="fill-suave" fontSize={11}>{d.etiqueta}</text>
              )}
            </g>
          );
        })}
        <text x={ancho} y={12} textAnchor="end" className="fill-suave" fontSize={11}>máx. {fmt(maximo)}</text>
      </svg>
      <table className="sr-only">
        <caption>{titulo}</caption>
        <tbody>{datos.map((d, i) => <tr key={i}><th scope="row">{d.etiqueta}</th><td>{fmt(d.valor)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

// Barras horizontales para rankings (productos, vendedores, categorías)
export function BarrasHorizontales({ datos, formato = "pesos" }: { datos: Dato[]; formato?: "pesos" | "numero" }) {
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  const fmt = (v: number) => (formato === "pesos" ? pesos(v) : new Intl.NumberFormat("es-CO").format(v));
  return (
    <ul className="flex flex-col gap-2">
      {datos.map((d, i) => (
        <li key={`${d.etiqueta}-${i}`} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{d.etiqueta}{d.detalle ? <span className="text-suave"> · {d.detalle}</span> : null}</span>
            <span className="cifra shrink-0 font-semibold">{fmt(d.valor)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-morado-50">
            <div className="h-2 rounded-full bg-morado" style={{ width: `${Math.max(1, (d.valor / maximo) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Columnas por periodo que admiten valores negativos (resultado, utilidad): lo negativo va bajo la línea del cero
export function GraficaColumnas({ datos, titulo, formato = "pesos", alto = 200 }: {
  datos: Dato[]; titulo: string; formato?: "pesos" | "numero"; alto?: number;
}) {
  const ancho = 640;
  const arriba = 18;
  const abajo = alto - 24;
  const maximo = Math.max(0, ...datos.map((d) => d.valor));
  const minimo = Math.min(0, ...datos.map((d) => d.valor));
  const rango = Math.max(1, maximo - minimo);
  const y = (v: number) => arriba + ((maximo - v) / rango) * (abajo - arriba);
  const cero = y(0);
  const paso = datos.length ? ancho / datos.length : 0;
  const barra = Math.max(4, Math.min(40, paso * 0.6));
  const fmt = (v: number) => (formato === "pesos" ? pesos(v) : new Intl.NumberFormat("es-CO").format(v));
  const cada = Math.max(1, Math.ceil(datos.length / 12));
  return (
    <figure className="w-full">
      <figcaption className="sr-only">{titulo}</figcaption>
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-auto w-full" role="img" aria-label={titulo}>
        <line x1={0} x2={ancho} y1={cero} y2={cero} className="stroke-borde" strokeWidth={1} />
        {datos.map((d, i) => {
          const tope = y(d.valor);
          const h = d.valor === 0 ? 0 : Math.max(2, Math.abs(tope - cero));
          const x = i * paso + (paso - barra) / 2;
          return (
            <g key={`${d.etiqueta}-${i}`}>
              <rect x={x} y={d.valor >= 0 ? cero - h : cero} width={barra} height={h} rx={3}
                    className={d.valor < 0 ? "fill-rosa" : "fill-morado"}>
                <title>{`${d.etiqueta}: ${fmt(d.valor)}${d.detalle ? ` · ${d.detalle}` : ""}`}</title>
              </rect>
              {i % cada === 0 && (
                <text x={x + barra / 2} y={alto - 6} textAnchor="middle" className="fill-suave" fontSize={11}>{d.etiqueta}</text>
              )}
            </g>
          );
        })}
        <text x={ancho} y={12} textAnchor="end" className="fill-suave" fontSize={11}>
          máx. {fmt(maximo)}{minimo < 0 ? ` · mín. ${fmt(minimo)}` : ""}
        </text>
      </svg>
      <table className="sr-only">
        <caption>{titulo}</caption>
        <tbody>{datos.map((d, i) => <tr key={i}><th scope="row">{d.etiqueta}</th><td>{fmt(d.valor)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
