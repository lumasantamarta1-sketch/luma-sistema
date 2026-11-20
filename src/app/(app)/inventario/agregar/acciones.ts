"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";
import { hoyBogota } from "@/lib/ventas";
import { saldoCompra } from "@/lib/compras";
import { claveCombinacion, codigoLibre, crearVariantesFaltantes } from "@/lib/variantes";

// «Agregar inventario»: elige o crea la camiseta, crea las tallas y colores que falten y registra
// la entrada en un solo paso, como inventario que ya se tenía (con su costo) o como compra recibida.
// La clave evita registrar dos veces la misma entrada si se toca el botón de nuevo.

const uuid = z.string().uuid();
// Para buscar un nombre igual (sin distinguir mayúsculas) sin que % o _ actúen como comodines
const exacto = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
const esquema = z.object({
  producto_id: uuid.nullable(),
  nuevo: z.object({
    nombre: z.string().trim().min(2, "Escribe el nombre de la camiseta.").max(80),
    clase: z.enum(["terminado", "base"]),
  }).nullable(),
  diseno_id: uuid.nullable(),
  diseno_nuevo: z.string().trim().max(60),
  tipo_id: z.string().uuid("Elige el tipo de camiseta."),
  celdas: z.array(z.object({
    talla_id: uuid, color_id: uuid,
    cantidad: z.number().int("Las camisetas se cuentan enteras.").positive().max(100000),
  })).min(1, "Escribe cuántas camisetas llegan de al menos una talla y color."),
  bodega_id: z.string().uuid("Elige a qué punto llegan."),
  costo: z.number().nonnegative("El costo no puede ser negativo.").max(100000000),
  precio: z.number().nonnegative("El precio no puede ser negativo.").max(100000000).nullable(),
  minimo: z.number().int().nonnegative().max(100000),
  origen: z.enum(["tenia", "compra"]),
  proveedor_id: uuid.nullable(),
  proveedor_nuevo: z.string().trim().max(120),
  pagada: z.boolean(),
  cuenta_id: uuid.nullable(),
  nota: z.string().trim().max(300),
  clave: uuid,
});

export type EntradaHecha = {
  tipo: "ajuste" | "compra"; id: string; numero: string; pendiente: boolean; unidades: number; valor: number;
  saldo: number; punto: string; nuevas: number; productoId: string; producto: string; proveedor?: string;
};
export type ResultadoAgregar = { error?: string; productoId?: string; hecho?: EntradaHecha };

export async function agregarInventario(entrada: unknown): Promise<ResultadoAgregar> {
  const sesion = await exigirPermiso("inventario.ajustar", "compras.gestionar");
  const r = esquema.safeParse(entrada);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos." };
  const v = r.data;
  if (!tiene(sesion, "costos.ver")) return { error: "Para agregar inventario se registra el costo; pídeselo a quien administra." };
  if (v.origen === "tenia" && !tiene(sesion, "inventario.ajustar")) return { error: "Tu rol no agrega inventario directo: regístralo como compra." };
  if (v.origen === "compra" && !tiene(sesion, "compras.gestionar")) return { error: "Tu rol no registra compras." };
  if (v.origen === "compra" && v.pagada && !tiene(sesion, "compras.pagar")) return { error: "Tu rol no registra pagos a proveedores: marca que aún se debe." };
  if (v.origen === "compra" && v.pagada && !v.cuenta_id) return { error: "Elige de qué cuenta salió el pago." };
  if (v.origen === "compra" && !v.proveedor_id && !v.proveedor_nuevo) return { error: "Elige el proveedor o escribe su nombre." };
  const punto = sesion.bodegas.find((b) => b.id === v.bodega_id);
  if (!punto) return { error: "No tienes acceso a ese punto." };
  const vistas = new Set<string>();
  for (const c of v.celdas) {
    const k = `${c.talla_id}|${c.color_id}`;
    if (vistas.has(k)) return { error: "Hay una talla y color repetidos." };
    vistas.add(k);
  }
  const supabase = await crearClienteServidor();

  // 1. La camiseta: la que ya existe o una nueva (si ya se creó en un intento anterior, se reutiliza)
  type Producto = { id: string; codigo: string; nombre: string; clase: string; se_vende: boolean; por_pedido: boolean; activo: boolean };
  let producto: Producto | null = null;
  if (v.producto_id) {
    const { data } = await supabase.from("productos").select("id, codigo, nombre, clase, se_vende, por_pedido, activo").eq("id", v.producto_id).maybeSingle();
    producto = data as Producto | null;
    if (!producto) return { error: "La camiseta no existe." };
  } else if (v.nuevo) {
    if (!tiene(sesion, "catalogo.gestionar")) return { error: "Tu rol no crea camisetas nuevas." };
    const { data: igual } = await supabase.from("productos").select("id, codigo, nombre, clase, se_vende, por_pedido, activo")
      .ilike("nombre", exacto(v.nuevo.nombre)).eq("clase", v.nuevo.clase).limit(1).maybeSingle();
    if (igual) producto = igual as Producto;
    else {
      const codigo = await codigoLibre(supabase, "productos", v.nuevo.nombre, 20);
      const { data, error } = await supabase.from("productos").insert({
        codigo, nombre: v.nuevo.nombre, clase: v.nuevo.clase, unidad_medida: "unidad",
        se_vende: v.nuevo.clase === "terminado", por_pedido: false,
      }).select("id, codigo, nombre, clase, se_vende, por_pedido, activo").single();
      if (error) return { error: mensajeError(error) };
      producto = data as Producto;
    }
  } else return { error: "Elige la camiseta." };
  if (producto.clase !== "terminado" && producto.clase !== "base") return { error: "Aquí se agregan camisetas; los materiales se compran en Compras." };
  if (producto.por_pedido) return { error: "Esta camiseta se hace por pedido: no lleva inventario." };
  // Si algo falla después de crear la camiseta, se avisa su id para no crearla otra vez al reintentar
  const conProducto = (error: string): ResultadoAgregar => {
    revalidatePath("/inventario/agregar");
    return { error, productoId: producto.id };
  };

  // 2. El diseño de la estampada
  let disenoId: string | null = null;
  let codigoDiseno: string | null = null;
  if (producto.clase === "terminado") {
    if (v.diseno_id) {
      const { data } = await supabase.from("disenos").select("id, codigo").eq("id", v.diseno_id).maybeSingle();
      if (!data) return conProducto("El diseño no existe.");
      disenoId = data.id; codigoDiseno = data.codigo;
    } else if (v.diseno_nuevo) {
      if (!tiene(sesion, "catalogo.gestionar")) return conProducto("Tu rol no crea diseños nuevos.");
      const { data: igual } = await supabase.from("disenos").select("id, codigo").ilike("nombre", exacto(v.diseno_nuevo)).limit(1).maybeSingle();
      if (igual) { disenoId = igual.id; codigoDiseno = igual.codigo; }
      else {
        const codigo = await codigoLibre(supabase, "disenos", v.diseno_nuevo, 12);
        const { data, error } = await supabase.from("disenos").insert({ codigo, nombre: v.diseno_nuevo }).select("id, codigo").single();
        if (error) return conProducto(mensajeError(error));
        disenoId = data.id; codigoDiseno = data.codigo;
      }
    } else return conProducto("Elige el diseño de la camiseta estampada.");
  }

  // 3. Tallas y colores que falten en esta camiseta
  const tallasIds = [...new Set(v.celdas.map((c) => c.talla_id))];
  const coloresIds = [...new Set(v.celdas.map((c) => c.color_id))];
  const [{ data: tipo }, { data: tallas }, { data: colores }, { data: existentes }] = await Promise.all([
    supabase.from("tipos_camiseta").select("id, nombre").eq("id", v.tipo_id).maybeSingle(),
    supabase.from("tallas").select("id, nombre").in("id", tallasIds),
    supabase.from("colores").select("id, nombre").in("id", coloresIds),
    supabase.from("variantes").select("id, tipo_id, talla_id, color_id, diseno_id").eq("producto_id", producto.id),
  ]);
  if (!tipo || (tallas ?? []).length !== tallasIds.length || (colores ?? []).length !== coloresIds.length) {
    return conProducto("Alguna talla, color o tipo ya no existe. Recarga la página.");
  }
  const porTalla = new Map((tallas ?? []).map((t) => [t.id, t]));
  const porColor = new Map((colores ?? []).map((c) => [c.id, c]));
  const ya = new Set((existentes ?? []).map((x) => claveCombinacion(x.tipo_id, x.talla_id, x.color_id, x.diseno_id)));
  const faltan = v.celdas.filter((c) => !ya.has(claveCombinacion(v.tipo_id, c.talla_id, c.color_id, disenoId)));
  let nuevas = 0;
  if (faltan.length) {
    if (!tiene(sesion, "catalogo.gestionar")) return conProducto("Hay tallas o colores nuevos para esta camiseta y tu rol no puede crearlos.");
    if (producto.se_vende && v.precio === null) return conProducto("Escribe el precio de venta de las tallas y colores nuevos.");
    const creadas = await crearVariantesFaltantes(supabase, {
      producto, disenoId, codigoDiseno, precio: v.precio, minimo: v.minimo,
      combinaciones: faltan.map((c) => ({ tipo, talla: porTalla.get(c.talla_id)!, color: porColor.get(c.color_id)! })),
    });
    if (creadas.error) return conProducto(creadas.error);
    nuevas = creadas.creadas;
  }
  const { data: variantes } = await supabase.from("variantes").select("id, tipo_id, talla_id, color_id, diseno_id").eq("producto_id", producto.id);
  const idPor = new Map((variantes ?? []).map((x) => [claveCombinacion(x.tipo_id, x.talla_id, x.color_id, x.diseno_id), x.id as string]));
  const lineas: { variante_id: string; cantidad: number; costo_unitario: number }[] = [];
  for (const c of v.celdas) {
    const id = idPor.get(claveCombinacion(v.tipo_id, c.talla_id, c.color_id, disenoId));
    if (!id) return conProducto("No se pudo preparar una de las tallas o colores. Intenta de nuevo.");
    lineas.push({ variante_id: id, cantidad: c.cantidad, costo_unitario: v.costo });
  }
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const valor = Math.round(unidades * v.costo * 100) / 100;

  // 4. La entrada: inventario que ya se tenía, o compra recibida (y pagada si ya se pagó)
  let hecho: EntradaHecha;
  if (v.origen === "tenia") {
    const { data: id, error } = await supabase.rpc("entrada_inventario", {
      p_datos: { bodega_id: v.bodega_id, tipo: "saldo_inicial", motivo: v.nota || `Ingreso de inventario: ${producto.nombre}`, lineas },
      p_clave: v.clave,
    });
    if (error) return conProducto(mensajeError(error));
    const { data: ajuste } = await supabase.from("ajustes_inventario").select("numero, estado").eq("id", id).maybeSingle();
    hecho = {
      tipo: "ajuste", id: String(id), numero: ajuste?.numero ?? "", pendiente: ajuste?.estado === "pendiente",
      unidades, valor, saldo: 0, punto: punto.nombre, nuevas, productoId: producto.id, producto: producto.nombre,
    };
  } else {
    let proveedorId = v.proveedor_id;
    let proveedorNombre = "";
    if (!proveedorId) {
      if (!tiene(sesion, "proveedores.gestionar")) return conProducto("Tu rol no crea proveedores: elige uno de la lista.");
      const { data: igual } = await supabase.from("proveedores").select("id, nombre").ilike("nombre", exacto(v.proveedor_nuevo)).limit(1).maybeSingle();
      if (igual) { proveedorId = igual.id; proveedorNombre = igual.nombre; }
      else {
        const { data, error } = await supabase.from("proveedores").insert({ nombre: v.proveedor_nuevo }).select("id, nombre").single();
        if (error) return conProducto(mensajeError(error));
        proveedorId = data.id; proveedorNombre = data.nombre;
      }
    }
    const { data: id, error } = await supabase.rpc("compra_recibida", {
      p_datos: {
        proveedor_id: proveedorId, bodega_id: v.bodega_id, fecha: hoyBogota(), forma_pago: v.pagada ? "Contado" : "Crédito",
        observaciones: v.nota || "Registrada desde «Agregar inventario».",
        lineas: lineas.map((l) => ({ ...l, descuento: 0, impuesto_pct: 0 })), costos_adicionales: [],
      },
      p_clave: v.clave,
      p_pago: v.pagada ? { cuenta_id: v.cuenta_id } : null,
    });
    if (error) return conProducto(mensajeError(error));
    const { data: compra } = await supabase.from("compras")
      .select("numero, estado, total, proveedores(nombre), pagos_compra(tipo, valor), devoluciones_proveedor(valor_total)").eq("id", id).maybeSingle();
    const c = compra as unknown as Parameters<typeof saldoCompra>[0] & { numero: string; total: number; proveedores: { nombre: string } | null } | null;
    hecho = {
      tipo: "compra", id: String(id), numero: c?.numero ?? "", pendiente: false, unidades, valor: Number(c?.total ?? valor),
      saldo: c ? saldoCompra(c) : 0, punto: punto.nombre, nuevas, productoId: producto.id, producto: producto.nombre,
      proveedor: c?.proveedores?.nombre ?? proveedorNombre,
    };
  }
  revalidatePath("/inventario", "layout");
  revalidatePath("/productos", "layout");
  revalidatePath("/compras", "layout");
  revalidatePath("/caja", "layout");
  revalidatePath("/ventas/nueva");
  revalidatePath("/");
  return { hecho };
}

// Agregar una talla, un color o un tipo sin salir de la pantalla
const esquemaOpcion = z.object({
  tabla: z.enum(["tallas", "colores", "tipos_camiseta"]),
  nombre: z.string().trim().min(1, "Escribe el nombre.").max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
});
export async function crearOpcion(entrada: unknown): Promise<{ error?: string; opcion?: { id: string; nombre: string; hex: string | null; orden?: number } }> {
  await exigirPermiso("catalogo.gestionar");
  const r = esquemaOpcion.safeParse(entrada);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa el nombre." };
  const supabase = await crearClienteServidor();
  const nombre = r.data.tabla === "tallas" ? r.data.nombre.toUpperCase() : r.data.nombre;
  const { data: igual } = await supabase.from(r.data.tabla).select("*").ilike("nombre", exacto(nombre)).limit(1).maybeSingle();
  if (igual) return { opcion: { id: igual.id, nombre: igual.nombre, hex: igual.hex ?? null, orden: igual.orden ?? undefined } };
  const fila: Record<string, unknown> = { nombre };
  if (r.data.tabla === "tallas") {
    const { data: ultima } = await supabase.from("tallas").select("orden").order("orden", { ascending: false }).limit(1).maybeSingle();
    fila.orden = Number(ultima?.orden ?? 0) + 10;
  }
  if (r.data.tabla === "colores") fila.hex = r.data.hex;
  const { data, error } = await supabase.from(r.data.tabla).insert(fila).select("*").single();
  if (error) return { error: mensajeError(error) };
  revalidatePath("/productos", "layout");
  return { opcion: { id: data.id, nombre: data.nombre, hex: data.hex ?? null, orden: data.orden ?? undefined } };
}
