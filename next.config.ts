import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every page and API response. SUPABASE_URL is read at build time, so a new project needs a redeploy.
        source: "/:path*",
        headers: securityHeaders(process.env.SUPABASE_URL),
      },
      {
        // The service worker must never be served stale, or push fixes do not reach the phone.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
