import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",

  // Die Content-Security-Policy wird NICHT hier gesetzt, sondern in
  // src/middleware.ts. Sie braucht pro Anfrage eine frische Nonce, damit Nexts
  // Inline-Skripte laufen dürfen - das geht mit statischen Headern nicht.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;
