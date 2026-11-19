"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";
import { pagadoNeto, saldoVenta } from "@/lib/ventas";

export type Estado = { error?: string; exito?: string; ventaId?: string };

const uuid = z.string().uuid();
const esquemaPago = z.object({
  metodo_pago_id: z.string().uuid("Elige el método de pago."),
  valor: z.number().positive("El valor del pago debe ser mayor que cero."),
  referencia: z.string().trim().max(120).optional(),
  clave: z.string().uuid(),
});
const esquemaVenta = z.object({
  venta_id: uuid.nullable(),
  bodega_id: z.string().uuid("Elige el punto de venta."),
  cliente_id: uuid.nullable(),
  observaciones: z.string().trim().max(500),
  lineas: z.array(z.object({
    variante_id: uuid,
    cantidad: z.number().positive("La cantidad debe ser mayor que cero."),
    precio_unitario: z.number().nonnegative().optional(),
    descuento: z.number().nonnegative().optional(),
    descuento_autorizado_id: uuid.nullable().optional(),
    personalizacion: z.string().trim().max(500).optional(),
  })).min(1, "Agrega al menos un producto."),
  pagos: z.array(esquemaPago),
  entregar: z.boolean().optional(),
});

function refrescar(ventaId?: string) {
  revalidatePath("/ventas", "layout");
  revalidatePath("/inventario", "layout");
  revalidatePath("/estampado", "layout");
  revalidatePath("/");
  if (ventaId) revalidatePath(`/ventas/${ventaId}`);
}

// Tras una operación se vuelve a la venta (o a la lista de pedidos) con un aviso de lo que se hizo.
// Solo se aceptan esos dos destinos.
function volverCon(datos: FormData, ventaId: string, hecho: string): never {
  const base = datos.get("volver") === "/ventas/pedidos" ? "/ventas/pedidos" : `/ventas/${ventaId}`;
  redirect(`${base}?hecho=${hecho}`, RedirectType.replace);
}

// Por qué no se pudo entregar en el mismo paso (se muestra en el detalle de la venta)
function motivoSinEntregar(mensaje: string) {
  if (mensaje.includes("saldo pendiente")) return "credito";
  if (mensaje.includes("sin apartar") || mensaje.includes("por estampar")) return "pendientes";
  return "entrega";
}

// Guarda la cotización y, si se pidió, la confirma con los pagos recibidos y la entrega.
// Si la confirmación falla, la cotización ya quedó guardada: se devuelve su id para no duplicarla.
export async function guardarVenta(anterior: Estado, datos: FormData): Promise<Estado> {
  const sesion = await exigirPermiso("ventas.crear");
  let crudo: unknown;
  try { crudo = JSON.parse(String(datos.get("datos") ?? "{}")); } catch { return { error: "No se pudieron leer los datos de la venta." }; }
  const r = esquemaVenta.safeParse(crudo);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos de la venta.", ventaId: anterior.ventaId };
  const v = r.data;
  const confirmar = datos.get("accion") === "confirmar";
  const clave = uuid.safeParse(datos.get("clave"));
  if (confirmar && !clave.success) return { error: "Falta la clave de confirmación; recarga la página.", ventaId: v.venta_id ?? undefined };
  const supabase = await crearClienteServidor();

  // Si esta misma confirmación ya entró (por ejemplo, se perdió la respuesta), no se repite la venta
  if (confirmar && clave.success) {
    const { data: previa } = await supabase.from("ventas").select("id").eq("clave_confirmacion", clave.data).maybeSingle();
    if (previa) redirect(`/ventas/${previa.id}`);
  }

  const { data: id, error } = await supabase.rpc("guardar_cotizacion", {
    p_venta: v.venta_id,
    p_datos: {
      bodega_id: v.bodega_id, cliente_id: v.cliente_id, observaciones: v.observaciones,
      lineas: v.lineas.map((l) => ({
        variante_id: l.variante_id, cantidad: l.cantidad, personalizacion: l.personalizacion || null,
        ...(l.precio_unitario !== undefined && tiene(sesion, "precios.gestionar") ? { precio_unitario: l.precio_unitario } : {}),
        ...(l.descuento_autorizado_id ? { descuento_autorizado_id: l.descuento_autorizado_id } : {}),
        ...(l.descuento !== undefined && l.descuento > 0 && !l.descuento_autorizado_id ? { descuento: l.descuento } : {}),
      })),
    },
  });
  if (error) return { error: mensajeError(error), ventaId: v.venta_id ?? undefined };
  const ventaId = String(id);
  if (!confirmar || !clave.success) {
    refrescar(ventaId);
    redirect(`/ventas/${ventaId}`);
  }

  const pagos = tiene(sesion, "ventas.cobrar") ? v.pagos : [];
  const { error: errorConfirmar } = await supabase.rpc("confirmar_venta", { p_venta: ventaId, p_clave: clave.data, p_pagos: pagos });
  if (errorConfirmar) {
    refrescar(ventaId);
    return { error: `${mensajeError(errorConfirmar)} La cotización quedó guardada: corrige y vuelve a confirmar.`, ventaId };
  }

  let aviso = "";
  if (v.entregar && tiene(sesion, "ventas.entregar")) {
    const { error: errorEntrega } = await supabase.rpc("entregar_venta", { p_venta: ventaId });
    if (errorEntrega) aviso = `?aviso=${motivoSinEntregar(errorEntrega.message ?? "")}`;
  }
  refrescar(ventaId);
  redirect(`/ventas/${ventaId}${aviso}`);
}

// Confirma una cotización desde su detalle, con un anticipo opcional
export async function confirmarCotizacion(_: Estado, datos: FormData): Promise<Estado> {
  const sesion = await exigirPermiso("ventas.crear");
  const venta = uuid.safeParse(datos.get("venta_id"));
  const clave = uuid.safeParse(datos.get("clave"));
  if (!venta.success || !clave.success) return { error: "Venta no válida." };
  const pagos: z.infer<typeof esquemaPago>[] = [];
  if (Number(datos.get("valor") || 0) > 0 && tiene(sesion, "ventas.cobrar")) {
    const pago = esquemaPago.safeParse({
      metodo_pago_id: datos.get("metodo_pago_id"), valor: Number(datos.get("valor")),
      referencia: String(datos.get("referencia") ?? ""), clave: datos.get("clave_pago"),
    });
    if (!pago.success) return { error: pago.error.issues[0]?.message };
    pagos.push(pago.data);
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("confirmar_venta", { p_venta: venta.data, p_clave: clave.data, p_pagos: pagos });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "confirmada");
}

function leerPago(datos: FormData) {
  return esquemaPago.safeParse({
    metodo_pago_id: datos.get("metodo_pago_id"), valor: Number(datos.get("valor") || 0),
    referencia: String(datos.get("referencia") ?? ""), clave: datos.get("clave"),
  });
}

export async function registrarPago(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("ventas.cobrar");
  const venta = uuid.safeParse(datos.get("venta_id"));
  const pago = leerPago(datos);
  if (!venta.success) return { error: "Venta no válida." };
  if (!pago.success) return { error: pago.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_pago_venta", {
    p_venta: venta.data, p_metodo: pago.data.metodo_pago_id, p_valor: pago.data.valor,
    p_referencia: pago.data.referencia || null, p_clave: pago.data.clave, p_tipo: "pago",
  });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "pago");
}

// Devuelve dinero a favor del cliente (anticipo de una venta anulada o saldo a favor)
export async function registrarReembolso(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("ventas.devolver", "ventas.anular");
  const venta = uuid.safeParse(datos.get("venta_id"));
  const pago = leerPago(datos);
  if (!venta.success) return { error: "Venta no válida." };
  if (!pago.success) return { error: pago.error.issues[0]?.message };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_pago_venta", {
    p_venta: venta.data, p_metodo: pago.data.metodo_pago_id, p_valor: pago.data.valor,
    p_referencia: pago.data.referencia || null, p_clave: pago.data.clave, p_tipo: "reembolso",
  });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "reembolso");
}

export async function apartarVenta(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("ventas.crear", "ventas.entregar");
  const venta = uuid.safeParse(datos.get("venta_id"));
  if (!venta.success) return { error: "Venta no válida." };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("apartar_venta", { p_venta: venta.data });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  if (Number(data ?? 0) > 0) volverCon(datos, venta.data, "apartada");
  return { error: "Todavía no hay unidades suficientes en el punto para completar los productos pendientes." };
}

export async function entregarVenta(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("ventas.entregar");
  const venta = uuid.safeParse(datos.get("venta_id"));
  if (!venta.success) return { error: "Venta no válida." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("entregar_venta", { p_venta: venta.data });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "entregada");
}

export async function anularVenta(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("ventas.crear", "ventas.anular");
  const venta = uuid.safeParse(datos.get("venta_id"));
  if (!venta.success) return { error: "Venta no válida." };
  const motivo = String(datos.get("motivo") ?? "").trim();
  if (!motivo) return { error: "Escribe el motivo de la anulación." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("anular_venta", { p_venta: venta.data, p_motivo: motivo });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "anulada");
}

// Ordena el estampado de los productos personalizados que quedaron sin orden activa
export async function ordenarEstampado(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("estampado.gestionar");
  const venta = uuid.safeParse(datos.get("venta_id"));
  if (!venta.success) return { error: "Venta no válida." };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("ordenar_estampado_venta", { p_venta: venta.data });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  if (data) redirect(`/estampado/${data}`);
  return { exito: "No había productos pendientes por estampar." };
}

// Devolución de un cliente: qué líneas, cuántas, en qué estado y si se le devuelve dinero
export async function registrarDevolucion(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("ventas.devolver");
  const venta = uuid.safeParse(datos.get("venta_id"));
  const clave = uuid.safeParse(datos.get("clave"));
  if (!venta.success || !clave.success) return { error: "Venta no válida." };
  const motivo = String(datos.get("motivo") ?? "").trim();
  if (!motivo) return { error: "Escribe el motivo de la devolución." };
  const lineas: { venta_linea_id: string; cantidad: number; condicion: string }[] = [];
  for (const [k, valor] of datos.entries()) {
    const [campo, lineaId] = k.split("__");
    if (campo !== "devolver" || !lineaId) continue;
    const n = Number(String(valor).trim() || 0);
    if (n > 0) lineas.push({ venta_linea_id: lineaId, cantidad: n, condicion: datos.get(`condicion__${lineaId}`) === "danada" ? "danada" : "buena" });
  }
  if (!lineas.length) return { error: "Indica cuántas unidades devuelve el cliente." };
  const p_datos: Record<string, unknown> = { clave: clave.data, motivo, lineas };
  const valorReembolso = Number(datos.get("reembolso_valor") || 0);
  if (valorReembolso > 0) {
    const metodo = uuid.safeParse(datos.get("reembolso_metodo"));
    if (!metodo.success) return { error: "Elige con qué método se devuelve el dinero." };
    const claveReembolso = uuid.safeParse(datos.get("reembolso_clave"));
    p_datos.reembolso = {
      metodo_pago_id: metodo.data, valor: valorReembolso, clave: claveReembolso.success ? claveReembolso.data : null,
      referencia: String(datos.get("reembolso_referencia") ?? "").trim() || null,
    };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_devolucion_venta", { p_venta: venta.data, p_datos });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "devolucion");
}

// El administrador autoriza un descuento solo para esta cotización
export async function autorizarDescuentoPuntual(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("descuentos.autorizar");
  const venta = uuid.safeParse(datos.get("venta_id"));
  if (!venta.success) return { error: "Venta no válida." };
  const forma = String(datos.get("forma"));
  const valor = Number(datos.get("valor") || 0);
  if (!(valor > 0)) return { error: "Indica el valor del descuento." };
  if (forma === "porcentaje" && valor > 100) return { error: "El porcentaje no puede pasar de 100." };
  const nombre = String(datos.get("nombre") ?? "").trim() || "Descuento autorizado";
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("descuentos_autorizados").insert({
    tipo: "puntual", nombre, venta_id: venta.data,
    porcentaje: forma === "porcentaje" ? valor : null,
    valor_por_unidad: forma === "unidad" ? valor : null,
    valor_total: forma === "total" ? valor : null,
  });
  if (error) return { error: mensajeError(error) };
  refrescar(venta.data);
  volverCon(datos, venta.data, "descuento");
}

// Promociones que cualquier vendedora puede aplicar mientras estén vigentes
const esquemaPromocion = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre de la promoción.").max(120),
  forma: z.enum(["porcentaje", "unidad"]),
  valor: z.number().positive("Indica el valor del descuento."),
  producto_id: uuid.nullable(),
  vigente_desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  vigente_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function crearPromocion(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("descuentos.autorizar");
  const texto = (k: string) => String(datos.get(k) ?? "").trim() || null;
  const r = esquemaPromocion.safeParse({
    nombre: String(datos.get("nombre") ?? ""), forma: datos.get("forma"), valor: Number(datos.get("valor") || 0),
    producto_id: texto("producto_id"), vigente_desde: texto("vigente_desde"), vigente_hasta: texto("vigente_hasta"),
  });
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos de la promoción." };
  const p = r.data;
  if (p.forma === "porcentaje" && p.valor > 100) return { error: "El porcentaje no puede pasar de 100." };
  if (p.vigente_desde && p.vigente_hasta && p.vigente_hasta < p.vigente_desde) return { error: "La fecha final debe ser posterior a la inicial." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("descuentos_autorizados").insert({
    tipo: "promocion", nombre: p.nombre, producto_id: p.producto_id,
    porcentaje: p.forma === "porcentaje" ? p.valor : null, valor_por_unidad: p.forma === "unidad" ? p.valor : null,
    vigente_desde: p.vigente_desde, vigente_hasta: p.vigente_hasta,
  });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/ventas", "layout");
  return { exito: "Promoción creada. Ya aparece en el formulario de venta." };
}

export async function cambiarDescuento(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("descuentos.autorizar");
  const id = uuid.safeParse(datos.get("id"));
  if (!id.success) return { error: "Descuento no válido." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("descuentos_autorizados").update({ activo: datos.get("activo") === "true" }).eq("id", id.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/ventas", "layout");
  return { exito: datos.get("activo") === "true" ? "Descuento activado." : "Descuento desactivado." };
}

// ---------------------------------------------------------------------
// Venta rápida: registra, cobra y entrega en un solo paso, sin pasar por cotización.
// Usa las mismas funciones de la base de datos; si algo falla, devuelve el id para reintentar.
// ---------------------------------------------------------------------
export type VentaHecha = {
  ventaId: string; numero: string; total: number; pagado: number; saldo: number;
  entregada: boolean; porEstampar: boolean; faltanUnidades: boolean;
};
export type ResultadoRapida = { error?: string; ventaId?: string; hecho?: VentaHecha };

const esquemaRapida = z.object({
  venta_id: uuid.nullable(),
  bodega_id: z.string().uuid("Elige el punto de venta."),
  cliente_id: uuid.nullable(),
  cliente_nuevo: z.object({
    nombre: z.string().trim().min(1, "Escribe el nombre del cliente.").max(160),
    telefono: z.string().trim().max(40),
  }).nullable(),
  lineas: z.array(z.object({
    variante_id: uuid,
    cantidad: z.number().positive("La cantidad debe ser mayor que cero."),
    descuento_autorizado_id: uuid.nullable(),
    personalizacion: z.string().trim().max(500),
  })).min(1, "Agrega al menos una camiseta."),
  pago: z.object({
    metodo_pago_id: z.string().uuid("Elige cómo paga el cliente."),
    completo: z.boolean(),
    valor: z.number().nonnegative().nullable(),
    referencia: z.string().trim().max(120),
  }).nullable(),
  clave: z.string().uuid(),
  clave_pago: z.string().uuid(),
});

type SupabaseServidor = Awaited<ReturnType<typeof crearClienteServidor>>;

async function leerVentaHecha(supabase: SupabaseServidor, filtro: { id: string } | { clave: string }): Promise<VentaHecha | null> {
  let q = supabase.from("ventas")
    .select("id, numero, estado, estado_entrega, total, pagos_venta(tipo, valor), devoluciones_venta(valor_total), venta_lineas(estado)");
  q = "id" in filtro ? q.eq("id", filtro.id) : q.eq("clave_confirmacion", filtro.clave);
  const { data } = await q.maybeSingle();
  if (!data || data.estado !== "confirmada") return null;
  const lineas = (data.venta_lineas ?? []) as { estado: string }[];
  return {
    ventaId: data.id as string, numero: (data.numero as string | null) ?? "", total: Number(data.total),
    pagado: pagadoNeto(data.pagos_venta as { tipo: string; valor: number }[]),
    saldo: saldoVenta(data as Parameters<typeof saldoVenta>[0]),
    entregada: data.estado_entrega === "entregada",
    porEstampar: lineas.some((l) => l.estado === "por_estampar"),
    faltanUnidades: lineas.some((l) => l.estado === "pendiente"),
  };
}

export async function registrarVentaRapida(entrada: unknown): Promise<ResultadoRapida> {
  const sesion = await exigirPermiso("ventas.crear");
  const r = esquemaRapida.safeParse(entrada);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa la venta." };
  const v = r.data;
  const supabase = await crearClienteServidor();

  // Si esta venta ya quedó registrada (por ejemplo, se tocó dos veces el botón), se devuelve la misma
  const previa = await leerVentaHecha(supabase, { clave: v.clave });
  if (previa) return { hecho: previa };

  // Cliente: si viene uno nuevo se busca por teléfono para no repetirlo; si no existe, se crea
  let clienteId = v.cliente_id;
  let nota = "";
  if (!clienteId && v.cliente_nuevo) {
    const telefono = v.cliente_nuevo.telefono.replace(/[^\d+]/g, "");
    if (telefono) {
      const { data } = await supabase.from("clientes").select("id").eq("telefono", telefono).eq("activo", true).limit(1).maybeSingle();
      if (data) clienteId = data.id as string;
    }
    if (!clienteId && tiene(sesion, "clientes.crear", "clientes.gestionar")) {
      const { data, error } = await supabase.from("clientes")
        .insert({ nombre: v.cliente_nuevo.nombre, telefono: telefono || null }).select("id").single();
      if (error) return { error: mensajeError(error), ventaId: v.venta_id ?? undefined };
      clienteId = data.id as string;
    }
    if (!clienteId) nota = `Cliente: ${v.cliente_nuevo.nombre}${telefono ? ` · ${telefono}` : ""}`;
  }

  const { data: id, error } = await supabase.rpc("guardar_cotizacion", {
    p_venta: v.venta_id,
    p_datos: {
      bodega_id: v.bodega_id, cliente_id: clienteId, observaciones: nota,
      lineas: v.lineas.map((l) => ({
        variante_id: l.variante_id, cantidad: l.cantidad, personalizacion: l.personalizacion || null,
        ...(l.descuento_autorizado_id ? { descuento_autorizado_id: l.descuento_autorizado_id } : {}),
      })),
    },
  });
  if (error) return { error: mensajeError(error), ventaId: v.venta_id ?? undefined };
  const ventaId = String(id);

  // El valor del pago se toma del total que calculó la base de datos
  const pagos: { metodo_pago_id: string; valor: number; clave: string; referencia?: string }[] = [];
  if (v.pago && tiene(sesion, "ventas.cobrar")) {
    const { data: venta } = await supabase.from("ventas").select("total").eq("id", ventaId).maybeSingle();
    const total = Number(venta?.total ?? 0);
    const valor = v.pago.completo ? total : Math.min(Number(v.pago.valor ?? 0), total);
    if (valor > 0) pagos.push({ metodo_pago_id: v.pago.metodo_pago_id, valor, clave: v.clave_pago, ...(v.pago.referencia ? { referencia: v.pago.referencia } : {}) });
  }
  const { error: errorConfirmar } = await supabase.rpc("confirmar_venta", { p_venta: ventaId, p_clave: v.clave, p_pagos: pagos });
  if (errorConfirmar) {
    refrescar(ventaId);
    return { error: mensajeError(errorConfirmar), ventaId };
  }

  // Se entrega en el acto solo si todo está listo y pagado; si quedó saldo, se entrega cuando pague
  let hecho = await leerVentaHecha(supabase, { id: ventaId });
  if (hecho && !hecho.entregada && hecho.saldo <= 0 && !hecho.porEstampar && !hecho.faltanUnidades && tiene(sesion, "ventas.entregar")) {
    const { error: errorEntrega } = await supabase.rpc("entregar_venta", { p_venta: ventaId });
    if (!errorEntrega) hecho = await leerVentaHecha(supabase, { id: ventaId });
  }
  refrescar(ventaId);
  return hecho ? { hecho } : { error: "La venta quedó registrada, pero no se pudo leer. Búscala en Ventas.", ventaId };
}
