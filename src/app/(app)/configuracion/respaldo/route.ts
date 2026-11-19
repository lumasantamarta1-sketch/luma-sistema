import { obtenerSesion, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { descarga, fechaHora, todasLasFilas, type Celda, type Hoja } from "@/lib/exportar";
import { hoyBogota } from "@/lib/ventas";

// Copia de seguridad descargable: un libro de Excel con una hoja por tabla, leída con la sesión
// del administrador (RLS). Descargarla no cambia ni borra nada. La auditoría se descarga aparte.
const TABLAS: { tabla: string; hoja: string; columnas?: string; orden: string[] }[] = [
  { tabla: "configuracion_negocio", hoja: "Configuración", orden: ["id"] },
  { tabla: "bodegas", hoja: "Puntos y bodegas", orden: ["id"] },
  { tabla: "perfiles", hoja: "Usuarios", orden: ["id"] },
  { tabla: "roles", hoja: "Roles", orden: ["id"] },
  { tabla: "permisos", hoja: "Permisos", orden: ["codigo"] },
  { tabla: "rol_permisos", hoja: "Permisos por rol", orden: ["rol_id", "permiso_codigo"] },
  { tabla: "usuario_bodegas", hoja: "Puntos por usuario", orden: ["usuario_id", "bodega_id"] },
  { tabla: "consecutivos", hoja: "Consecutivos", orden: ["tipo"] },
  { tabla: "categorias", hoja: "Categorías", orden: ["id"] },
  { tabla: "tallas", hoja: "Tallas", orden: ["id"] },
  { tabla: "colores", hoja: "Colores", orden: ["id"] },
  { tabla: "tipos_camiseta", hoja: "Tipos de camiseta", orden: ["id"] },
  { tabla: "disenos", hoja: "Diseños", orden: ["id"] },
  { tabla: "diseno_materiales", hoja: "Materiales de diseños", orden: ["id"] },
  { tabla: "productos", hoja: "Productos", orden: ["id"] },
  { tabla: "variantes", hoja: "Variantes", orden: ["id"] },
  { tabla: "variante_costos", hoja: "Costos", orden: ["variante_id"] },
  { tabla: "historial_costos", hoja: "Historial de costos", orden: ["id"] },
  { tabla: "historial_precios", hoja: "Historial de precios", orden: ["id"] },
  { tabla: "existencias", hoja: "Existencias", orden: ["variante_id", "bodega_id"] },
  { tabla: "movimientos_inventario", hoja: "Kardex", orden: ["id"] },
  { tabla: "ajustes_inventario", hoja: "Ajustes", orden: ["id"],
    columnas: "id, numero, bodega_id, tipo, motivo, estado, solicitado_por, solicitado_en, resuelto_por, resuelto_en, observacion" },
  { tabla: "ajuste_lineas", hoja: "Líneas de ajustes", orden: ["id"], columnas: "id, ajuste_id, variante_id, cantidad" },
  { tabla: "traslados", hoja: "Traslados", orden: ["id"] },
  { tabla: "traslado_lineas", hoja: "Líneas de traslados", orden: ["id"] },
  { tabla: "ordenes_estampado", hoja: "Órdenes de estampado", orden: ["id"],
    columnas: "id, numero, bodega_id, venta_id, estado, observaciones, creado_por, creado_en, terminado_por, terminado_en" },
  { tabla: "orden_estampado_lineas", hoja: "Líneas de estampado", orden: ["id"] },
  { tabla: "orden_estampado_consumos", hoja: "Consumos de estampado", orden: ["id"] },
  { tabla: "clientes", hoja: "Clientes", orden: ["id"] },
  { tabla: "proveedores", hoja: "Proveedores", orden: ["id"] },
  { tabla: "descuentos_autorizados", hoja: "Descuentos", orden: ["id"] },
  { tabla: "ventas", hoja: "Ventas", orden: ["id"] },
  { tabla: "venta_lineas", hoja: "Líneas de ventas", orden: ["id"] },
  { tabla: "venta_linea_costos", hoja: "Costo de lo vendido", orden: ["venta_linea_id"] },
  { tabla: "pagos_venta", hoja: "Pagos de ventas", orden: ["id"] },
  { tabla: "devoluciones_venta", hoja: "Devoluciones de clientes", orden: ["id"] },
  { tabla: "devolucion_venta_lineas", hoja: "Líneas devol. clientes", orden: ["id"] },
  { tabla: "compras", hoja: "Compras", orden: ["id"] },
  { tabla: "compra_lineas", hoja: "Líneas de compras", orden: ["id"] },
  { tabla: "compra_costos_adicionales", hoja: "Costos adicionales", orden: ["id"] },
  { tabla: "pagos_compra", hoja: "Pagos a proveedores", orden: ["id"] },
  { tabla: "devoluciones_proveedor", hoja: "Devoluciones a proveedores", orden: ["id"] },
  { tabla: "devolucion_proveedor_lineas", hoja: "Líneas devol. proveedores", orden: ["id"] },
  { tabla: "cuentas_dinero", hoja: "Cuentas de dinero", orden: ["id"] },
  { tabla: "metodos_pago", hoja: "Medios de pago", orden: ["id"] },
  { tabla: "impuestos", hoja: "Impuestos", orden: ["id"] },
  { tabla: "movimientos_caja", hoja: "Libro de caja", orden: ["id"] },
  { tabla: "cierres_caja", hoja: "Cierres de caja", orden: ["id"] },
  { tabla: "categorias_gasto", hoja: "Categorías de gasto", orden: ["id"] },
  { tabla: "gastos_recurrentes", hoja: "Gastos fijos", orden: ["id"] },
  { tabla: "gastos", hoja: "Gastos", orden: ["id"] },
  { tabla: "adjuntos", hoja: "Adjuntos (referencias)", orden: ["id"] },
];

const celda = (v: unknown): Celda =>
  v === null || v === undefined ? null
    : typeof v === "number" || typeof v === "boolean" ? v
    : typeof v === "object" ? JSON.stringify(v) : String(v);

function aHoja(nombre: string, filas: Record<string, unknown>[]): Hoja {
  const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  if (!columnas.length) return { nombre, filas: [["Sin registros"]] };
  return { nombre, filas: [columnas, ...filas.map((f) => columnas.map((c) => celda(f[c])))] };
}

export async function GET() {
  const sesion = await obtenerSesion();
  if (!sesion || !sesion.activo) return new Response("Inicia sesión para descargar la copia.", { status: 401 });
  if (!tiene(sesion, "configuracion.gestionar")) return new Response("Solo el administrador descarga la copia de seguridad.", { status: 403 });
  const supabase = await crearClienteServidor();
  try {
    const hojas: Hoja[] = [];
    const conteo: [string, number][] = [];
    // De a seis tablas a la vez, cada una por páginas de 1.000 filas
    for (let i = 0; i < TABLAS.length; i += 6) {
      const grupo = TABLAS.slice(i, i + 6);
      const datos = await Promise.all(grupo.map((t) => todasLasFilas<Record<string, unknown>>((a, b) => {
        let q = supabase.from(t.tabla).select(t.columnas ?? "*");
        for (const o of t.orden) q = q.order(o);
        return q.range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      }, 200000)));
      grupo.forEach((t, k) => { hojas.push(aHoja(t.hoja, datos[k])); conteo.push([t.hoja, datos[k].length]); });
    }
    const leeme: Hoja = {
      nombre: "Léeme",
      filas: [
        ["Copia de seguridad de LUMA"],
        ["Generada", fechaHora(new Date().toISOString())],
        ["Por", sesion.nombre || sesion.correo || ""],
        [],
        ["Cada hoja es una tabla del sistema con todos sus registros. Descargarla no cambia ni borra nada."],
        ["Guárdala en un lugar seguro: tiene datos de clientes, proveedores y finanzas."],
        ["La auditoría (historial de cambios) se descarga aparte desde Auditoría."],
        ["Los archivos adjuntos (facturas, soportes) siguen en el almacenamiento privado; aquí va solo su referencia."],
        [],
        ["Hoja", "Registros"],
        ...conteo,
      ],
    };
    return descarga(`respaldo-luma_${hoyBogota()}`, [leeme, ...hojas], "xlsx");
  } catch (e) {
    console.error("[respaldo]", e instanceof Error ? e.message : e);
    return new Response("No se pudo generar la copia de seguridad. Intenta de nuevo en un momento.", { status: 500 });
  }
}
