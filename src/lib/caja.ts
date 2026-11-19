// Textos del libro de caja, compartidos por el servidor y el navegador

export const ORIGENES: Record<string, string> = {
  cobro_venta: "Cobro de venta",
  reembolso_cliente: "Devolución de dinero a un cliente",
  pago_compra: "Pago a proveedor",
  reembolso_proveedor: "Reembolso de proveedor",
  pago_gasto: "Pago de gasto",
  traslado: "Traslado entre cuentas",
  aporte: "Aporte de dinero",
  retiro: "Retiro de dinero",
  ajuste_cierre: "Diferencia de cierre",
  saldo_inicial: "Saldo inicial",
  anulacion: "Anulación",
};

export const TIPOS_CUENTA: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  banco: "Banco",
  otro: "Otra",
};

export const TIPOS_MOVIMIENTO = [
  { valor: "aporte", titulo: "Aporte de dinero", ayuda: "Entra dinero que no viene de una venta (por ejemplo, base para la caja)." },
  { valor: "retiro", titulo: "Retiro de dinero", ayuda: "Sale dinero que no es un gasto (por ejemplo, el dueño lo retira)." },
  { valor: "traslado", titulo: "Traslado entre cuentas", ayuda: "Pasa dinero de una cuenta a otra, como consignar el efectivo en el banco." },
  { valor: "saldo_inicial", titulo: "Saldo inicial", ayuda: "Solo para una cuenta nueva sin movimientos: lo que ya tenía." },
];

export const HECHOS_CAJA: Record<string, string> = {
  movimiento: "Movimiento registrado.",
  cierre: "Cierre de caja registrado.",
};
