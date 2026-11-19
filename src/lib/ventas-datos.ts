import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sesion } from "@/lib/sesion";
import { tiene } from "@/lib/sesion";
import { detalleVariante } from "@/lib/catalogo";
import { hoyBogota, type DescuentoOpcion } from "@/lib/ventas";

export type ProductoVenta = {
  id: string; sku: string; productoId: string; producto: string; detalle: string; unidad: string;
  precio: number | null; porPedido: boolean;
  disponible: Record<string, number>; // por punto de venta
};

export type ClienteOpcion = { id: string; nombre: string; documento: string | null; telefono: string | null };
export type MetodoPago = { id: string; nombre: string; tipo: string };

export type LineaInicial = {
  varianteId: string; cantidad: number; precio: number; descuento: number;
  descuentoId: string | null; personalizacion: string;
};

export type DatosFormularioVenta = {
  puntos: { id: string; nombre: string }[];
  productos: ProductoVenta[];
  clientes: ClienteOpcion[];
  descuentos: DescuentoOpcion[];
  metodos: MetodoPago[];
  permisos: { cambiaPrecio: boolean; descuentoDirecto: boolean; cobra: boolean; creaClientes: boolean; entrega: boolean; credito: boolean };
  config: { bajoPedido: boolean; anticipoPct: number };
  inicial: null | {
    ventaId: string; numero: string; bodegaId: string; clienteId: string | null; observaciones: string; lineas: LineaInicial[];
  };
};

type FilaVariante = {
  id: string; sku: string; precio_venta: number | null; producto_id: string;
  productos: { nombre: string; unidad_medida: string; por_pedido: boolean } | null;
  tallas: { nombre: string; orden: number } | null; colores: { nombre: string } | null;
  tipos_camiseta: { nombre: string } | null; disenos: { nombre: string } | null;
};

// Todo lo que necesita el formulario de venta, leído con los permisos de quien vende (RLS)
export async function datosFormularioVenta(supabase: SupabaseClient, sesion: Sesion, ventaId?: string): Promise<DatosFormularioVenta> {
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta").map((b) => ({ id: b.id, nombre: b.nombre }));
  const hoy = hoyBogota();
  const [variantes, existencias, clientes, descuentos, metodos, config, venta] = await Promise.all([
    supabase.from("variantes")
      .select("id, sku, precio_venta, producto_id, productos!inner(nombre, unidad_medida, por_pedido, se_vende, activo), tallas(nombre, orden), colores(nombre), tipos_camiseta(nombre), disenos(nombre)")
      .eq("activo", true).eq("productos.se_vende", true).eq("productos.activo", true).order("sku"),
    puntos.length
      ? supabase.from("existencias").select("variante_id, bodega_id, cantidad, apartada").in("bodega_id", puntos.map((p) => p.id))
      : Promise.resolve({ data: [] }),
    supabase.from("clientes").select("id, nombre, documento, telefono").eq("activo", true).order("nombre").limit(2000),
    supabase.from("descuentos_autorizados")
      .select("id, tipo, nombre, porcentaje, valor_por_unidad, valor_total, producto_id, variante_id, venta_id, vigente_desde, vigente_hasta")
      .eq("activo", true),
    supabase.from("metodos_pago").select("id, nombre, tipo").eq("activo", true).order("nombre"),
    supabase.from("configuracion_negocio").select("permite_venta_bajo_pedido, anticipo_minimo_pct").eq("id", 1).maybeSingle(),
    ventaId
      ? supabase.from("ventas")
          .select("id, numero_cotizacion, estado, bodega_id, cliente_id, observaciones, venta_lineas(variante_id, cantidad, precio_unitario, descuento, descuento_autorizado_id, personalizacion)")
          .eq("id", ventaId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const disponible = new Map<string, Record<string, number>>();
  for (const e of (existencias.data ?? []) as { variante_id: string; bodega_id: string; cantidad: number; apartada: number }[]) {
    const d = disponible.get(e.variante_id) ?? {};
    d[e.bodega_id] = Number(e.cantidad) - Number(e.apartada);
    disponible.set(e.variante_id, d);
  }
  const productos = ((variantes.data ?? []) as unknown as FilaVariante[]).map((v) => ({
    id: v.id, sku: v.sku, productoId: v.producto_id, producto: v.productos?.nombre ?? "", detalle: detalleVariante(v),
    unidad: v.productos?.unidad_medida ?? "unidad", precio: v.precio_venta === null ? null : Number(v.precio_venta),
    porPedido: Boolean(v.productos?.por_pedido), disponible: disponible.get(v.id) ?? {},
  })).sort((a, b) => a.producto.localeCompare(b.producto, "es") || a.sku.localeCompare(b.sku));

  type FilaDescuento = DescuentoOpcion & { vigente_desde: string | null; vigente_hasta: string | null };
  const vigentes = ((descuentos.data ?? []) as FilaDescuento[])
    .filter((d) => (!d.vigente_desde || d.vigente_desde <= hoy) && (!d.vigente_hasta || d.vigente_hasta >= hoy))
    .filter((d) => d.tipo === "promocion" || (ventaId && d.venta_id === ventaId))
    .map((d) => ({
      id: d.id, tipo: d.tipo, nombre: d.nombre, producto_id: d.producto_id, variante_id: d.variante_id, venta_id: d.venta_id,
      porcentaje: d.porcentaje === null ? null : Number(d.porcentaje),
      valor_por_unidad: d.valor_por_unidad === null ? null : Number(d.valor_por_unidad),
      valor_total: d.valor_total === null ? null : Number(d.valor_total),
    }));

  type FilaVenta = {
    id: string; numero_cotizacion: string; estado: string; bodega_id: string; cliente_id: string | null; observaciones: string | null;
    venta_lineas: { variante_id: string; cantidad: number; precio_unitario: number; descuento: number; descuento_autorizado_id: string | null; personalizacion: string | null }[];
  };
  const v = venta.data as FilaVenta | null;
  return {
    puntos,
    productos,
    clientes: (clientes.data ?? []) as ClienteOpcion[],
    descuentos: vigentes,
    metodos: (metodos.data ?? []) as MetodoPago[],
    permisos: {
      cambiaPrecio: tiene(sesion, "precios.gestionar"),
      descuentoDirecto: tiene(sesion, "descuentos.autorizar"),
      cobra: tiene(sesion, "ventas.cobrar"),
      creaClientes: tiene(sesion, "clientes.crear", "clientes.gestionar"),
      entrega: tiene(sesion, "ventas.entregar"),
      credito: tiene(sesion, "ventas.credito"),
    },
    config: {
      bajoPedido: Boolean(config.data?.permite_venta_bajo_pedido),
      anticipoPct: Number(config.data?.anticipo_minimo_pct ?? 0),
    },
    inicial: v && v.estado === "cotizacion" ? {
      ventaId: v.id, numero: v.numero_cotizacion, bodegaId: v.bodega_id, clienteId: v.cliente_id, observaciones: v.observaciones ?? "",
      lineas: v.venta_lineas.map((l) => ({
        varianteId: l.variante_id, cantidad: Number(l.cantidad), precio: Number(l.precio_unitario), descuento: Number(l.descuento),
        descuentoId: l.descuento_autorizado_id, personalizacion: l.personalizacion ?? "",
      })),
    } : null,
  };
}
