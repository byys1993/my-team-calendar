import type { NextConfig } from "next";

// 모든 페이지에 붙이는 보안 헤더.
// CSP 는 스크립트 출처까지 막으면 Next.js 인라인 스크립트·Turnstile 이 깨지므로,
// 깨질 일이 없는 항목(다른 사이트의 틀 안에 띄우기 금지, base·form·object 제한)만 건다.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    // 관리자 CSV 업로드 (시즌 전체 일정, 최대 2MB)
    serverActions: { bodySizeLimit: "3mb" },
  },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // 관리자·수신 거부 화면은 검색엔진에 나오지 않게
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/admin", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/unsubscribe", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
