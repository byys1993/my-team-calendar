import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 관리자 CSV 업로드 (시즌 전체 일정, 최대 2MB)
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
