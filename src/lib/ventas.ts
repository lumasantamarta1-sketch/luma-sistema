// Estados, saldos y textos de ventas, compartidos por el servidor y el navegador

export type Tono = "neutro" | "exito" | "alerta" | "error" | "marca";

export function estadoVenta(v: { estado: string; estado_entrega: string }): { texto: string; tono: Tono } {
  if (v.estado === "cotizacion") return { texto: "Cotización", tono: "neutro" };
  if (v.estado === "cancelada") return { texto: "Anulada", tono: "error" };
  switch (v.estado_entrega) {
    case "entregada": return { texto: "Entregada", tono: "exito" };
    case "en_preparacion": return { texto: "Lista para entregar", tono: "marca" };
    case "por_estampar": return { texto: "Por estampar", tono: "alerta" };
    default: return { texto: "Pendiente de apartar", tono: "alerta" };
  }
}

export const ESTADO_LINEA: Record<string, string> = {
  pendiente: "Sin apartar",
  apartada: "Apartada",
  por_estampar: "Por estampar",
  entregada: "Entregada",
};

// Lo que se acaba de hacer (las acciones vuelven aquí con ?hecho=)
export const HECHOS: Record<string, string> = {
  confirmada: "Venta confirmada: las unidades disponibles quedaron apartadas.",
  pago: "Pago registrado.",
  reembolso: "Devolución de dinero registrada.",
  apartada: "Se apartó lo que ya había en el punto.",
  entregada: "Venta entregada: los productos salieron del inventario.",
  anulada: "Venta anulada. Lo que estaba apartado volvió a quedar disponible.",
  devolucion: "Devolución registrada.",
  descuento: "Descuento autorizado. Quien vende ya lo puede aplicar al editar la cotización.",
};

type PagoMin = { tipo: string; valor: number | string };

export function pagadoNeto(pagos: PagoMin[] | null | undefined) {
  return (pagos ?? []).reduce((s, p) => s + (p.tipo === "pago" ? 1 : -1) * Number(p.valor), 0);
}

// Igual que app.saldo_venta: lo que el cliente aún debe (negativo = saldo a su favor)
export function saldoVenta(v: {
  estado: string; total: number | string; pagos_venta?: PagoMin[] | null; devoluciones_venta?: { valor_total: number | string }[] | null;
}) {
  const total = v.estado === "cancelada" ? 0 : Number(v.total);
  const devuelto = (v.devoluciones_venta ?? []).reduce((s, d) => s + Number(d.valor_total), 0);
  return Math.round((total - devuelto - pagadoNeto(v.pagos_venta)) * 100) / 100;
}

export function numeroVenta(v: { numero: string | null; numero_cotizacion: string | null }) {
  return v.numero ?? v.numero_cotizacion ?? "";
}

// Clave única de una operación (evita registrarla dos veces si se reenvía). Solo en el navegador o el servidor, nunca en el render.
export function nuevaClave(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Fecha de hoy en Colombia como AAAA-MM-DD
export function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

export type DescuentoOpcion = {
  id: string; tipo: "promocion" | "puntual"; nombre: string;
  porcentaje: number | null; valor_por_unidad: number | null; valor_total: number | null;
  producto_id: string | null; variante_id: string | null; venta_id: string | null;
};

export function descuentoAplica(d: DescuentoOpcion, varianteId: string, productoId: string, ventaId: string | null) {
  return (d.tipo === "promocion" || (ventaId !== null && d.venta_id === ventaId))
    && (!d.variante_id || d.variante_id === varianteId)
    && (!d.producto_id || d.producto_id === productoId);
}

export function describirDescuento(d: Pick<DescuentoOpcion, "porcentaje" | "valor_por_unidad" | "valor_total">) {
  if (d.porcentaje !== null) return `${Number(d.porcentaje)} %`;
  if (d.valor_por_unidad !== null) return `$ ${Number(d.valor_por_unidad).toLocaleString("es-CO")} por unidad`;
  return `$ ${Number(d.valor_total ?? 0).toLocaleString("es-CO")} en total`;
}
