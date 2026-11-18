import type { Metadata, Viewport } from "next";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LUMA", template: "%s · LUMA" },
  description: "Sistema administrativo de LUMA: inventario, ventas, compras, gastos y resultados.",
  icons: {
    icon: [{ url: "/marca/icono-32.png", sizes: "32x32" }, { url: "/marca/icono-192.png", sizes: "192x192" }],
    apple: "/marca/icono-180.png",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#2d0a72",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CO" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
