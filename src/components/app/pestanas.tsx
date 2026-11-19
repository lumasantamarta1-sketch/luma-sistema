import Link from "next/link";
import { cn } from "@/lib/utilidades";

export type Pestana = { ruta: string; titulo: string; ver?: boolean };

// Pestañas de una sección; se ocultan si solo queda una
export function Pestanas({ actual, items, etiqueta }: { actual: string; items: Pestana[]; etiqueta: string }) {
  const visibles = items.filter((i) => i.ver !== false);
  if (visibles.length < 2) return null;
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-borde" aria-label={etiqueta}>
      {visibles.map((i) => (
        <Link key={i.ruta} href={i.ruta} aria-current={actual === i.ruta ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold",
                            actual === i.ruta ? "bg-morado text-white" : "text-suave hover:bg-morado-50")}>{i.titulo}</Link>
      ))}
    </nav>
  );
}

export function PestanasGastos({ actual, permisos }: { actual: string; permisos: string[] }) {
  const p = (...c: string[]) => c.some((x) => permisos.includes(x));
  return (
    <Pestanas actual={actual} etiqueta="Gastos" items={[
      { ruta: "/gastos", titulo: "Gastos", ver: p("gastos.ver", "gastos.registrar") },
      { ruta: "/gastos/fijos", titulo: "Gastos fijos", ver: p("gastos.ver", "gastos.configurar") },
      { ruta: "/gastos/categorias", titulo: "Categorías", ver: p("gastos.configurar") },
    ]} />
  );
}
