import Image from "next/image";

export default function LayoutAcceso({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-borde bg-white p-6 shadow-sm">
        <Image src="/marca/logo-luma.png" alt="LUMA · Ideas que cobran vida" width={900} height={549}
               priority className="mx-auto mb-4 h-auto w-48" />
        {children}
      </div>
    </main>
  );
}
