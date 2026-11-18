import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sin permiso" };

export default function PaginaSinPermiso() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-borde bg-white p-6 text-center">
        <h1 className="text-xl font-semibold text-morado">No tienes permiso para esta sección</h1>
        <p className="mt-2 text-suave">Si la necesitas para tu trabajo, pídele al administrador que la agregue a tu rol.</p>
        <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-morado px-4 font-semibold text-white">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
