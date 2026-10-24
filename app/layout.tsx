import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Schibsted_Grotesk } from "next/font/google";
import { COPY } from "@/lib/copy";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted" });
const azeret = Azeret_Mono({ subsets: ["latin"], variable: "--font-azeret" });

export const metadata: Metadata = {
  title: COPY.meta.title,
  description: COPY.meta.description,
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} ${azeret.variable} h-full`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
