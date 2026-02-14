import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async redirects() {
    return [
      {
        source: "/sender",
        destination: "/video",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
