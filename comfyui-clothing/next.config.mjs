/** @type {import('next').NextConfig} */
const isStandalone = process.env.NEXT_OUTPUT_MODE === "standalone"

const nextConfig = {
  output: isStandalone ? "standalone" : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return []
    }

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ]
  },
};

export default nextConfig;
