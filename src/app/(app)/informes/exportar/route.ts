import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerSesion, tiene, type Sesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { resolverPeriodo } from "@/lib/periodos";
import type { CuentasPendientes, InformeComprasGastos, InformeVentas, ResumenFinanciero, SerieMes } from "@/lib/informes";
import { numeroVenta, pagadoNeto, saldoVenta } from "@/lib/ventas";
import { saldoCompra, ESTADO_COMPRA } from "@/lib/compras";
import { ORIGENES } from "@/lib/caja";
import { TIPOS_MOVIMIENTO } from "@/lib/inventario";
import { descarga, dia, fechaHora, formatoPedido, todasLasFilas, type Hoja } from "@/lib/exportar";

// Descargas de informes en CSV (Excel en español) o Excel (.xlsx). Cada informe exige su permiso,
// además de informes.exportar, y lee los datos con la sesión de quien descarga (RLS).

const n = (v: unknown) => Number(v ?? 0);
const desdeTs = (d: string) => `${d}T00:00:00-05:00`;
const hastaTs = (d: string) => `${d}T23:59:59.999-05:00`;
const ESTADOS_GASTO: Record<string, string> = { pendiente: "Por pagar", pagado: "Pagado", anulado: "Anulado" };
const ACCIONES: Record<string, string> = { insertar: "Creó", actualizar: "Modificó", eliminar: "Eliminó", ingreso: "Ingresó", salida: "Salió" };

type Contexto = {
  sesion: Sesion; supabase: SupabaseClient; p: URLSearchParams;
  periodo: { desde: string; hasta: string }; punto: string | null;
};
type Resultado = { nombre: string; hojas: Hoja[] } | null;

async function rpc<T>(supabase: SupabaseClient, nombre: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error || data === null) throw new Error(error?.message ?? "Sin datos");
  return data as T;
}

const INFORMES: Record<string, (c: Contexto) => Promise<Resultado>> = {
  // Ventas por producto (y en Excel también por día, vendedor, punto, cliente y medio de pago)
  async ventas({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "informes.ver")) return null;
    const inf = await rpc<InformeVentas>(supabase, "informe_ventas", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto });
    const costos = inf.con_costos;
    return {
      nombre: `ventas-por-producto_${periodo.desde}_${periodo.hasta}`,
      hojas: [
        { nombre: "Por producto", filas: [
          ["Producto", "SKU", "Detalle", "Unidades", "Vendido", ...(costos ? ["Costo", "Utilidad bruta"] : [])],
          ...inf.por_producto.map((x) => [x.producto, x.sku, x.detalle, n(x.unidades), n(x.valor), ...(costos ? [n(x.costo), n(x.utilidad)] : [])]),
        ] },
        { nombre: "Por día", filas: [["Fecha", "Ventas", "Valor"], ...inf.por_dia.map((d) => [d.fecha, n(d.ventas), n(d.valor)])] },
        { nombre: "Por vendedor", filas: [["Vendedor", "Ventas", "Valor"], ...inf.por_vendedor.map((d) => [d.vendedor, n(d.ventas), n(d.valor)])] },
        { nombre: "Por punto", filas: [["Punto", "Ventas", "Valor"], ...inf.por_punto.map((d) => [d.punto, n(d.ventas), n(d.valor)])] },
        { nombre: "Por cliente", filas: [["Cliente", "Ventas", "Valor"], ...(inf.por_cliente ?? []).map((d) => [d.cliente, n(d.ventas), n(d.valor)])] },
        { nombre: "Medios de pago", filas: [["Medio", "Recibido"], ...inf.recibido_por_metodo.map((d) => [d.metodo, n(d.valor)])] },
      ],
    };
  },

  // Lista de ventas confirmadas del periodo
  async ventas_lista({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "informes.ver", "ventas.ver")) return null;
    type V = { numero: string | null; numero_cotizacion: string | null; estado: string; estado_entrega: string; total: number; confirmada_en: string;
      entregada_en: string | null; bodegas: { nombre: string } | null; clientes: { nombre: string; documento: string | null } | null;
      perfiles: { nombre: string } | null; pagos_venta: { tipo: string; valor: number }[]; devoluciones_venta: { valor_total: number }[] };
    const datos = await todasLasFilas<V>((a, b) => {
      let q = supabase.from("ventas")
        .select("numero, numero_cotizacion, estado, estado_entrega, total, confirmada_en, entregada_en, bodegas(nombre), clientes(nombre, documento), perfiles(nombre), pagos_venta(tipo, valor), devoluciones_venta(valor_total)")
        .eq("estado", "confirmada").gte("confirmada_en", desdeTs(periodo.desde)).lte("confirmada_en", hastaTs(periodo.hasta))
        .order("confirmada_en").order("id");
      if (punto) q = q.eq("bodega_id", punto);
      return q.range(a, b) as unknown as PromiseLike<{ data: V[] | null; error: { message: string } | null }>;
    });
    return {
      nombre: `ventas_${periodo.desde}_${periodo.hasta}`,
      hojas: [{ nombre: "Ventas", filas: [
        ["Número", "Confirmada", "Entregada", "Punto", "Cliente", "Documento", "Vendedor", "Total", "Pagado", "Saldo"],
        ...datos.map((v) => [numeroVenta(v), dia(v.confirmada_en), dia(v.entregada_en), v.bodegas?.nombre, v.clientes?.nombre ?? "Cliente mostrador",
          v.clientes?.documento, v.perfiles?.nombre, n(v.total), pagadoNeto(v.pagos_venta), saldoVenta(v)]),
      ] }],
    };
  },

  // Ventas por cliente
  async clientes({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "informes.ver")) return null;
    const inf = await rpc<InformeVentas>(supabase, "informe_ventas", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto });
    return {
      nombre: `ventas-por-cliente_${periodo.desde}_${periodo.hasta}`,
      hojas: [{ nombre: "Ventas por cliente", filas: [["Cliente", "Ventas", "Valor"], ...(inf.por_cliente ?? []).map((d) => [d.cliente, n(d.ventas), n(d.valor)])] }],
    };
  },

  // Existencias de hoy (y en Excel, las alertas de agotados y bajo mínimo)
  async inventario({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "informes.inventario")) return null;
    const veCostos = tiene(sesion, "costos.ver");
    type E = { variante_id: string; bodega: string; sku: string; producto: string; clase: string; unidad_medida: string;
      talla: string | null; color: string | null; diseno: string | null; cantidad: number; disponible: number };
    const [datos, costos, alertas] = await Promise.all([
      todasLasFilas<E>((a, b) => {
        let q = supabase.from("existencias_detalle")
          .select("variante_id, bodega, sku, producto, clase, unidad_medida, talla, color, diseno, cantidad, disponible")
          .neq("cantidad", 0).order("producto").order("sku").order("bodega");
        if (punto) q = q.eq("bodega_id", punto);
        return q.range(a, b) as unknown as PromiseLike<{ data: E[] | null; error: { message: string } | null }>;
      }),
      veCostos
        ? todasLasFilas<{ variante_id: string; costo_promedio: number }>((a, b) =>
            supabase.from("variante_costos").select("variante_id, costo_promedio").order("variante_id").range(a, b) as unknown as
              PromiseLike<{ data: { variante_id: string; costo_promedio: number }[] | null; error: { message: string } | null }>)
        : Promise.resolve([]),
      rpc<Alerta[]>(supabase, "alertas_inventario"),
    ]);
    const costo = new Map(costos.map((c) => [c.variante_id, n(c.costo_promedio)]));
    return {
      nombre: `inventario_${periodo.hasta}`,
      hojas: [
        { nombre: "Existencias", filas: [
          ["Producto", "SKU", "Diseño", "Talla", "Color", "Punto", "Unidad", "Cantidad", "Disponible", ...(veCostos ? ["Costo promedio", "Valor"] : [])],
          ...datos.map((e) => [e.producto, e.sku, e.diseno, e.talla, e.color, e.bodega, e.unidad_medida, n(e.cantidad), n(e.disponible),
            ...(veCostos ? [costo.get(e.variante_id) ?? 0, n(e.cantidad) * (costo.get(e.variante_id) ?? 0)] : [])]),
        ] },
        hojaAlertas(alertas),
      ],
    };
  },

  // Productos agotados y con pocas existencias
  async alertas({ sesion, supabase, periodo }) {
    if (!tiene(sesion, "informes.inventario", "inventario.ver")) return null;
    return { nombre: `agotados-y-stock-bajo_${periodo.hasta}`, hojas: [hojaAlertas(await rpc<Alerta[]>(supabase, "alertas_inventario"))] };
  },

  // Kardex: todos los movimientos de inventario del periodo
  async kardex({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "inventario.kardex") || !tiene(sesion, "costos.ver")) return null;
    type M = { ocurrido_en: string; tipo: string; cantidad: number; costo_unitario: number; saldo_resultante: number;
      costo_promedio_resultante: number; motivo: string | null; documento_tipo: string;
      variantes: { sku: string; productos: { nombre: string } | null } | null; bodegas: { nombre: string } | null };
    const datos = await todasLasFilas<M>((a, b) => {
      let q = supabase.from("movimientos_inventario")
        .select("ocurrido_en, tipo, cantidad, costo_unitario, saldo_resultante, costo_promedio_resultante, motivo, documento_tipo, variantes(sku, productos(nombre)), bodegas(nombre)")
        .gte("ocurrido_en", desdeTs(periodo.desde)).lte("ocurrido_en", hastaTs(periodo.hasta)).order("ocurrido_en").order("id");
      if (punto) q = q.eq("bodega_id", punto);
      return q.range(a, b) as unknown as PromiseLike<{ data: M[] | null; error: { message: string } | null }>;
    });
    return {
      nombre: `kardex_${periodo.desde}_${periodo.hasta}`,
      hojas: [{ nombre: "Kardex", filas: [
        ["Fecha", "Movimiento", "Producto", "SKU", "Punto", "Cantidad", "Costo unitario", "Saldo después", "Costo promedio después", "Documento", "Motivo"],
        ...datos.map((m) => [fechaHora(m.ocurrido_en), TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo, m.variantes?.productos?.nombre, m.variantes?.sku,
          m.bodegas?.nombre, n(m.cantidad), n(m.costo_unitario), n(m.saldo_resultante), n(m.costo_promedio_resultante), m.documento_tipo, m.motivo]),
      ] }],
    };
  },

  // Gastos del periodo
  async gastos({ sesion, supabase, periodo, punto, p }) {
    if (!tiene(sesion, "gastos.ver")) return null;
    const id = (k: string) => (/^[0-9a-f-]{36}$/.test(p.get(k) ?? "") ? p.get(k)! : "");
    const estado = ESTADOS_GASTO[p.get("estado") ?? ""] ? p.get("estado")! : "";
    type G = { numero: string; fecha: string; descripcion: string; valor: number; estado: string; beneficiario: string | null; pagado_en: string | null;
      categorias_gasto: { nombre: string } | null; bodegas: { nombre: string } | null; proveedores: { nombre: string } | null; metodos_pago: { nombre: string } | null };
    const datos = await todasLasFilas<G>((a, b) => {
      let q = supabase.from("gastos")
        .select("numero, fecha, descripcion, valor, estado, beneficiario, pagado_en, categorias_gasto(nombre), bodegas(nombre), proveedores(nombre), metodos_pago(nombre)")
        .gte("fecha", periodo.desde).lte("fecha", periodo.hasta).order("fecha").order("id");
      if (punto) q = q.eq("bodega_id", punto);
      if (estado) q = q.eq("estado", estado);
      if (id("categoria")) q = q.eq("categoria_id", id("categoria"));
      if (id("proveedor")) q = q.eq("proveedor_id", id("proveedor"));
      if (id("usuario")) q = q.eq("registrado_por", id("usuario"));
      return q.range(a, b) as unknown as PromiseLike<{ data: G[] | null; error: { message: string } | null }>;
    });
    return {
      nombre: `gastos_${periodo.desde}_${periodo.hasta}`,
      hojas: [{ nombre: "Gastos", filas: [
        ["Número", "Fecha", "Categoría", "Descripción", "Punto", "Se le pagó a", "Valor", "Estado", "Pagado con"],
        ...datos.map((g) => [g.numero, g.fecha, g.categorias_gasto?.nombre, g.descripcion, g.bodegas?.nombre ?? "General",
          g.proveedores?.nombre ?? g.beneficiario, n(g.valor), ESTADOS_GASTO[g.estado] ?? g.estado, g.metodos_pago?.nombre]),
      ] }],
    };
  },

  // Compras del periodo y su resumen por proveedor
  async compras({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "compras.ver")) return null;
    type C = { numero: string | null; fecha: string; estado: string; total: number; proveedores: { nombre: string } | null; bodegas: { nombre: string } | null;
      pagos_compra: { tipo: string; valor: number }[]; devoluciones_proveedor: { valor_total: number }[] };
    const datos = await todasLasFilas<C>((a, b) => {
      let q = supabase.from("compras")
        .select("numero, fecha, estado, total, proveedores(nombre), bodegas(nombre), pagos_compra(tipo, valor), devoluciones_proveedor(valor_total)")
        .neq("estado", "borrador").gte("fecha", periodo.desde).lte("fecha", periodo.hasta).order("fecha").order("id");
      if (punto) q = q.eq("bodega_id", punto);
      return q.range(a, b) as unknown as PromiseLike<{ data: C[] | null; error: { message: string } | null }>;
    });
    const porProveedor = new Map<string, { compras: number; valor: number; saldo: number }>();
    for (const c of datos.filter((x) => x.estado !== "anulada")) {
      const k = c.proveedores?.nombre ?? "Sin proveedor";
      const r = porProveedor.get(k) ?? { compras: 0, valor: 0, saldo: 0 };
      r.compras += 1; r.valor += n(c.total); r.saldo += Math.max(saldoCompra(c), 0);
      porProveedor.set(k, r);
    }
    return {
      nombre: `compras_${periodo.desde}_${periodo.hasta}`,
      hojas: [
        { nombre: "Por proveedor", filas: [["Proveedor", "Compras", "Valor", "Saldo por pagar"],
          ...[...porProveedor].sort((a, b) => b[1].valor - a[1].valor).map(([k, r]) => [k, r.compras, r.valor, r.saldo])] },
        { nombre: "Compras", filas: [["Número", "Fecha", "Proveedor", "Punto", "Estado", "Total", "Saldo"],
          ...datos.map((c) => [c.numero, c.fecha, c.proveedores?.nombre, c.bodegas?.nombre, ESTADO_COMPRA[c.estado]?.texto ?? c.estado, n(c.total), saldoCompra(c)])] },
      ],
    };
  },

  // Gastos por categoría, proveedor y usuario, comparados con el periodo anterior
  async gastos_resumen({ sesion, supabase, periodo }) {
    if (!tiene(sesion, "informes.financieros")) return null;
    const inf = await rpc<InformeComprasGastos>(supabase, "informe_compras_gastos", { p_desde: periodo.desde, p_hasta: periodo.hasta });
    return {
      nombre: `gastos-y-compras_${periodo.desde}_${periodo.hasta}`,
      hojas: [
        { nombre: "Gastos por categoría", filas: [["Categoría", "Tipo", "Este periodo", "Periodo anterior", "Diferencia"],
          ...inf.gastos_por_categoria.map((g) => [g.categoria, g.tipo === "mercancia" ? "Mercancía" : "Operativo", n(g.valor), n(g.anterior), n(g.valor) - n(g.anterior)])] },
        { nombre: "Gastos por proveedor", filas: [["Proveedor o beneficiario", "Gastos", "Valor"], ...inf.gastos_por_proveedor.map((g) => [g.proveedor, n(g.gastos), n(g.valor)])] },
        { nombre: "Gastos por usuario", filas: [["Registró", "Gastos", "Valor"], ...inf.gastos_por_usuario.map((g) => [g.usuario, n(g.gastos), n(g.valor)])] },
        { nombre: "Compras por proveedor", filas: [["Proveedor", "Compras", "Este periodo", "Saldo", "Periodo anterior"],
          ...inf.compras_por_proveedor.map((c) => [c.proveedor, n(c.compras), n(c.valor), n(c.saldo), n(c.anterior)])] },
      ],
    };
  },

  // Estado de resultados, dinero real y saldos del periodo, con la utilidad mes a mes
  async resultado({ sesion, supabase, periodo, punto }) {
    if (!tiene(sesion, "informes.financieros")) return null;
    const [r, serie] = await Promise.all([
      rpc<ResumenFinanciero>(supabase, "resumen_financiero", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto }),
      rpc<SerieMes[]>(supabase, "serie_mensual", { p_meses: 12 }),
    ]);
    const c = r.calculado;
    return {
      nombre: `resultado_${periodo.desde}_${periodo.hasta}`,
      hojas: [
        { nombre: "Resultado", filas: [
          ["Concepto", "Valor"],
          ["Ventas entregadas", n(c.ventas_brutas)], ["Descuentos", -n(c.descuentos)], ["Impuestos incluidos", -n(c.impuestos)],
          ["Devoluciones de clientes", -n(c.devoluciones)], ["Ventas netas", n(c.ventas_netas)],
          ["Costo de lo vendido", -n(c.costo_mercancia_vendida)], ["Utilidad bruta", n(c.utilidad_bruta)],
          ["Gastos operativos", -n(c.gastos_registrados)], ["Pérdidas y ajustes de inventario", -n(c.perdidas_inventario)],
          ["Resultado operativo", n(c.resultado_operativo)], [],
          ["Dinero real", ""], ["Entró", n(r.dinero_real.entradas)], ["Salió", -n(r.dinero_real.salidas)], ["Flujo de caja", n(r.dinero_real.flujo_de_caja)],
          ["Aportes", n(r.dinero_real.aportes)], ["Retiros", -n(r.dinero_real.retiros)], [],
          ["Saldos de hoy", ""], ["Te deben clientes", n(r.saldos.cuentas_por_cobrar)], ["Anticipos de clientes", n(r.saldos.anticipos_de_clientes)],
          ["Debes a proveedores", n(r.saldos.compras_por_pagar)], ["Gastos por pagar", n(r.saldos.gastos_por_pagar)],
          ["Inventario a costo", n(r.saldos.valor_inventario.total)],
        ] },
        { nombre: "Mes a mes", filas: [
          ["Mes", "Ventas", "Ventas netas", "Costo", "Utilidad bruta", "Gastos", "Resultado", "Inventario a costo", "Unidades en inventario"],
          ...serie.map((m) => [m.mes, n(m.ventas), n(m.ventas_netas), m.costo, m.utilidad_bruta, m.gastos, m.resultado, m.inventario_valor, m.inventario_unidades]),
        ] },
      ],
    };
  },

  // Flujo de caja: el libro de todas las cuentas del periodo
  async caja({ sesion, supabase, periodo }) {
    if (!tiene(sesion, "caja.ver")) return null;
    type M = { ocurrido_en: string; sentido: string; origen: string; valor: number; descripcion: string | null; documento_tipo: string | null;
      cuentas_dinero: { nombre: string } | null };
    const datos = await todasLasFilas<M>((a, b) => supabase.from("movimientos_caja")
      .select("ocurrido_en, sentido, origen, valor, descripcion, documento_tipo, cuentas_dinero(nombre)")
      .gte("ocurrido_en", desdeTs(periodo.desde)).lte("ocurrido_en", hastaTs(periodo.hasta)).order("ocurrido_en").order("id")
      .range(a, b) as unknown as PromiseLike<{ data: M[] | null; error: { message: string } | null }>);
    return {
      nombre: `flujo-de-caja_${periodo.desde}_${periodo.hasta}`,
      hojas: [{ nombre: "Libro de caja", filas: [
        ["Fecha", "Cuenta", "Entrada", "Salida", "Concepto", "Descripción", "Documento"],
        ...datos.map((m) => [fechaHora(m.ocurrido_en), m.cuentas_dinero?.nombre, m.sentido === "entrada" ? n(m.valor) : null,
          m.sentido === "salida" ? n(m.valor) : null, ORIGENES[m.origen] ?? m.origen, m.descripcion, m.documento_tipo]),
      ] }],
    };
  },

  // Cuentas por cobrar de hoy
  async cobrar({ sesion, supabase, periodo }) {
    if (!tiene(sesion, "informes.financieros", "ventas.ver")) return null;
    const cp = await rpc<CuentasPendientes>(supabase, "cuentas_pendientes");
    return {
      nombre: `cuentas-por-cobrar_${periodo.hasta}`,
      hojas: [{ nombre: "Por cobrar", filas: [
        ["Venta", "Fecha", "Cliente", "Teléfono", "Punto", "Total", "Saldo", "Entregada", "Días"],
        ...(cp.por_cobrar ?? []).map((x) => [x.numero, x.fecha, x.cliente, x.telefono, x.punto, n(x.total), n(x.saldo), x.entregada, n(x.dias)]),
      ] }],
    };
  },

  // Cuentas por pagar de hoy: compras recibidas con saldo y gastos sin pagar
  async pagar({ sesion, supabase, periodo }) {
    if (!tiene(sesion, "informes.financieros", "compras.ver", "gastos.ver")) return null;
    const cp = await rpc<CuentasPendientes>(supabase, "cuentas_pendientes");
    return {
      nombre: `cuentas-por-pagar_${periodo.hasta}`,
      hojas: [{ nombre: "Por pagar", filas: [
        ["Tipo", "Número", "Fecha", "Proveedor o beneficiario", "Detalle", "Total", "Saldo", "Días"],
        ...(cp.por_pagar ?? []).map((x) => ["Compra", x.numero, x.fecha, x.proveedor, "", n(x.total), n(x.saldo), n(x.dias)]),
        ...(cp.gastos_por_pagar ?? []).map((x) => ["Gasto", x.numero, x.fecha, x.proveedor, `${x.categoria}: ${x.descripcion}`, n(x.valor), n(x.valor), n(x.dias)]),
      ] }],
    };
  },

  // Historial de cambios (auditoría) con los mismos filtros de la página
  async auditoria({ sesion, supabase, periodo, p }) {
    if (!tiene(sesion, "auditoria.ver")) return null;
    const tabla = p.get("tabla") ?? "";
    const usuario = /^[0-9a-f-]{36}$/.test(p.get("usuario") ?? "") ? p.get("usuario")! : "";
    const accion = ACCIONES[p.get("accion") ?? ""] ? p.get("accion")! : "";
    type A = { ocurrido_en: string; usuario_id: string | null; accion: string; tabla: string; registro_id: string | null;
      valor_anterior: unknown; valor_nuevo: unknown };
    const [datos, nombres] = await Promise.all([
      todasLasFilas<A>((a, b) => {
        let q = supabase.from("auditoria").select("ocurrido_en, usuario_id, accion, tabla, registro_id, valor_anterior, valor_nuevo")
          .gte("ocurrido_en", desdeTs(periodo.desde)).lte("ocurrido_en", hastaTs(periodo.hasta)).order("ocurrido_en").order("id");
        if (/^[a-z_]+$/.test(tabla)) q = q.eq("tabla", tabla);
        if (usuario) q = q.eq("usuario_id", usuario);
        if (accion) q = q.eq("accion", accion);
        return q.range(a, b) as unknown as PromiseLike<{ data: A[] | null; error: { message: string } | null }>;
      }, 50000),
      rpc<{ id: string; nombre: string }[]>(supabase, "usuarios_nombres"),
    ]);
    const nombre = new Map(nombres.map((u) => [u.id, u.nombre]));
    const json = (v: unknown) => (v ? JSON.stringify(v).slice(0, 30000) : "");
    return {
      nombre: `auditoria_${periodo.desde}_${periodo.hasta}`,
      hojas: [{ nombre: "Auditoría", filas: [
        ["Fecha", "Usuario", "Acción", "Tabla", "Registro", "Valor anterior", "Valor nuevo"],
        ...datos.map((x) => [fechaHora(x.ocurrido_en), x.usuario_id ? nombre.get(x.usuario_id) ?? x.usuario_id : "Sistema",
          ACCIONES[x.accion] ?? x.accion, x.tabla, x.registro_id, json(x.valor_anterior), json(x.valor_nuevo)]),
      ] }],
    };
  },
};

type Alerta = { sku: string; producto: string; bodega: string; cantidad: number; stock_minimo: number; alerta: string };
function hojaAlertas(alertas: Alerta[]): Hoja {
  const textos: Record<string, string> = { agotado: "Agotado", bajo_minimo: "Bajo el mínimo", pocas_unidades: "Pocas unidades" };
  return {
    nombre: "Agotados y stock bajo",
    filas: [["Producto", "SKU", "Punto", "Cantidad", "Mínimo", "Alerta"],
      ...alertas.map((a) => [a.producto, a.sku, a.bodega, n(a.cantidad), n(a.stock_minimo), textos[a.alerta] ?? a.alerta])],
  };
}

export async function GET(request: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion || !sesion.activo) return new Response("Inicia sesión para exportar.", { status: 401 });
  if (!tiene(sesion, "informes.exportar")) return new Response("No tienes permiso para exportar informes.", { status: 403 });
  const p = request.nextUrl.searchParams;
  const informe = INFORMES[p.get("tipo") ?? ""];
  if (!informe) return new Response("Informe no disponible.", { status: 404 });
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.map((b) => b.id);
  const punto = p.get("punto") && puntos.includes(p.get("punto")!) ? p.get("punto")! : null;
  const periodo = resolverPeriodo({ desde: p.get("desde") ?? undefined, hasta: p.get("hasta") ?? undefined, periodo: p.get("periodo") ?? undefined });
  try {
    const r = await informe({ sesion, supabase, p, periodo, punto });
    if (!r) return new Response("No tienes permiso para este informe.", { status: 403 });
    return descarga(r.nombre, r.hojas, formatoPedido(p.get("formato")));
  } catch {
    return new Response("No se pudo generar el informe. Intenta de nuevo en un momento.", { status: 500 });
  }
}
