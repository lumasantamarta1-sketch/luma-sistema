import type { Metadata } from "next";
import { FormularioIngreso } from "./formulario";

export const metadata: Metadata = { title: "Ingresar" };

export default async function PaginaIngreso({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const aviso =
    motivo === "inactividad" ? "Tu sesión se cerró por inactividad. Ingresa de nuevo."
    : motivo === "enlace" ? "El enlace no es válido o ya venció. Pide uno nuevo o ingresa con tu contraseña."
    : undefined;
  return <FormularioIngreso aviso={aviso} />;
}
