"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

const uuid = z.string().uuid();
const texto = (datos: FormData, k: string) => String(datos.get(k) ?? "").trim();
const opcional = (datos: FormData, k: string) => texto(datos, k) || null;

function refrescar(id?: string) {
  revalidatePath("/gastos", "layout");
  revalidatePath("/caja", "layout");
  revalidatePath("/");
  if (id) revalidatePath(`/gastos/${id}`);
}

const esquemaGasto = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida."),
  categoria_id: z.string().uuid("Elige la categoría del gasto."),
  descripcion: z.string().min(1, "Describe el gasto.").max(300),
  valor: z.number().positive("El valor debe ser mayor que cero.").max(1_000_000_000, "El valor es demasiado alto."),
  bodega_id: uuid.nullable(),
  proveedor_id: uuid.nullable(),
  beneficiario: z.string().max(160).nullable(),
  pagado: z.boolean(),
  metodo_pago_id: uuid.nullable(),
  referencia: z.string().max(120).nullable(),
  clave: z.string().uuid("Recarga la página e inténtalo de nuevo."),
});

export async function registrarGasto(_: Estado, datos: FormData): Promise<Estado> {
  const sesion = await exigirPermiso("gastos.registrar");
  const r = esquemaGasto.safeParse({
    fecha: texto(datos, "fecha"), categoria_id: texto(datos, "categoria_id"), descripcion: texto(datos, "descripcion"),
    valor: Number(texto(datos, "valor") || 0), bodega_id: opcional(datos, "bodega_id"), proveedor_id: opcional(datos, "proveedor_id"),
    beneficiario: opcional(datos, "beneficiario"), pagado: datos.get("pagado") === "on",
    metodo_pago_id: opcional(datos, "metodo_pago_id"), referencia: opcional(datos, "referencia"), clave: texto(datos, "clave"),
  });
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos del gasto." };
  const g = r.data;
  if (g.pagado && !g.metodo_pago_id) return { error: "Indica con qué se pagó el gasto." };
  const supabase = await crearClienteServidor();
  const { data: id, error } = await supabase.rpc("registrar_gasto", { p_datos: g });
  if (error) return { error: mensajeError(error) };
  refrescar(String(id));
  if (tiene(sesion, "gastos.ver")) redirect(`/gastos/${id}?hecho=registrado`);
  return { exito: "Gasto registrado." };
}

export async function pagarGasto(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("gastos.pagar");
  const gasto = uuid.safeParse(datos.get("gasto_id"));
  const metodo = uuid.safeParse(datos.get("metodo_pago_id"));
  if (!gasto.success) return { error: "Gasto no válido." };
  if (!metodo.success) return { error: "Elige con qué se paga." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("pagar_gasto", { p_gasto: gasto.data, p_metodo: metodo.data, p_referencia: opcional(datos, "referencia") });
  if (error) return { error: mensajeError(error) };
  refrescar(gasto.data);
  redirect(`/gastos/${gasto.data}?hecho=pagado`, RedirectType.replace);
}

export async function anularGasto(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("gastos.anular");
  const gasto = uuid.safeParse(datos.get("gasto_id"));
  if (!gasto.success) return { error: "Gasto no válido." };
  const motivo = texto(datos, "motivo");
  if (!motivo) return { error: "Escribe el motivo de la anulación." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("anular_gasto", { p_gasto: gasto.data, p_motivo: motivo });
  if (error) return { error: mensajeError(error) };
  refrescar(gasto.data);
  redirect(`/gastos/${gasto.data}?hecho=anulado`, RedirectType.replace);
}

// Crea los gastos por pagar del periodo actual a partir de las plantillas recurrentes activas
export async function generarRecurrentes(): Promise<Estado> {
  await exigirPermiso("gastos.registrar");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("generar_gastos_recurrentes", {});
  if (error) return { error: mensajeError(error) };
  refrescar();
  const n = Number(data ?? 0);
  return { exito: n > 0 ? `Se crearon ${n} gasto(s) por pagar de este periodo.` : "Los gastos fijos de este periodo ya estaban creados." };
}

// Categorías: solo las operativas se registran aquí; la mercancía va por Compras
export async function crearCategoria(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("gastos.configurar");
  const nombre = texto(datos, "nombre");
  if (!nombre) return { error: "Escribe el nombre de la categoría." };
  if (nombre.length > 80) return { error: "El nombre es muy largo." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("categorias_gasto").insert({ nombre, tipo: "operativo" });
  if (error) return { error: error.code === "23505" ? "Ya existe una categoría con ese nombre." : mensajeError(error) };
  revalidatePath("/gastos", "layout");
  return { exito: `Categoría «${nombre}» creada.` };
}

export async function cambiarCategoria(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("gastos.configurar");
  const id = uuid.safeParse(datos.get("id"));
  if (!id.success) return { error: "Categoría no válida." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("categorias_gasto").update({ activo: datos.get("activo") === "true" }).eq("id", id.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/gastos", "layout");
  return { exito: datos.get("activo") === "true" ? "Categoría activada." : "Categoría desactivada." };
}

// Gastos fijos (arriendo, servicios, nómina…): cada periodo se crean como gastos por pagar
const esquemaRecurrente = z.object({
  nombre: z.string().min(1, "Escribe el nombre del gasto fijo.").max(120),
  categoria_id: z.string().uuid("Elige la categoría."),
  valor: z.number().positive("El valor debe ser mayor que cero."),
  frecuencia: z.enum(["mensual", "quincenal", "semanal"]),
  dia: z.number().int().min(1).max(31).nullable(),
  proveedor_id: uuid.nullable(),
  beneficiario: z.string().max(160).nullable(),
});

export async function crearRecurrente(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("gastos.configurar");
  const dia = texto(datos, "dia");
  const r = esquemaRecurrente.safeParse({
    nombre: texto(datos, "nombre"), categoria_id: texto(datos, "categoria_id"), valor: Number(texto(datos, "valor") || 0),
    frecuencia: texto(datos, "frecuencia"), dia: dia ? Number(dia) : null, proveedor_id: opcional(datos, "proveedor_id"),
    beneficiario: opcional(datos, "beneficiario"),
  });
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("gastos_recurrentes").insert({ ...r.data, dia: r.data.frecuencia === "mensual" ? r.data.dia : null });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/gastos", "layout");
  return { exito: `Gasto fijo «${r.data.nombre}» creado.` };
}

export async function cambiarRecurrente(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("gastos.configurar");
  const id = uuid.safeParse(datos.get("id"));
  if (!id.success) return { error: "Gasto fijo no válido." };
  const cambios: Record<string, unknown> = {};
  if (datos.has("activo")) cambios.activo = datos.get("activo") === "true";
  if (datos.has("valor")) {
    const valor = Number(texto(datos, "valor") || 0);
    if (!(valor > 0)) return { error: "El valor debe ser mayor que cero." };
    cambios.valor = valor;
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("gastos_recurrentes").update(cambios).eq("id", id.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/gastos", "layout");
  return { exito: "Cambios guardados." };
}
