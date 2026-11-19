// Periodos de los informes, en fechas de Colombia (AAAA-MM-DD)
import { hoyBogota } from "@/lib/ventas";

export const PERIODOS = [
  { valor: "hoy", titulo: "Hoy" },
  { valor: "semana", titulo: "Esta semana" },
  { valor: "mes", titulo: "Este mes" },
  { valor: "mes_pasado", titulo: "Mes pasado" },
  { valor: "30d", titulo: "Últimos 30 días" },
  { valor: "ano", titulo: "Este año" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fechaUTC = (t: string) => new Date(`${t}T00:00:00Z`);
const valida = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(fechaUTC(t).getTime()) ? t : "");

export function resolverPeriodo(p: { periodo?: string; desde?: string; hasta?: string }) {
  const hoy = hoyBogota();
  const h = fechaUTC(hoy);
  const desdeP = valida(p.desde);
  const hastaP = valida(p.hasta);
  if (desdeP && hastaP && desdeP <= hastaP) return { clave: "personalizado", desde: desdeP, hasta: hastaP };
  switch (p.periodo) {
    case "hoy": return { clave: "hoy", desde: hoy, hasta: hoy };
    case "semana": {
      const d = new Date(h); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return { clave: "semana", desde: iso(d), hasta: hoy };
    }
    case "mes_pasado": {
      const ini = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 1));
      const fin = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 0));
      return { clave: "mes_pasado", desde: iso(ini), hasta: iso(fin) };
    }
    case "30d": {
      const d = new Date(h); d.setUTCDate(d.getUTCDate() - 29);
      return { clave: "30d", desde: iso(d), hasta: hoy };
    }
    case "ano": return { clave: "ano", desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
    default: return { clave: "mes", desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  }
}

// Todos los días entre dos fechas, para que la gráfica muestre también los días sin ventas
export function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  const d = fechaUTC(desde);
  const fin = fechaUTC(hasta);
  while (d <= fin && dias.length < 400) { dias.push(iso(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return dias;
}

// Fecha AAAA-MM-DD menos n días
export function restarDias(fecha: string, n: number) {
  const d = fechaUTC(fecha);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
}
