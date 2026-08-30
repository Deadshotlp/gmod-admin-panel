import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SWRP Serververwaltung",
  description: "Verwaltung für den Star-Wars-RP-Server",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
