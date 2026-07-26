import { ImageResponse } from "next/og";

export const alt = "CaptionCut video editor";
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
          justifyContent: "space-between",
          padding: "72px 78px",
          background: "#08090b",
          color: "#f4f4f1",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 58,
              height: 58,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              background: "#f2a65a",
              color: "#17120d",
              fontSize: 32,
              fontWeight: 900,
            }}
          >
            C
          </div>
          <span style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>
            CaptionCut
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              display: "flex",
              color: "#f2a65a",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            Transcript-first video editor
          </span>
          <span
            style={{
              display: "flex",
              maxWidth: 980,
              marginTop: 24,
              fontSize: 76,
              fontWeight: 800,
              letterSpacing: -5,
              lineHeight: 0.98,
            }}
          >
            Make the cut.
          </span>
          <span
            style={{
              display: "flex",
              maxWidth: 850,
              marginTop: 26,
              color: "#9299a2",
              fontSize: 28,
              lineHeight: 1.35,
            }}
          >
            Edit from the transcript. Caption on device. Export the final video.
          </span>
        </div>
      </div>
    ),
    size
  );
}
