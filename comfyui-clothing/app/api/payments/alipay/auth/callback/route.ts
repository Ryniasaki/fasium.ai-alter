function buildResponse(method: string) {
  return Response.json(
    {
      ok: true,
      message: "Alipay auth callback endpoint is available.",
      method,
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  )
}

export async function GET() {
  return buildResponse("GET")
}

export async function POST() {
  return buildResponse("POST")
}
