import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { accentStyle, brandTitle, getBrand } from "@/lib/brand";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    title: brandTitle(getBrand()),
    description: "Verwaltung für den Garry's-Mod-Server",
  };
}

/**
 * Setzt Farbschema und eingeklappte Seitenleiste, bevor der Browser zum ersten
 * Mal zeichnet. Ohne das Skript blitzt bei hellem Schema erst das dunkle auf,
 * und die Seitenleiste springt nach dem Laden zusammen.
 */
const BOOT_SCRIPT =
  "(function(){try{var d=document.documentElement;" +
  "var t=localStorage.getItem('panel-theme');d.dataset.theme=t==='light'?'light':'dark';" +
  "if(localStorage.getItem('panel-sidebar')==='collapsed')d.dataset.sidebar='collapsed';" +
  "}catch(e){}})();";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Die Content-Security-Policy erlaubt Inline-Skripte nur mit der Nonce aus
  // dem Proxy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const brand = getBrand();

  return (
    <html
      lang="de"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={accentStyle(brand)}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
