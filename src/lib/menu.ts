// Mapa de navegación (sección 3 de la propuesta). Cada usuario ve solo lo que su rol permite.
export type ItemMenu = {
  ruta: string;
  titulo: string;
  icono: string;
  permisos: string[]; // basta uno; vacío = todos
  fase?: number; // fase en la que se construye, para las pantallas aún pendientes
};

export type GrupoMenu = { titulo: string | null; items: ItemMenu[] };

export const MENU: GrupoMenu[] = [
  { titulo: null, items: [{ ruta: "/", titulo: "Inicio", icono: "House", permisos: [] }] },
  {
    titulo: "Operación",
    items: [
      { ruta: "/ventas", titulo: "Ventas", icono: "ShoppingBag", permisos: ["ventas.ver", "ventas.ver_propias", "ventas.crear", "ventas.entregar"] },
      { ruta: "/estampado", titulo: "Estampado", icono: "Paintbrush", permisos: ["estampado.ver", "estampado.gestionar"] },
      { ruta: "/compras", titulo: "Compras", icono: "Truck", permisos: ["compras.ver", "compras.gestionar", "compras.recibir"], fase: 5 },
      { ruta: "/gastos", titulo: "Gastos", icono: "Receipt", permisos: ["gastos.ver", "gastos.registrar"], fase: 7 },
      { ruta: "/caja", titulo: "Caja", icono: "Wallet", permisos: ["caja.ver", "caja.gestionar", "caja.cerrar"], fase: 7 },
    ],
  },
  {
    titulo: "Catálogo",
    items: [
      { ruta: "/productos", titulo: "Productos", icono: "Shirt", permisos: ["catalogo.ver"] },
      { ruta: "/inventario", titulo: "Inventario", icono: "Boxes", permisos: ["inventario.ver"] },
    ],
  },
  {
    titulo: "Terceros",
    items: [
      { ruta: "/clientes", titulo: "Clientes", icono: "Users", permisos: ["clientes.ver", "clientes.crear", "clientes.gestionar"] },
      { ruta: "/proveedores", titulo: "Proveedores", icono: "Factory", permisos: ["proveedores.ver", "proveedores.gestionar"], fase: 5 },
    ],
  },
  {
    titulo: "Análisis",
    items: [{ ruta: "/informes", titulo: "Informes", icono: "ChartColumn", permisos: ["informes.ver", "informes.inventario", "informes.financieros"], fase: 9 }],
  },
  {
    titulo: "Administración",
    items: [
      { ruta: "/usuarios", titulo: "Usuarios", icono: "UserCog", permisos: ["usuarios.gestionar"] },
      { ruta: "/configuracion", titulo: "Configuración", icono: "Settings", permisos: ["configuracion.gestionar"] },
    ],
  },
];

export function menuPara(permisos: string[]): GrupoMenu[] {
  return MENU.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.permisos.length === 0 || i.permisos.some((p) => permisos.includes(p))),
  })).filter((g) => g.items.length > 0);
}

export function itemPorRuta(ruta: string): ItemMenu | undefined {
  return MENU.flatMap((g) => g.items).find((i) => i.ruta === ruta);
}
