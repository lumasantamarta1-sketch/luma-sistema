// Textos y estados de gastos, compartidos por el servidor y el navegador
import type { Tono } from "@/lib/ventas";

export const ESTADO_GASTO: Record<string, { texto: string; tono: Tono }> = {
  pendiente: { texto: "Por pagar", tono: "alerta" },
  pagado: { texto: "Pagado", tono: "exito" },
  anulado: { texto: "Anulado", tono: "error" },
};

export const FRECUENCIAS: Record<string, string> = {
  mensual: "Cada mes",
  quincenal: "Cada quincena",
  semanal: "Cada semana",
};

// Lo que se acaba de hacer (las acciones vuelven al detalle con ?hecho=)
export const HECHOS_GASTO: Record<string, string> = {
  registrado: "Gasto registrado.",
  pagado: "Gasto pagado: el dinero salió de la cuenta elegida.",
  anulado: "Gasto anulado. Si estaba pagado, el dinero volvió a su cuenta.",
  soporte: "Soporte adjuntado.",
};

// Primer día del mes en curso (Colombia) como AAAA-MM-DD
export function inicioMesBogota() {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  return `${hoy.slice(0, 8)}01`;
}
