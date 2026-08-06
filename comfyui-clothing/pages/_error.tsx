import type { NextPageContext } from "next"

type ErrorPageProps = {
  statusCode?: number
}

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Something went wrong</h1>
      <p style={{ marginTop: 12, color: "#666" }}>
        {statusCode ? `Server returned ${statusCode}.` : "An unexpected error occurred."}
      </p>
    </main>
  )
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode || err?.statusCode || 500
  return { statusCode }
}
