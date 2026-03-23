/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@jmcp/contracts", "@jmcp/config"],
  async rewrites() {
    return [
      {
        source: "/papers",
        destination: "http://127.0.0.1:3100/papers",
      },
      {
        source: "/papers/:path*",
        destination: "http://127.0.0.1:3100/papers/:path*",
      },
    ]
  },
}

export default nextConfig
