import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const config: NextConfig = {
  output: "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Inline-Styles wegen der style-Attribute in den Komponenten.
              "style-src 'self' 'unsafe-inline'",
              // unsafe-eval nur in der Entwicklung, für das Hot Reloading.
              `script-src 'self'${isDev ? " 'unsafe-eval'" : ""}`,
              "img-src 'self' data: https://avatars.steamstatic.com",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://steamcommunity.com",
            ].join("; "),
          },
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
