// Estados, saldos y textos de compras, compartidos por el servidor y el navegador
import type { Tono } from "@/lib/ventas";

export const ESTADO_COMPRA: Record<string, { texto: string; tono: Tono }> = {
  borrador: { texto: "Borrador", tono: "neutro" },
  confirmada: { texto: "Por recibir", tono: "alerta" },
  recibida_parcial: { texto: "Recibida en parte", tono: "marca" },
  recibida: { texto: "Recibida", tono: "exito" },
  anulada: { texto: "Anulada", tono: "error" },
};

export const HECHOS_COMPRA: Record<string, string> = {
  guardada: "Compra guardada como borrador.",
  confirmada: "Compra confirmada: queda por recibir.",
  recibida: "Mercancía recibida: entró al inventario con su costo.",
  pago: "Pago al proveedor registrado.",
  reembolso: "Reembolso del proveedor registrado.",
  anulada: "Compra anulada.",
  devolucion: "Devolución al proveedor registrada: la mercancía salió del inventario.",
};

type PagoMin = { tipo: string; valor: number | string };

// Igual que app.saldo_compra: lo que se le debe al proveedor (negativo = saldo a favor de LUMA)
export function saldoCompra(c: {
  estado: string; total: number | string; pagos_compra?: PagoMin[] | null; devoluciones_proveedor?: { valor_total: number | string }[] | null;
}) {
  const total = c.estado === "anulada" ? 0 : Number(c.total);
  const devuelto = (c.devoluciones_proveedor ?? []).reduce((s, d) => s + Number(d.valor_total), 0);
  const pagado = (c.pagos_compra ?? []).reduce((s, p) => s + (p.tipo === "pago" ? 1 : -1) * Number(p.valor), 0);
  return Math.round((total - devuelto - pagado) * 100) / 100;
}
