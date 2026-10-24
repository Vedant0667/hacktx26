import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { COPY } from "@/lib/copy";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: COPY.meta.title,
  description: COPY.meta.description,
};

export const viewport: Viewport = {
  themeColor: "#0C1010",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} h-full`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
