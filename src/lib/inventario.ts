export const TIPOS_MOVIMIENTO: Record<string, string> = {
  saldo_inicial: "Saldo inicial",
  entrada_compra: "Compra recibida",
  devolucion_proveedor: "Devolución a proveedor",
  consumo_estampado: "Consumo en estampado",
  entrada_estampado: "Estampado",
  perdida_estampado: "Dañada al estampar",
  salida_venta: "Venta entregada",
  devolucion_cliente: "Devolución de cliente",
  perdida_devolucion: "Devuelta dañada",
  ajuste_entrada: "Ajuste: sobrante",
  ajuste_salida: "Ajuste: faltante",
  perdida: "Pérdida o daño",
  traslado_salida: "Traslado: sale",
  traslado_entrada: "Traslado: entra",
  reverso_consumo: "Anulación de estampado",
  reverso_perdida: "Anulación de estampado",
  reverso_entrada: "Anulación de estampado",
};

export const TIPOS_AJUSTE: Record<string, string> = {
  saldo_inicial: "Saldo inicial",
  ajuste: "Ajuste por conteo",
  perdida: "Pérdida o daño",
};

export function numero(valor: number | string | null | undefined) {
  return Number(valor ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 3 });
}

export const ESTADOS_ORDEN: Record<string, { texto: string; tono: "alerta" | "exito" | "error" }> = {
  borrador: { texto: "Por estampar", tono: "alerta" },
  terminada: { texto: "Terminada", tono: "exito" },
  anulada: { texto: "Anulada", tono: "error" },
};
