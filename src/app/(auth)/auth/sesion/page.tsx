import type { Metadata } from "next";
import { AbrirSesion } from "./abrir-sesion";

export const metadata: Metadata = { title: "Abriendo tu sesión" };

// Destino del enlace de "Olvidé mi contraseña". Los datos de la sesión llegan después del #
// (no viajan al servidor), así que se leen en el navegador.
export default function PaginaSesion() {
  return <AbrirSesion />;
}
