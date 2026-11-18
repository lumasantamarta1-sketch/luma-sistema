import { cn } from "@/lib/utilidades";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  error?: string;
  ayuda?: string;
};

// Campo con etiqueta siempre visible y mensaje de error accesible
export function Campo({ etiqueta, error, ayuda, id, name, className, ...props }: Props) {
  const idCampo = id ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={idCampo} className="text-sm font-semibold text-tinta">{etiqueta}</label>
      <input
        id={idCampo}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${idCampo}-error` : ayuda ? `${idCampo}-ayuda` : undefined}
        className={cn(
          "min-h-11 rounded-xl border border-borde bg-white px-3 text-base outline-none transition focus:border-morado",
          error && "border-error",
          className,
        )}
        {...props}
      />
      {ayuda && !error && <p id={`${idCampo}-ayuda`} className="text-sm text-suave">{ayuda}</p>}
      {error && <p id={`${idCampo}-error`} className="text-sm text-error">{error}</p>}
    </div>
  );
}

type PropsSelector = React.SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; error?: string };

export function Selector({ etiqueta, error, id, name, className, children, ...props }: PropsSelector) {
  const idCampo = id ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={idCampo} className="text-sm font-semibold text-tinta">{etiqueta}</label>
      <select
        id={idCampo}
        name={name}
        aria-invalid={Boolean(error)}
        className={cn("min-h-11 rounded-xl border border-borde bg-white px-3 text-base outline-none focus:border-morado", className)}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
