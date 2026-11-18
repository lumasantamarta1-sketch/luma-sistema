import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { salir } from "@/app/acciones-sesion";
import { Boton } from "@/components/ui/boton";

export const metadata: Metadata = { title: "Sin acceso" };

export default async function PaginaSinAcceso() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/ingresar");
  if (sesion.activo && sesion.rol) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-borde bg-white p-6 text-center">
        <h1 className="text-xl font-semibold text-morado">Tu usuario aún no tiene acceso</h1>
        <p className="mt-2 text-suave">
          {sesion.activo
            ? "El administrador todavía no te asigna un rol. Pídele que lo haga y vuelve a ingresar."
            : "Tu usuario está desactivado. Habla con el administrador."}
        </p>
        <form action={async () => { "use server"; await salir(); }} className="mt-5">
          <Boton type="submit" variante="secundario">Salir</Boton>
        </form>
      </div>
    </main>
  );
}
