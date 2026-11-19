import { cn } from "@/lib/utilidades";

export function Tarjeta({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-2xl border border-borde bg-white p-4 sm:p-5 print:break-inside-avoid", className)}>{children}</section>;
}

export function Encabezado({ titulo, descripcion, acciones }: { titulo: string; descripcion?: string; acciones?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-morado">{titulo}</h1>
        {descripcion && <p className="mt-1 text-suave">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2 print:hidden">{acciones}</div>}
    </header>
  );
}

export function Insignia({ tono = "neutro", children }: { tono?: "neutro" | "exito" | "alerta" | "error" | "marca"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        tono === "neutro" && "bg-morado-50 text-suave",
        tono === "exito" && "bg-turquesa/15 text-morado",
        tono === "alerta" && "bg-naranja/15 text-morado",
        tono === "error" && "bg-error/10 text-error",
        tono === "marca" && "bg-amarillo/30 text-morado",
      )}
    >
      {children}
    </span>
  );
}
