import { cn } from "@/lib/utilidades";
import { Tarjeta } from "@/components/ui/tarjeta";

// Tarjeta con un indicador: título, cifra grande y un detalle opcional
export function Cifra({ titulo, valor, detalle, etiqueta, tono = "normal" }: {
  titulo: string; valor: string; detalle?: React.ReactNode; etiqueta?: string; tono?: "normal" | "alerta" | "error";
}) {
  return (
    <Tarjeta className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-suave">{titulo}</p>
      <p className={cn("cifra font-titulo text-2xl font-semibold",
                       tono === "alerta" ? "text-naranja" : tono === "error" ? "text-error" : "text-morado")}>{valor}</p>
      {etiqueta && <p className="text-xs text-suave">{etiqueta}</p>}
      {detalle && <p className="text-xs text-suave">{detalle}</p>}
    </Tarjeta>
  );
}
