"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

const uuid = z.string().uuid();
const texto = (datos: FormData, k: string) => String(datos.get(k) ?? "").trim();

function refrescar() {
  revalidatePath("/caja", "layout");
  revalidatePath("/");
}

// Aportes, retiros, traslados y saldos iniciales. La clave evita registrarlo dos veces.
export async function registrarMovimiento(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("caja.gestionar");
  const r = z.object({
    tipo: z.enum(["aporte", "retiro", "traslado", "saldo_inicial"], { message: "Elige el tipo de movimiento." }),
    cuenta: z.string().uuid("Elige la cuenta."),
    destino: uuid.nullable(),
    valor: z.number().positive("El valor debe ser mayor que cero.").max(1_000_000_000, "El valor es demasiado alto."),
    descripcion: z.string().min(1, "Describe el movimiento.").max(300),
    clave: z.string().uuid("Recarga la página e inténtalo de nuevo."),
  }).safeParse({
    tipo: texto(datos, "tipo"), cuenta: texto(datos, "cuenta_id"), destino: texto(datos, "cuenta_destino") || null,
    valor: Number(texto(datos, "valor") || 0), descripcion: texto(datos, "descripcion"), clave: texto(datos, "clave"),
  });
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos." };
  const m = r.data;
  if (m.tipo === "traslado" && (!m.destino || m.destino === m.cuenta)) return { error: "Elige una cuenta de destino distinta." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("movimiento_caja", {
    p_tipo: m.tipo, p_cuenta: m.cuenta, p_valor: m.valor, p_descripcion: m.descripcion, p_clave: m.clave,
    p_cuenta_destino: m.tipo === "traslado" ? m.destino : null,
  });
  if (error) return { error: mensajeError(error) };
  refrescar();
  return { exito: "Movimiento registrado." };
}

// Cierre del día: lo contado contra lo esperado; una diferencia exige explicación y queda en el libro
export async function cerrarCaja(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("caja.cerrar");
  const cuenta = uuid.safeParse(datos.get("cuenta_id"));
  if (!cuenta.success) return { error: "Caja no válida." };
  const contadoTexto = texto(datos, "contado");
  const contado = Number(contadoTexto);
  if (contadoTexto === "" || !Number.isFinite(contado) || contado < 0) return { error: "Escribe cuánto efectivo contaste." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cerrar_caja", {
    p_cuenta: cuenta.data, p_contado: contado, p_justificacion: texto(datos, "justificacion") || null,
  });
  if (error) return { error: mensajeError(error) };
  refrescar();
  return { exito: "Cierre registrado." };
}

// Cuentas (Nequi, banco…) y métodos de pago. La caja de efectivo de cada punto se crea sola.
export async function crearCuenta(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("configuracion.gestionar");
  const nombre = texto(datos, "nombre");
  const tipo = texto(datos, "tipo");
  if (!nombre) return { error: "Escribe el nombre de la cuenta." };
  if (!["nequi", "banco", "otro"].includes(tipo)) return { error: "Elige el tipo de cuenta." };
  const supabase = await crearClienteServidor();
  // Solo el nombre: nunca se guardan números de cuenta
  const { data, error } = await supabase.from("cuentas_dinero").insert({ nombre, tipo }).select("id").single();
  if (error) return { error: error.code === "23505" ? "Ya existe una cuenta con ese nombre." : mensajeError(error) };
  if (datos.get("con_metodo") === "on") {
    const tipoMetodo = tipo === "nequi" ? "nequi" : tipo === "banco" ? "transferencia" : "otro";
    const { error: errorMetodo } = await supabase.from("metodos_pago").insert({ nombre, tipo: tipoMetodo, cuenta_id: data.id });
    if (errorMetodo) return { error: errorMetodo.code === "23505" ? "La cuenta se creó, pero ya existe un método de pago con ese nombre." : mensajeError(errorMetodo) };
  }
  revalidatePath("/caja", "layout");
  revalidatePath("/ventas", "layout");
  return { exito: `Cuenta «${nombre}» creada.` };
}

export async function cambiarCuenta(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("configuracion.gestionar");
  const id = uuid.safeParse(datos.get("id"));
  if (!id.success) return { error: "Cuenta no válida." };
  const supabase = await crearClienteServidor();
  const esMetodo = datos.get("tabla") === "metodo";
  const activar = datos.get("activo") === "true";
  if (!esMetodo && !activar) {
    // La caja de un punto no se apaga aquí, y una cuenta con dinero primero se vacía con un traslado
    const { data: cuenta } = await supabase.from("cuentas_dinero").select("tipo").eq("id", id.data).maybeSingle();
    if (cuenta?.tipo === "efectivo") return { error: "La caja de efectivo de un punto se maneja con el punto de venta." };
    const { data: saldos } = await supabase.rpc("saldos_cuentas");
    const saldo = Number((saldos as { cuenta_id: string; saldo: number }[] | null)?.find((x) => x.cuenta_id === id.data)?.saldo ?? 0);
    if (saldo !== 0) return { error: "La cuenta tiene saldo: trasládalo a otra cuenta antes de desactivarla." };
  }
  const { error } = await supabase.from(esMetodo ? "metodos_pago" : "cuentas_dinero").update({ activo: activar }).eq("id", id.data);
  if (error) return { error: mensajeError(error) };
  revalidatePath("/caja", "layout");
  revalidatePath("/ventas", "layout");
  return { exito: "Cambio guardado." };
}
