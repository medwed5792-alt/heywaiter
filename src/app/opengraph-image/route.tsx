import { ImageResponse } from "next/og";

/**
 * Route Handler вместо opengraph-image.tsx: не участвует в статическом prerender при build.
 * На Windows с кириллицей в пути к проекту @vercel/og при prerender давал TypeError: Invalid URL.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #065f46 100%)",
          color: "#f8fafc",
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        <span>HeyWaiter</span>
        <span style={{ marginTop: 24, fontSize: 28, fontWeight: 500, color: "#94a3b8" }}>SOTA</span>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
