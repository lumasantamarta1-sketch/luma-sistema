# LUMA · Sistema administrativo

Inventario, ventas, compras, estampado, gastos, caja y resultados de **LUMA — Ideas que cobran vida**.
Next.js (App Router) + TypeScript + Tailwind CSS, sobre Supabase (Postgres, Auth y Storage), publicado en Netlify.

> El comprobante de venta es un **comprobante interno**: no es una factura electrónica válida ante la DIAN.

## Cómo está armado

- **La base de datos decide.** Cada operación que mueve inventario o dinero (confirmar y entregar ventas, recibir
  compras, registrar estampados, pagos, traslados, devoluciones, anulaciones y ajustes) es una función de Postgres que
  corre en una sola transacción, verifica el permiso del usuario y su punto de venta, y deja rastro en la auditoría.
- **RLS en todas las tablas.** La aplicación usa la llave publicable; quien consulte la base de datos directamente solo
  obtiene lo que su rol permite. Los costos viven en tablas y columnas que solo lee quien tiene `costos.ver`.
- **Libros inmutables.** El kardex (`movimientos_inventario`) y la caja (`movimientos_caja`) no se modifican ni se
  borran; los errores se corrigen con anulaciones y reversos visibles.
- **Llave secreta solo en el servidor.** Se usa únicamente para crear usuarios y restablecer contraseñas, después de
  verificar el permiso `usuarios.gestionar`.

```
src/app/(auth)/        ingreso y recuperación de contraseña
src/app/(app)/         secciones del menú (una carpeta por sección)
src/lib/supabase/      clientes de navegador, servidor, proxy y administración
src/lib/sesion.ts      sesión y permisos del usuario (capa de acceso a datos)
supabase/migrations/   tablas, funciones, RLS, auditoría y datos iniciales, en orden
supabase/tests/        pruebas de la base de datos (flujo completo, permisos, concurrencia)
```

## Variables de entorno

Copia `.env.example` como `.env.local` y completa:

| Variable | Dónde se obtiene | ¿Pública? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase › Project Settings › API | Sí |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase › Project Settings › API Keys (`sb_publishable_…`) | Sí |
| `SUPABASE_SECRET_KEY` | Supabase › Project Settings › API Keys (`sb_secret_…`) | **No. Solo servidor** |
| `NEXT_PUBLIC_SITE_URL` | La dirección de la aplicación (en local, `http://localhost:3000`) | Sí |

`.env.local` está en `.gitignore`. La llave secreta nunca va al navegador, a GitHub ni a un chat.

## Instalación local

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # verificación de producción
```

## Base de datos

Las migraciones de `supabase/migrations/` se aplican en orden de nombre. Crean 53 tablas, las funciones de operación,
las políticas RLS, la auditoría, los roles y permisos de partida, la numeración, las tallas, las categorías de gasto,
los métodos de pago y el depósito privado `adjuntos`. **No crean productos, existencias, clientes, proveedores, ventas
ni gastos**: la base de producción nace vacía.

### Pruebas de la base de datos

Requieren PostgreSQL 16 o superior local. El script recrea la base `luma`, aplica las migraciones y corre las pruebas:

```bash
npm run db:probar
```

Incluyen el ejemplo de la sección 9 de la propuesta (ventas netas $ 260.000, utilidad bruta $ 167.000, resultado
$ 101.500, flujo −$ 260.000, inventario $ 356.500), permisos por rol, devoluciones, anulaciones, venta bajo pedido,
pedidos personalizados, traslados, cierres de caja y dos vendedores confirmando a la vez la última unidad.

### Primer administrador

No hay registro público. El primer usuario se crea una sola vez:

1. En Supabase › Authentication › Users › **Add user**, crea tu usuario con tu correo y una contraseña
   (marca *Auto Confirm User*).
2. En Supabase › SQL Editor ejecuta, con tu correo:
   ```sql
   select app.promover_administrador('tu-correo@ejemplo.com');
   ```
3. Ingresa a la aplicación. Desde **Usuarios** creas a los demás con contraseña temporal, rol y puntos de venta.

### Recuperación de contraseña por correo (opcional)

En Supabase › Authentication › URL Configuration pon la dirección de la aplicación como *Site URL* y agrega
`https://TU-SITIO/auth/confirmar` a *Redirect URLs*. El correo gratuito de Supabase tiene un límite bajo de envíos por
hora; el administrador también puede asignar una contraseña temporal desde **Usuarios**.

## Publicación en Netlify (plan gratuito)

1. En Netlify: **Add new site › Import an existing project** y elige el repositorio de GitHub.
2. Netlify detecta Next.js (`netlify.toml` ya trae el comando `npm run build`).
3. En **Site configuration › Environment variables** agrega las cuatro variables de arriba, con
   `NEXT_PUBLIC_SITE_URL` igual a la dirección que te asigne Netlify.
4. Publica. Cada cambio aprobado en la rama principal se publica solo (15 créditos por publicación; el plan gratuito
   trae 300 al mes).

## Datos de demostración

Viven en un proyecto de Supabase aparte (`luma-demo`) y nunca se cargan en producción.

## Costos

Supabase Free, Netlify Free y GitHub Free: USD 0 al mes. Supabase gratuito no hace copias de seguridad y pausa el
proyecto tras una semana sin uso; se exporta la base cada semana.
