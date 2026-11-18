import Link from "next/link";
import { cn } from "@/lib/utilidades";

export function PestanasInventario({ actual, permisos }: { actual: string; permisos: string[] }) {
  const p = (...c: string[]) => c.some((x) => permisos.includes(x));
  const items = [
    { ruta: "/inventario", titulo: "Existencias", ver: true },
    { ruta: "/inventario/kardex", titulo: "Movimientos", ver: p("inventario.kardex") },
    { ruta: "/inventario/ajustes", titulo: "Ajustes", ver: p("inventario.ajustar", "inventario.aprobar_ajuste", "inventario.kardex") },
    { ruta: "/inventario/traslados", titulo: "Traslados", ver: p("traslados.ver", "traslados.gestionar") },
  ].filter((i) => i.ver);
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-borde" aria-label="Inventario">
      {items.map((i) => (
        <Link key={i.ruta} href={i.ruta} aria-current={actual === i.ruta ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold",
                            actual === i.ruta ? "bg-morado text-white" : "text-suave hover:bg-morado-50")}>{i.titulo}</Link>
      ))}
    </nav>
  );
}
