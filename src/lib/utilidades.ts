import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...clases: ClassValue[]) {
  return twMerge(clsx(clases));
}

// Pesos sin decimales: $ 1.250.000
export function pesos(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return "$ " + new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(n));
}

// Fecha dd/mm/aaaa en hora de Colombia
export function fecha(valor: string | Date | null | undefined) {
  if (!valor) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(valor));
}

// Postgres escribe los numeric con punto decimal: 7.000 (cantidades, 3 decimales) y 35000.00 (dinero, 2).
// En Colombia "7.000" se lee siete mil, así que se reescriben como 7 y $ 35.000.
function cifrasLegibles(m: string) {
  return m
    .replace(/(?<![\d.])(-?\d+)\.(\d{3})(?!\d)/g, (_, e: string, d: string) => String(Number(`${e}.${d}`)).replace(".", ","))
    .replace(/(?<![\d.])(-?\d+)\.(\d{2})(?!\d)/g, (_, e: string, d: string) => pesos(`${e}.${d}`));
}

// Traduce los errores de Postgres y de Auth a mensajes claros
export function mensajeError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Ocurrió un error inesperado.";
  const m = error.message ?? "";
  if (m.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("Email not confirmed")) return "El correo aún no está confirmado.";
  if (m.includes("User already registered") || m.includes("already been registered")) return "Ya existe un usuario con ese correo.";
  if (m.includes("Password should be") || m.includes("weak")) return "La contraseña es muy débil: usa al menos 8 caracteres.";
  if (m.includes("rate limit")) return "Demasiados intentos. Espera unos minutos.";
  // Los mensajes de Postgres y de RLS son técnicos; los de nuestras funciones ya vienen en español
  if (m.includes("permission denied") || m.includes("row-level security")) return "No tienes permiso para esta acción.";
  if (error.code === "23505") return "Ya existe un registro con ese dato.";
  if (error.code === "42501") return m ? cifrasLegibles(m) : "No tienes permiso para esta acción.";
  return m ? cifrasLegibles(m) : "Ocurrió un error inesperado.";
}
