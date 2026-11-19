import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { restarDias } from "@/lib/periodos";
import { hoyBogota } from "@/lib/ventas";
import { cn } from "@/lib/utilidades";
import { Descargas } from "@/components/app/descargas";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Auditoría" };

// Qué se guardó en cada tabla, en palabras de la operación
const TABLAS: Record<string, string> = {
  sesiones: "Ingresos y salidas", ventas: "Ventas", pagos_venta: "Pagos de ventas", devoluciones_venta: "Devoluciones de clientes",
  compras: "Compras", pagos_compra: "Pagos a proveedores", devoluciones_proveedor: "Devoluciones a proveedores",
  gastos: "Gastos", gastos_recurrentes: "Gastos fijos", categorias_gasto: "Categorías de gasto", cierres_caja: "Cierres de caja",
  cuentas_dinero: "Cuentas de dinero", metodos_pago: "Medios de pago", impuestos: "Impuestos",
  productos: "Productos", variantes: "Variantes", categorias: "Categorías", tallas: "Tallas", colores: "Colores",
  tipos_camiseta: "Tipos de camiseta", disenos: "Diseños", diseno_materiales: "Materiales de diseños",
  ajustes_inventario: "Ajustes de inventario", traslados: "Traslados", ordenes_estampado: "Órdenes de estampado",
  clientes: "Clientes", proveedores: "Proveedores", descuentos_autorizados: "Descuentos y promociones",
  perfiles: "Usuarios", roles: "Roles", rol_permisos: "Permisos de roles", usuario_bodegas: "Puntos de cada usuario",
  bodegas: "Puntos y bodegas", configuracion_negocio: "Configuración", consecutivos: "Consecutivos", adjuntos: "Adjuntos",
};
const ACCIONES: Record<string, { texto: string; tono: "exito" | "alerta" | "error" | "neutro" | "marca" }> = {
  insertar: { texto: "Creó", tono: "exito" },
  actualizar: { texto: "Modificó", tono: "alerta" },
  eliminar: { texto: "Eliminó", tono: "error" },
  ingreso: { texto: "Ingresó", tono: "marca" },
  salida: { texto: "Salió", tono: "neutro" },
};
// Páginas a las que se puede ir desde un registro
const ENLACES: Record<string, string> = {
  ventas: "/ventas/", compras: "/compras/", gastos: "/gastos/", productos: "/productos/", clientes: "/clientes/",
};
const POR_PAGINA = 50;
const fechaValida = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "");

type Registro = {
  id: number; ocurrido_en: string; usuario_id: string | null; accion: string; tabla: string; registro_id: string | null;
  valor_anterior: Record<string, unknown> | null; valor_nuevo: Record<string, unknown> | null;
};

function mostrar(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  const t = typeof v === "object" ? JSON.stringify(v) : String(v);
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

// Historial de cambios: quién, cuándo, qué hizo, en qué registro, y el valor anterior y el nuevo
export default async function PaginaAuditoria({ searchParams }: {
  searchParams: Promise<{ desde?: string; hasta?: string; tabla?: string; usuario?: string; accion?: string; pagina?: string }>;
}) {
  const f = await searchParams;
  const sesion = await exigirPermiso("auditoria.ver");
  const supabase = await crearClienteServidor();
  const hoy = hoyBogota();
  const hasta = fechaValida(f.hasta) || hoy;
  const desde = fechaValida(f.desde) && fechaValida(f.desde) <= hasta ? fechaValida(f.desde) : restarDias(hasta, 6);
  const tabla = f.tabla && TABLAS[f.tabla] ? f.tabla : "";
  const usuario = /^[0-9a-f-]{36}$/.test(f.usuario ?? "") ? f.usuario! : "";
  const accion = f.accion && ACCIONES[f.accion] ? f.accion : "";
  const pagina = Math.min(Math.max(Math.trunc(Number(f.pagina)) || 1, 1), 2000);

  let consulta = supabase.from("auditoria")
    .select("id, ocurrido_en, usuario_id, accion, tabla, registro_id, valor_anterior, valor_nuevo", { count: "exact" })
    .gte("ocurrido_en", `${desde}T00:00:00-05:00`).lte("ocurrido_en", `${hasta}T23:59:59.999-05:00`)
    .order("ocurrido_en", { ascending: false }).order("id", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (tabla) consulta = consulta.eq("tabla", tabla);
  if (usuario) consulta = consulta.eq("usuario_id", usuario);
  if (accion) consulta = consulta.eq("accion", accion);
  const [{ data, count, error }, { data: usuarios }] = await Promise.all([consulta, supabase.rpc("usuarios_nombres")]);
  const registros = (data ?? []) as Registro[];
  const nombres = new Map(((usuarios ?? []) as { id: string; nombre: string }[]).map((u) => [u.id, u.nombre]));

  // Nombre legible de cada registro (número de la venta, la compra o el gasto; nombre del producto o cliente)
  const ids = (t: string) => [...new Set(registros.filter((r) => r.tabla === t && /^[0-9a-f-]{36}$/.test(r.registro_id ?? "")).map((r) => r.registro_id!))];
  const vacio = Promise.resolve({ data: [] as Record<string, string | null>[] });
  const [rVentas, rCompras, rGastos, rProductos, rClientes] = await Promise.all([
    ids("ventas").length ? supabase.from("ventas").select("id, numero, numero_cotizacion").in("id", ids("ventas")) : vacio,
    ids("compras").length ? supabase.from("compras").select("id, numero").in("id", ids("compras")) : vacio,
    ids("gastos").length ? supabase.from("gastos").select("id, numero").in("id", ids("gastos")) : vacio,
    ids("productos").length ? supabase.from("productos").select("id, nombre").in("id", ids("productos")) : vacio,
    ids("clientes").length ? supabase.from("clientes").select("id, nombre").in("id", ids("clientes")) : vacio,
  ]);
  const etiquetas = new Map<string, string>();
  for (const x of [...(rVentas.data ?? []), ...(rCompras.data ?? []), ...(rGastos.data ?? []), ...(rProductos.data ?? []), ...(rClientes.data ?? [])] as Record<string, string | null>[]) {
    const t = x.numero ?? x.numero_cotizacion ?? x.nombre;
    if (x.id && t) etiquetas.set(x.id, t);
  }
  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const filtros = new URLSearchParams({ desde, hasta, ...(tabla ? { tabla } : {}), ...(usuario ? { usuario } : {}), ...(accion ? { accion } : {}) });
  const enlacePagina = (n: number) => `/auditoria?${new URLSearchParams({ ...Object.fromEntries(filtros), pagina: String(n) })}`;
  const descargas = tiene(sesion, "informes.exportar") ? [{ titulo: "Auditoría con estos filtros", url: `/informes/exportar?tipo=auditoria&${filtros}` }] : [];
  const campo = "min-h-11 rounded-xl border border-borde bg-white px-2 font-normal";

  return (
    <>
      <Encabezado titulo="Auditoría"
                  descripcion="Todo lo que se crea, modifica o anula queda aquí con su usuario, fecha y hora, y el valor anterior y el nuevo. Nada se puede borrar."
                  acciones={<Descargas enlaces={descargas} />} />

      <form className="mb-4 grid gap-2 rounded-2xl border border-borde bg-white p-3 sm:grid-cols-3 lg:grid-cols-[auto_auto_1fr_1fr_auto_auto] lg:items-end print:hidden">
        <label className="flex flex-col gap-1 text-sm font-semibold">Desde
          <input type="date" name="desde" defaultValue={desde} className={campo} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Hasta
          <input type="date" name="hasta" defaultValue={hasta} className={campo} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Qué
          <select name="tabla" defaultValue={tabla} className={campo}>
            <option value="">Todo</option>
            {Object.entries(TABLAS).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Usuario
          <select name="usuario" defaultValue={usuario} className={campo}>
            <option value="">Todos</option>
            {((usuarios ?? []) as { id: string; nombre: string }[]).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Acción
          <select name="accion" defaultValue={accion} className={campo}>
            <option value="">Todas</option>
            {Object.entries(ACCIONES).map(([k, a]) => <option key={k} value={k}>{a.texto}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Filtrar</button>
      </form>

      {error && <Tarjeta className="mb-4 text-error">No se pudo leer la auditoría. Intenta de nuevo.</Tarjeta>}
      <p className="mb-2 text-sm text-suave">{total.toLocaleString("es-CO")} registro(s){total > POR_PAGINA ? ` · página ${pagina} de ${paginas}` : ""}</p>

      {registros.length === 0 ? (
        <Tarjeta className="text-center text-suave">No hay registros con estos filtros.</Tarjeta>
      ) : (
        <ul className="flex flex-col gap-2">
          {registros.map((r) => {
            const a = ACCIONES[r.accion] ?? { texto: r.accion, tono: "neutro" as const };
            const campos = [...new Set([...Object.keys(r.valor_anterior ?? {}), ...Object.keys(r.valor_nuevo ?? {})])];
            const quien = r.usuario_id ? nombres.get(r.usuario_id) ?? "Usuario eliminado" : "Sistema";
            const enlace = ENLACES[r.tabla] && r.registro_id && r.accion !== "eliminar" ? `${ENLACES[r.tabla]}${r.registro_id}` : null;
            const numero = (r.registro_id ? etiquetas.get(r.registro_id) : undefined)
              ?? (typeof r.valor_nuevo?.numero === "string" ? r.valor_nuevo.numero : typeof r.valor_anterior?.numero === "string" ? r.valor_anterior.numero : null);
            return (
              <li key={r.id} className="rounded-2xl border border-borde bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="cifra text-suave">
                    {new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(new Date(r.ocurrido_en))}
                  </span>
                  <span className="font-semibold">{quien}</span>
                  <Insignia tono={a.tono}>{a.texto}</Insignia>
                  <span>{TABLAS[r.tabla] ?? r.tabla}</span>
                  {r.tabla !== "sesiones" && r.registro_id && (
                    enlace
                      ? <Link href={enlace} className="font-semibold text-morado underline-offset-2 hover:underline">{numero ?? r.registro_id.slice(0, 8)}</Link>
                      : <span className="text-suave">{numero ?? r.registro_id.slice(0, 8)}</span>
                  )}
                </div>
                {campos.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm font-semibold text-morado">
                      {r.accion === "actualizar" ? `Ver cambios (${campos.length})` : "Ver datos"}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[480px] text-xs">
                        <thead><tr className="text-left text-suave">
                          <th className="py-1 font-semibold">Campo</th>
                          {r.accion !== "insertar" && <th className="py-1 font-semibold">Antes</th>}
                          {r.accion !== "eliminar" && <th className="py-1 font-semibold">Después</th>}
                        </tr></thead>
                        <tbody>
                          {campos.map((c) => (
                            <tr key={c} className="border-t border-borde align-top">
                              <td className="py-1 pr-3 font-semibold">{c.replace(/_/g, " ")}</td>
                              {r.accion !== "insertar" && <td className={cn("break-all py-1 pr-3", r.accion === "actualizar" && "text-error")}>{mostrar(r.valor_anterior?.[c])}</td>}
                              {r.accion !== "eliminar" && <td className={cn("break-all py-1", r.accion === "actualizar" && "text-morado")}>{mostrar(r.valor_nuevo?.[c])}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {paginas > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-2 print:hidden" aria-label="Páginas">
          {pagina > 1
            ? <Link href={enlacePagina(pagina - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">← Más recientes</Link>
            : <span />}
          {pagina < paginas
            ? <Link href={enlacePagina(pagina + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Más antiguos →</Link>
            : <span />}
        </nav>
      )}
    </>
  );
}
