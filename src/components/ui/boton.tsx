import { cn } from "@/lib/utilidades";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "principal" | "secundario" | "fantasma" | "peligro";
  cargando?: boolean;
};

export function Boton({ variante = "principal", cargando, className, children, disabled, ...props }: Props) {
  return (
    <button
      {...props}
      disabled={disabled || cargando}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variante === "principal" && "bg-morado text-white hover:bg-morado-700",
        variante === "secundario" && "border border-borde bg-white text-morado hover:bg-morado-50",
        variante === "fantasma" && "text-morado hover:bg-morado-50",
        variante === "peligro" && "border border-error/30 bg-white text-error hover:bg-error/5",
        className,
      )}
    >
      {cargando && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}
