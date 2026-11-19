"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string; compraId?: string };

const uuid = z.string().uuid();
const texto = (datos: FormData, k: string) => String(datos.get(k) ?? "").trim();

function refrescar(id?: string) {
  revalidatePath("/compras", "layout");
  revalidatePath("/inventario", "layout");
  revalidatePath("/caja", "layout");
  revalidatePath("/proveedores");
  revalidatePath("/");
  if (id) revalidatePath(`/compras/${id}`);
}

// Tras una operación se vuelve a la compra (o a la recepción, para quien no ve costos)
function volverCon(datos: FormData, compraId: string, hecho: string): never {
  const base = datos.get("volver") === "recibir" ? `/compras/${compraId}/recibir` : `/compras/${compraId}`;
  redirect(`${base}?hecho=${hecho}`, RedirectType.replace);
}

const esquemaCompra = z.object({
  compra_id: uuid.nullable(),
  proveedor_id: z.string().uuid("Elige el proveedor."),
  bodega_id: z.string().uuid("Elige a qué punto llega la mercancía."),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida."),
  forma_pago: z.string().trim().max(80),
  observaciones: z.string().trim().max(500),
  lineas: z.array(z.object({
    variante_id: uuid,
    cantidad: z.number().positive("La cantidad debe ser mayor que cero."),
    costo_unitario: z.number().nonnegative("El costo no puede ser negativo."),
    descuento: z.number().nonnegative(),
    impuesto_pct: z.number().min(0).max(100),
  })).min(1, "Agrega al menos un producto."),
  costos_adicionales: z.array(z.object({
    concepto: z.string().trim().min(1, "Escribe el concepto del costo adicional.").max(120),
    valor: z.number().positive("El costo adicional debe ser mayor que cero."),
  })),
});

// Guarda el borrador y, si se pidió, lo confirma (y recibe todo) en el mismo paso
export async function guardarCompra(anterior: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("compras.gestionar");
  let crudo: unknown;
  try { crudo = JSON.parse(texto(datos, "datos") || "{}"); } catch { return { error: "No se pudieron leer los datos de la compra." }; }
  const r = esquemaCompra.safeParse(crudo);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos de la compra.", compraId: anterior.compraId };
  const { compra_id, ...p_datos } = r.data;
  const accion = texto(datos, "accion");
  const supabase = await crearClienteServidor();
  const { data: id, error } = await supabase.rpc("guardar_compra", { p_compra: compra_id, p_datos });
  if (error) return { error: mensajeError(error), compraId: compra_id ?? undefined };
  const compraId = String(id);
  if (accion === "confirmar" || accion === "recibir") {
    const clave = uuid.safeParse(datos.get("clave"));
    const { error: errorConfirmar } = await supabase.rpc("confirmar_compra", {
      p_compra: compraId, p_recibir: accion === "recibir", p_clave: clave.success ? clave.data : null,
    });
    if (errorConfirmar) {
      refrescar(compraId);
      return { error: `${mensajeError(errorConfirmar)} La compra quedó guardada como borrador.`, compraId };
    }
  }
  refrescar(compraId);
  redirect(`/compras/${compraId}?hecho=${accion === "recibir" ? "recibida" : accion === "confirmar" ? "confirmada" : "guardada"}`);
}

export async function confirmarCompra(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("compras.gestionar");
  const compra = uuid.safeParse(datos.get("compra_id"));
  if (!compra.success) return { error: "Compra no válida." };
  const recibir = datos.get("recibir") === "on";
  const clave = uuid.safeParse(datos.get("clave"));
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("confirmar_compra", { p_compra: compra.data, p_recibir: recibir, p_clave: clave.success ? clave.data : null });
  if (error) return { error: mensajeError(error) };
  refrescar(compra.data);
  volverCon(datos, compra.data, recibir ? "recibida" : "confirmada");
}

// Recepción por líneas: cantidades en campos recibir__<id>; la clave evita recibir dos veces
export async function recibirCompra(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("compras.recibir", "compras.gestionar");
  const compra = uuid.safeParse(datos.get("compra_id"));
  const clave = uuid.safeParse(datos.get("clave"));
  if (!compra.success || !clave.success) return { error: "Compra no válida." };
  const lineas: { compra_linea_id: string; cantidad: number }[] = [];
  for (const [k, v] of datos.entries()) {
    const [campo, lineaId] = k.split("__");
    if (campo !== "recibir" || !uuid.safeParse(lineaId).success) continue;
    const n = Number(String(v).trim() || 0);
    if (!Number.isFinite(n) || n < 0) return { error: "Revisa las cantidades recibidas." };
    if (n > 0) lineas.push({ compra_linea_id: lineaId, cantidad: n });
  }
  if (!lineas.length) return { error: "Indica cuántas unidades llegaron." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("recibir_compra", { p_compra: compra.data, p_clave: clave.data, p_lineas: lineas });
  if (error) return { error: mensajeError(error) };
  refrescar(compra.data);
  volverCon(datos, compra.data, "recibida");
}

export async function pagarCompra(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("compras.pagar");
  const compra = uuid.safeParse(datos.get("compra_id"));
  const cuenta = uuid.safeParse(datos.get("cuenta_id"));
  const clave = uuid.safeParse(datos.get("clave"));
  const valor = Number(texto(datos, "valor") || 0);
  const tipo = datos.get("tipo") === "reembolso" ? "reembolso" : "pago";
  if (!compra.success || !clave.success) return { error: "Compra no válida." };
  if (!cuenta.success) return { error: "Elige la cuenta." };
  if (!(valor > 0)) return { error: "El valor debe ser mayor que cero." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_pago_compra", {
    p_compra: compra.data, p_cuenta: cuenta.data, p_valor: valor, p_referencia: texto(datos, "referencia") || null,
    p_clave: clave.data, p_tipo: tipo,
  });
  if (error) return { error: mensajeError(error) };
  refrescar(compra.data);
  volverCon(datos, compra.data, tipo);
}

export async function anularCompra(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("compras.gestionar");
  const compra = uuid.safeParse(datos.get("compra_id"));
  if (!compra.success) return { error: "Compra no válida." };
  const motivo = texto(datos, "motivo");
  if (!motivo) return { error: "Escribe el motivo de la anulación." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("anular_compra", { p_compra: compra.data, p_motivo: motivo });
  if (error) return { error: mensajeError(error) };
  refrescar(compra.data);
  volverCon(datos, compra.data, "anulada");
}

// Devolución al proveedor: cantidades en devolver__<id>; reduce lo que se le debe
export async function devolverAProveedor(_: Estado, datos: FormData): Promise<Estado> {
  const sesion = await exigirPermiso("compras.gestionar");
  const compra = uuid.safeParse(datos.get("compra_id"));
  const clave = uuid.safeParse(datos.get("clave"));
  if (!compra.success || !clave.success) return { error: "Compra no válida." };
  const motivo = texto(datos, "motivo");
  if (!motivo) return { error: "Escribe el motivo de la devolución." };
  const lineas: { compra_linea_id: string; cantidad: number }[] = [];
  for (const [k, v] of datos.entries()) {
    const [campo, lineaId] = k.split("__");
    if (campo !== "devolver" || !uuid.safeParse(lineaId).success) continue;
    const n = Number(String(v).trim() || 0);
    if (n > 0) lineas.push({ compra_linea_id: lineaId, cantidad: n });
  }
  if (!lineas.length) return { error: "Indica cuántas unidades se devuelven." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_devolucion_proveedor", { p_compra: compra.data, p_datos: { motivo, clave: clave.data, lineas } });
  if (error) return { error: mensajeError(error) };
  refrescar(compra.data);
  if (!tiene(sesion, "compras.ver")) return { exito: "Devolución registrada." };
  volverCon(datos, compra.data, "devolucion");
}
