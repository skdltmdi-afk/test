import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 파일 파서들은 서버에서만 쓰이므로 번들링하지 않고 그대로 require 하게 둔다.
  serverExternalPackages: ["mammoth", "unpdf"],
};

export default nextConfig;
