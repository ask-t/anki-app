import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/oauth/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default nextConfig;
