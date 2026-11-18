import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utilidades";

// El color nunca es la única señal: cada aviso lleva ícono y texto
export function Aviso({ tipo = "error", children }: { tipo?: "error" | "exito" | "info"; children: React.ReactNode }) {
  const Icono = tipo === "exito" ? CircleCheck : CircleAlert;
  return (
    <div
      role={tipo === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
        tipo === "error" && "border-error/30 bg-error/5 text-error",
        tipo === "exito" && "border-turquesa/40 bg-turquesa/10 text-morado",
        tipo === "info" && "border-morado-100 bg-morado-50 text-morado",
      )}
    >
      <Icono className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
