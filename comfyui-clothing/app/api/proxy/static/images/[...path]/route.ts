import { readFile } from "fs/promises"
import { join } from "path"
import { NextRequest, NextResponse } from "next/server";

const TENANT_API_BASE =
  process.env.TENANT_API_BASE_URL || process.env.NEXT_PUBLIC_TENANT_API_URL || "http://localhost:8081";

let placeholderImagePromise: Promise<Buffer> | null = null

const getPlaceholderImage = () => {
  if (!placeholderImagePromise) {
    const placeholderPath = join(process.cwd(), "public", "placeholder.svg")
    placeholderImagePromise = readFile(placeholderPath)
  }
  return placeholderImagePromise
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const imagePath = params.path.join("/");

    // 代理静态图片请求到tenant service
    const response = await fetch(
      `${TENANT_API_BASE}/proxy/static/images/${imagePath}`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      const placeholderImage = await getPlaceholderImage()
      return new NextResponse(placeholderImage, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Image-Placeholder": "1",
        },
      })
    }

    // 返回图片数据
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/png";

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000", // 缓存1年
      },
    });
  } catch (error) {
    console.error("Static image proxy error:", error);
    return NextResponse.json(
      { detail: "Internal server error" },
      { status: 500 }
    );
  }
}
