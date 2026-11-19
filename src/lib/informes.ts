// Tipos de los informes que devuelve la base de datos
export type InformeVentas = {
  periodo: { desde: string; hasta: string; bodega_id: string | null };
  con_costos: boolean;
  totales: { ventas: number; unidades: number; bruto: number; descuentos: number; valor: number; costo: number | null; devoluciones: number };
  por_dia: { fecha: string; ventas: number; valor: number }[];
  por_producto: { producto: string; sku: string; detalle: string; unidades: number; valor: number; costo: number | null; utilidad: number | null }[];
  por_vendedor: { vendedor: string; ventas: number; valor: number }[];
  por_punto: { punto: string; ventas: number; valor: number }[];
  por_cliente: { cliente: string; ventas: number; valor: number }[];
  recibido_por_metodo: { metodo: string; valor: number }[];
};

// Mes a mes (serie_mensual). Los campos llegan vacíos si quien consulta no tiene el permiso.
export type SerieMes = {
  mes: string; ventas: number; ventas_netas: number; costo: number | null; utilidad_bruta: number | null;
  gastos: number | null; resultado: number | null; inventario_valor: number | null; inventario_unidades: number | null;
};

export type CuentasPendientes = {
  por_cobrar: null | {
    venta_id: string; numero: string; fecha: string; cliente_id: string | null; cliente: string; telefono: string | null;
    punto: string; total: number; saldo: number; entregada: boolean; dias: number;
  }[];
  por_pagar: null | { compra_id: string; numero: string; fecha: string; proveedor: string; total: number; saldo: number; dias: number }[];
  gastos_por_pagar: null | {
    gasto_id: string; numero: string; fecha: string; descripcion: string; categoria: string; proveedor: string | null; valor: number; dias: number;
  }[];
};

export type InformeComprasGastos = {
  periodo: { desde: string; hasta: string; anterior_desde: string; anterior_hasta: string };
  compras: { cantidad: number; total: number; saldo: number; anterior: number };
  compras_por_proveedor: { proveedor: string; compras: number; valor: number; saldo: number; anterior: number }[];
  gastos: { cantidad: number; total: number; pendiente: number; anterior: number };
  gastos_por_categoria: { categoria: string; tipo: string; valor: number; anterior: number }[];
  gastos_por_proveedor: { proveedor: string; gastos: number; valor: number }[];
  gastos_por_usuario: { usuario: string; gastos: number; valor: number }[];
};

export type ResumenFinanciero = {
  calculado: {
    ventas_brutas: number; descuentos: number; impuestos: number; devoluciones: number; ventas_netas: number;
    costo_mercancia_vendida: number; utilidad_bruta: number; margen_bruto: number | null; gastos_registrados: number;
    perdidas_inventario: number; gastos_operativos: number; resultado_operativo: number; compras_recibidas: number;
  };
  dinero_real: { entradas: number; salidas: number; flujo_de_caja: number; aportes: number; retiros: number };
  saldos: {
    cuentas_por_cobrar: number; anticipos_de_clientes: number; cuentas_por_pagar: number; compras_por_pagar: number; gastos_por_pagar: number;
    valor_inventario: { total: number; terminado: number; base: number; material: number };
  };
};

// Pestañas de Informes según permisos
export function pestanasInformes(permisos: string[]) {
  const p = (...c: string[]) => c.some((x) => permisos.includes(x));
  return [
    { ruta: "/informes", titulo: "Ventas", ver: p("informes.ver") },
    { ruta: "/informes/cuentas", titulo: "Clientes y cuentas", ver: p("informes.ver", "informes.financieros") },
    { ruta: "/informes/resultado", titulo: "Resultado y dinero", ver: p("informes.financieros") },
    { ruta: "/informes/compras-gastos", titulo: "Compras y gastos", ver: p("informes.financieros") },
    { ruta: "/informes/inventario", titulo: "Inventario", ver: p("informes.inventario") },
  ];
}

// Fecha corta para las gráficas: 18/11
export function diaCorto(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// Nombre corto del mes para las gráficas: «nov 26»
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function mesCorto(aaaamm: string) {
  return `${MESES[Number(aaaamm.slice(5, 7)) - 1] ?? aaaamm} ${aaaamm.slice(2, 4)}`;
}

// Diferencia contra el periodo anterior, en texto: «+12 %», «−5 %» o «nuevo»
export function variacion(actual: number, anterior: number) {
  if (!anterior) return actual ? "nuevo" : "—";
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)} %`;
}
