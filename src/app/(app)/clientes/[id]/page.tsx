import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { estadoPago, estadoVenta, numeroVenta, saldoVenta } from "@/lib/ventas";
import { fecha, pesos } from "@/lib/utilidades";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { EditarCliente } from "../formularios";

export const metadata: Metadata = { title: "Cliente" };

type Venta = {
  id: string; numero: string | null; numero_cotizacion: string | null; estado: string; estado_entrega: string; total: number;
  creado_en: string; confirmada_en: string | null; bodegas: { nombre: string } | null;
  pagos_venta: { tipo: string; valor: number }[]; devoluciones_venta: { valor_total: number }[];
  venta_lineas: { cantidad: number; personalizacion: string | null; variantes: { sku: string; productos: { nombre: string } | null } | null }[];
};

const devuelto = (v: Venta) => v.devoluciones_venta.reduce((s, d) => s + Number(d.valor_total), 0);

function enlaceWhatsApp(numero: string) {
  let d = numero.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) d = `57${d}`;
  return `https://wa.me/${d}`;
}

// Ficha del cliente: datos de contacto, cuánto ha comprado, cuánto debe y su historial de ventas y pedidos
export default async function PaginaCliente({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirPermiso("clientes.ver", "clientes.crear", "clientes.gestionar");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await crearClienteServidor();
  const veVentas = tiene(sesion, "ventas.ver", "ventas.ver_propias");
  const [consulta, ventas] = await Promise.all([
    supabase.from("clientes").select("id, nombre, documento, telefono, whatsapp, correo, ciudad, direccion, activo, creado_en").eq("id", id).maybeSingle(),
    veVentas
      ? supabase.from("ventas")
          .select("id, numero, numero_cotizacion, estado, estado_entrega, total, creado_en, confirmada_en, bodegas(nombre), pagos_venta(tipo, valor), devoluciones_venta(valor_total), venta_lineas(cantidad, personalizacion, variantes(sku, productos(nombre)))")
          .eq("cliente_id", id).order("creado_en", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
  ]);
  const cliente = consulta.data;
  if (!cliente) notFound();
  const lista = (ventas.data ?? []) as unknown as Venta[];
  const confirmadas = lista.filter((v) => v.estado === "confirmada");
  const comprado = confirmadas.reduce((s, v) => s + Number(v.total) - devuelto(v), 0);
  const debe = confirmadas.reduce((s, v) => s + Math.max(saldoVenta(v), 0), 0);
  const ultima = confirmadas.map((v) => v.confirmada_en ?? v.creado_en).sort().at(-1);
  const contacto = cliente.whatsapp || cliente.telefono;

  return (
    <>
      <Encabezado titulo={cliente.nombre} descripcion={`Cliente desde el ${fecha(cliente.creado_en)}${cliente.activo ? "" : " · inactivo"}`}
                  acciones={
                    <div className="flex flex-wrap gap-2">
                      {contacto && (
                        <a href={enlaceWhatsApp(contacto)} target="_blank" rel="noopener noreferrer"
                           className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50">
                          <MessageCircle className="size-4" aria-hidden /> WhatsApp
                        </a>
                      )}
                      <Link href="/clientes" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>
                    </div>
                  } />

      {veVentas && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Compras" valor={String(confirmadas.length)} detalle="Ventas confirmadas" />
          <Cifra titulo="Total comprado" valor={pesos(comprado)} detalle="Sin lo devuelto" />
          <Cifra titulo="Saldo pendiente" valor={pesos(debe)} detalle={debe > 0 ? "Lo que debe hoy" : "No debe nada"} alerta={debe > 0} />
          <Cifra titulo="Última compra" valor={ultima ? fecha(ultima) : "—"} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {veVentas ? (
          <Tarjeta>
            <h2 className="mb-3 text-lg font-semibold text-morado">Historial de compras y pedidos</h2>
            {lista.length === 0 ? (
              <p className="text-suave">Todavía no tiene ventas{tiene(sesion, "ventas.ver") ? "" : " contigo"}.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-borde">
                {lista.map((v) => {
                  const estado = estadoVenta(v);
                  const pago = estadoPago(v);
                  return (
                    <li key={v.id}>
                      <Link href={`/ventas/${v.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-morado-50/50">
                        <span className="font-semibold">{numeroVenta(v)}</span>
                        <span className="text-sm text-suave">{fecha(v.confirmada_en ?? v.creado_en)} · {v.bodegas?.nombre}</span>
                        <Insignia tono={estado.tono}>{estado.texto}</Insignia>
                        {pago && <Insignia tono={pago.tono}>{pago.texto}</Insignia>}
                        <span className="cifra ml-auto font-semibold text-morado">{pesos(v.total)}</span>
                        <span className="basis-full text-sm text-suave">
                          {v.venta_lineas.map((l) => `${Number(l.cantidad)} × ${l.variantes?.productos?.nombre ?? ""} (${l.variantes?.sku ?? ""})${l.personalizacion ? ` «${l.personalizacion}»` : ""}`).join(" · ")}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {lista.length === 300 && <p className="mt-2 text-sm text-suave">Se muestran las 300 más recientes.</p>}
          </Tarjeta>
        ) : (
          <Tarjeta className="text-suave">Tu usuario no consulta ventas, por eso no ves el historial de este cliente.</Tarjeta>
        )}

        <Tarjeta className="h-fit">
          <h2 className="mb-2 text-lg font-semibold text-morado">Datos</h2>
          <dl className="flex flex-col gap-1 text-sm">
            {[
              ["Teléfono", cliente.telefono], ["WhatsApp", cliente.whatsapp], ["Documento", cliente.documento],
              ["Correo", cliente.correo], ["Ciudad", cliente.ciudad], ["Dirección", cliente.direccion],
            ].map(([t, v]) => (
              <div key={t} className="flex justify-between gap-3">
                <dt className="text-suave">{t}</dt><dd className="text-right">{v || "—"}</dd>
              </div>
            ))}
          </dl>
          {tiene(sesion, "clientes.gestionar") && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-morado">Editar datos</summary>
              <EditarCliente cliente={cliente} />
            </details>
          )}
        </Tarjeta>
      </div>
    </>
  );
}

function Cifra({ titulo, valor, detalle, alerta }: { titulo: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <Tarjeta className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-suave">{titulo}</p>
      <p className={`cifra font-titulo text-2xl font-semibold ${alerta ? "text-naranja" : "text-morado"}`}>{valor}</p>
      {detalle && <p className="text-xs text-suave">{detalle}</p>}
    </Tarjeta>
  );
}
