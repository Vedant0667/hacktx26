import type { Metadata, Viewport } from "next";
import { Saira, Saira_Condensed, Schibsted_Grotesk } from "next/font/google";
import { COPY } from "@/lib/copy";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted" });
// Race Night UI (components/rn/**): variables only, read inside the .rn scope. Not preloaded, so legacy screens
// download nothing extra; the files load when a .rn screen first uses them.
const rnBody = Saira({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-rn", preload: false });
const rnCond = Saira_Condensed({ subsets: ["latin"], weight: ["600", "700", "800", "900"], variable: "--font-rn-cond", preload: false });

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
    <html lang="en" className={`${schibsted.variable} ${rnBody.variable} ${rnCond.variable} h-full`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
