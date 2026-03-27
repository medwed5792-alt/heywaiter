import { ImageResponse } from "next/og";

/** Бамп при смене превью в Telegram / соцсетях (или задайте NEXT_PUBLIC_SOTA_OG_REVISION в CI). */
export const alt = "HeyWaiter — SOTA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
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
    { ...size }
  );
}
