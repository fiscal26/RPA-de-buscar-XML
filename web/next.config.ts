import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // planilhas de empresas sobem pelo formulário
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
