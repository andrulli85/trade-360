import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "trade-360",
  description: "Panel local de los grills de Buzz abiertos desde Conductor",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border">
          <nav className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-6 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              trade-360
            </Link>
            <Link href="/" className="text-muted hover:text-foreground">
              Grills
            </Link>
            <span className="ml-auto text-xs text-muted">Buzz ↔ Conductor · local</span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl px-6 py-8 flex-1">{children}</main>
      </body>
    </html>
  );
}
