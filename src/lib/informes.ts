// Tipos de los informes que devuelve la base de datos
export type InformeVentas = {
  periodo: { desde: string; hasta: string; bodega_id: string | null };
  con_costos: boolean;
  totales: { ventas: number; unidades: number; bruto: number; descuentos: number; valor: number; costo: number | null; devoluciones: number };
  por_dia: { fecha: string; ventas: number; valor: number }[];
  por_producto: { producto: string; sku: string; detalle: string; unidades: number; valor: number; costo: number | null; utilidad: number | null }[];
  por_vendedor: { vendedor: string; ventas: number; valor: number }[];
  por_punto: { punto: string; ventas: number; valor: number }[];
  recibido_por_metodo: { metodo: string; valor: number }[];
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
    { ruta: "/informes/resultado", titulo: "Resultado y dinero", ver: p("informes.financieros") },
    { ruta: "/informes/inventario", titulo: "Inventario", ver: p("informes.inventario") },
  ];
}

// Fecha corta para las gráficas: 18/11
export function diaCorto(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
