import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sesion } from "@/lib/sesion";
import { tiene } from "@/lib/sesion";
import { obtenerVariantes } from "@/lib/catalogo";
import { hoyBogota } from "@/lib/ventas";

export type ProductoCompra = { id: string; sku: string; producto: string; detalle: string; clase: string; unidad: string; costo: number | null };
export type LineaCompraInicial = { varianteId: string; cantidad: number; costo: number; descuento: number; iva: number };

export type DatosFormularioCompra = {
  proveedores: { id: string; nombre: string }[];
  puntos: { id: string; nombre: string }[];
  productos: ProductoCompra[];
  hoy: string;
  ivaDescontable: boolean;
  inicial: null | {
    compraId: string; numero: string; proveedorId: string; bodegaId: string; fecha: string; formaPago: string; observaciones: string;
    lineas: LineaCompraInicial[]; adicionales: { concepto: string; valor: number }[];
  };
};

// Todo lo que necesita el formulario de compra, con los permisos de quien compra (RLS)
export async function datosFormularioCompra(supabase: SupabaseClient, sesion: Sesion, compraId?: string): Promise<DatosFormularioCompra> {
  const veCostos = tiene(sesion, "costos.ver");
  const [{ data: proveedores }, variantes, { data: costos }, { data: config }, compra] = await Promise.all([
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
    obtenerVariantes(supabase),
    veCostos ? supabase.from("variante_costos").select("variante_id, costo_promedio") : Promise.resolve({ data: [] }),
    supabase.from("configuracion_negocio").select("responsable_iva").eq("id", 1).maybeSingle(),
    compraId
      ? supabase.from("compras")
          .select("id, numero, estado, proveedor_id, bodega_id, fecha, forma_pago, observaciones, compra_lineas(variante_id, cantidad, costo_unitario, descuento, impuesto_pct), compra_costos_adicionales(concepto, valor)")
          .eq("id", compraId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const costo = new Map(((costos ?? []) as { variante_id: string; costo_promedio: number }[]).map((c) => [c.variante_id, Number(c.costo_promedio)]));
  type FilaCompra = {
    id: string; numero: string; estado: string; proveedor_id: string; bodega_id: string; fecha: string; forma_pago: string | null; observaciones: string | null;
    compra_lineas: { variante_id: string; cantidad: number; costo_unitario: number; descuento: number; impuesto_pct: number }[];
    compra_costos_adicionales: { concepto: string; valor: number }[];
  };
  const c = compra.data as FilaCompra | null;
  return {
    proveedores: (proveedores ?? []) as { id: string; nombre: string }[],
    puntos: sesion.bodegas.map((b) => ({ id: b.id, nombre: b.nombre })),
    productos: variantes.map((v) => ({
      id: v.id, sku: v.sku, producto: v.producto, detalle: v.detalle, clase: v.clase, unidad: v.unidad,
      costo: costo.has(v.id) && costo.get(v.id)! > 0 ? costo.get(v.id)! : null,
    })).sort((a, b) => a.producto.localeCompare(b.producto, "es") || a.sku.localeCompare(b.sku)),
    hoy: hoyBogota(),
    ivaDescontable: Boolean(config?.responsable_iva),
    inicial: c && c.estado === "borrador" ? {
      compraId: c.id, numero: c.numero, proveedorId: c.proveedor_id, bodegaId: c.bodega_id, fecha: c.fecha,
      formaPago: c.forma_pago ?? "", observaciones: c.observaciones ?? "",
      lineas: c.compra_lineas.map((l) => ({
        varianteId: l.variante_id, cantidad: Number(l.cantidad), costo: Number(l.costo_unitario), descuento: Number(l.descuento), iva: Number(l.impuesto_pct),
      })),
      adicionales: c.compra_costos_adicionales.map((a) => ({ concepto: a.concepto, valor: Number(a.valor) })),
    } : null,
  };
}
