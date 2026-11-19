import Link from "next/link";
import { cn } from "@/lib/utilidades";

export function PestanasVentas({ actual, permisos }: { actual: string; permisos: string[] }) {
  const p = (...c: string[]) => c.some((x) => permisos.includes(x));
  const items = [
    { ruta: "/ventas", titulo: "Ventas", ver: true },
    { ruta: "/ventas/pedidos", titulo: "Pedidos por entregar", ver: p("ventas.entregar", "ventas.crear") },
    { ruta: "/ventas/descuentos", titulo: "Descuentos", ver: p("descuentos.autorizar") },
  ].filter((i) => i.ver);
  if (items.length < 2) return null;
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-borde" aria-label="Ventas">
      {items.map((i) => (
        <Link key={i.ruta} href={i.ruta} aria-current={actual === i.ruta ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold",
                            actual === i.ruta ? "bg-morado text-white" : "text-suave hover:bg-morado-50")}>{i.titulo}</Link>
      ))}
    </nav>
  );
}
