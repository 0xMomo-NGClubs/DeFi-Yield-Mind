import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "DeFi Yield Mind",
  description: "AI 驱动的多链 DeFi 收益聚合平台，基于 LI.FI Earn API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-950 text-gray-100">
        <Providers>
          <NavBar />
          <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
