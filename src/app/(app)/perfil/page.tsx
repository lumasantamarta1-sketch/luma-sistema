import type { Metadata } from "next";
import Link from "next/link";
import { exigirSesion } from "@/lib/sesion";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";
import { FormularioPerfil } from "./formulario";

export const metadata: Metadata = { title: "Mi perfil" };

export default async function PaginaPerfil() {
  const sesion = await exigirSesion();
  return (
    <>
      <Encabezado titulo="Mi perfil" descripcion={sesion.correo ?? undefined} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta><FormularioPerfil nombre={sesion.nombre} /></Tarjeta>
        <Tarjeta>
          <h2 className="font-semibold text-morado">Acceso</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-suave">Rol</dt><dd className="font-semibold">{sesion.rolNombre}</dd>
            <dt className="text-suave">Puntos de venta</dt>
            <dd className="font-semibold">{sesion.bodegas.map((b) => b.nombre).join(", ") || "Ninguno"}</dd>
          </dl>
          <Link href="/cambiar-clave" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-borde px-4 font-semibold text-morado hover:bg-morado-50">
            Cambiar contraseña
          </Link>
        </Tarjeta>
      </div>
    </>
  );
}
