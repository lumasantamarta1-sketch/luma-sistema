import type { NextRequest } from "next/server";
import { obtenerSesion, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { resolverPeriodo } from "@/lib/periodos";
import type { InformeVentas } from "@/lib/informes";
import { numeroVenta, saldoVenta } from "@/lib/ventas";

type Celda = string | number | null | undefined;

// CSV para Excel en español: separador «;», coma decimal y BOM para las tildes.
// Un texto que empiece por = + - @ se marca como texto para que Excel no lo ejecute como fórmula.
function csv(filas: Celda[][]) {
  const celda = (v: Celda) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace(".", ",");
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n");
}

function respuesta(nombre: string, filas: Celda[][]) {
  return new Response(csv(filas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

const n = (v: unknown) => Number(v ?? 0);

export async function GET(request: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion || !sesion.activo) return new Response("Inicia sesión para exportar.", { status: 401 });
  if (!tiene(sesion, "informes.exportar")) return new Response("No tienes permiso para exportar informes.", { status: 403 });
  const p = request.nextUrl.searchParams;
  const tipo = p.get("tipo");
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.map((b) => b.id);
  const punto = p.get("punto") && puntos.includes(p.get("punto")!) ? p.get("punto")! : null;
  const periodo = resolverPeriodo({ desde: p.get("desde") ?? undefined, hasta: p.get("hasta") ?? undefined, periodo: p.get("periodo") ?? undefined });

  if (tipo === "ventas" && tiene(sesion, "informes.ver")) {
    const { data, error } = await supabase.rpc("informe_ventas", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto });
    if (error || !data) return new Response("No se pudo generar el informe.", { status: 400 });
    const inf = data as InformeVentas;
    return respuesta(`ventas-por-producto_${periodo.desde}_${periodo.hasta}`, [
      ["Producto", "SKU", "Detalle", "Unidades", "Vendido", ...(inf.con_costos ? ["Costo", "Utilidad bruta"] : [])],
      ...inf.por_producto.map((x) => [x.producto, x.sku, x.detalle, n(x.unidades), n(x.valor), ...(inf.con_costos ? [n(x.costo), n(x.utilidad)] : [])]),
    ]);
  }

  if (tipo === "ventas_lista" && tiene(sesion, "informes.ver", "ventas.ver")) {
    let q = supabase.from("ventas")
      .select("numero, numero_cotizacion, estado, estado_entrega, total, confirmada_en, entregada_en, bodegas(nombre), clientes(nombre, documento), perfiles(nombre), pagos_venta(tipo, valor), devoluciones_venta(valor_total)")
      .eq("estado", "confirmada")
      .gte("confirmada_en", `${periodo.desde}T00:00:00-05:00`).lte("confirmada_en", `${periodo.hasta}T23:59:59.999-05:00`)
      .order("confirmada_en").limit(10000);
    if (punto) q = q.eq("bodega_id", punto);
    const { data } = await q;
    type V = { numero: string | null; numero_cotizacion: string | null; estado: string; estado_entrega: string; total: number; confirmada_en: string; entregada_en: string | null;
      bodegas: { nombre: string } | null; clientes: { nombre: string; documento: string | null } | null; perfiles: { nombre: string } | null;
      pagos_venta: { tipo: string; valor: number }[]; devoluciones_venta: { valor_total: number }[] };
    const dia = (t: string | null) => (t ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(t)) : "");
    return respuesta(`ventas_${periodo.desde}_${periodo.hasta}`, [
      ["Número", "Confirmada", "Entregada", "Punto", "Cliente", "Documento", "Vendedor", "Total", "Pagado", "Saldo"],
      ...((data ?? []) as unknown as V[]).map((v) => {
        const saldo = saldoVenta(v);
        const pagado = v.pagos_venta.reduce((s, x) => s + (x.tipo === "pago" ? 1 : -1) * n(x.valor), 0);
        return [numeroVenta(v), dia(v.confirmada_en), dia(v.entregada_en), v.bodegas?.nombre, v.clientes?.nombre ?? "Cliente mostrador",
                v.clientes?.documento, v.perfiles?.nombre, n(v.total), pagado, saldo];
      }),
    ]);
  }

  if (tipo === "inventario" && tiene(sesion, "informes.inventario")) {
    const veCostos = tiene(sesion, "costos.ver");
    let q = supabase.from("existencias_detalle")
      .select("variante_id, bodega, sku, producto, clase, unidad_medida, talla, color, diseno, cantidad, disponible")
      .neq("cantidad", 0).order("producto").order("sku").limit(10000);
    if (punto) q = q.eq("bodega_id", punto);
    const [{ data }, { data: costos }] = await Promise.all([
      q, veCostos ? supabase.from("variante_costos").select("variante_id, costo_promedio") : Promise.resolve({ data: [] }),
    ]);
    const costo = new Map(((costos ?? []) as { variante_id: string; costo_promedio: number }[]).map((c) => [c.variante_id, n(c.costo_promedio)]));
    type E = { variante_id: string; bodega: string; sku: string; producto: string; clase: string; unidad_medida: string;
      talla: string | null; color: string | null; diseno: string | null; cantidad: number; disponible: number };
    return respuesta(`inventario_${periodo.hasta}`, [
      ["Producto", "SKU", "Diseño", "Talla", "Color", "Punto", "Unidad", "Cantidad", "Disponible", ...(veCostos ? ["Costo promedio", "Valor"] : [])],
      ...((data ?? []) as E[]).map((e) => [e.producto, e.sku, e.diseno, e.talla, e.color, e.bodega, e.unidad_medida, n(e.cantidad), n(e.disponible),
        ...(veCostos ? [costo.get(e.variante_id) ?? 0, n(e.cantidad) * (costo.get(e.variante_id) ?? 0)] : [])]),
    ]);
  }

  if (tipo === "gastos" && tiene(sesion, "gastos.ver")) {
    let q = supabase.from("gastos")
      .select("numero, fecha, descripcion, valor, estado, beneficiario, pagado_en, categorias_gasto(nombre), bodegas(nombre), proveedores(nombre), metodos_pago(nombre)")
      .gte("fecha", periodo.desde).lte("fecha", periodo.hasta).order("fecha").limit(10000);
    if (punto) q = q.eq("bodega_id", punto);
    const { data } = await q;
    type G = { numero: string; fecha: string; descripcion: string; valor: number; estado: string; beneficiario: string | null; pagado_en: string | null;
      categorias_gasto: { nombre: string } | null; bodegas: { nombre: string } | null; proveedores: { nombre: string } | null; metodos_pago: { nombre: string } | null };
    const estados: Record<string, string> = { pendiente: "Por pagar", pagado: "Pagado", anulado: "Anulado" };
    return respuesta(`gastos_${periodo.desde}_${periodo.hasta}`, [
      ["Número", "Fecha", "Categoría", "Descripción", "Punto", "Se le pagó a", "Valor", "Estado", "Pagado con"],
      ...((data ?? []) as unknown as G[]).map((g) => [g.numero, g.fecha, g.categorias_gasto?.nombre, g.descripcion, g.bodegas?.nombre ?? "General",
        g.proveedores?.nombre ?? g.beneficiario, n(g.valor), estados[g.estado] ?? g.estado, g.metodos_pago?.nombre]),
    ]);
  }

  return new Response("Informe no disponible.", { status: 404 });
}
