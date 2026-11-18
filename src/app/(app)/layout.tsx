import { exigirSesion, tiene } from "@/lib/sesion";
import { menuPara } from "@/lib/menu";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Marco } from "@/components/app/marco";

export default async function LayoutAplicacion({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion();
  const supabase = await crearClienteServidor();
  const { data: config } = await supabase
    .from("configuracion_negocio")
    .select("minutos_inactividad")
    .maybeSingle();

  return (
    <Marco
      grupos={menuPara(sesion.permisos)}
      nombre={sesion.nombre || sesion.correo || "Usuario"}
      rol={sesion.rolNombre ?? ""}
      puedeVender={tiene(sesion, "ventas.crear")}
      minutosInactividad={config?.minutos_inactividad ?? 30}
    >
      {children}
    </Marco>
  );
}
