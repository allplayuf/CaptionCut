import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 38,
          background: "#f2a65a",
          color: "#17120d",
          fontFamily: "Arial, sans-serif",
          fontSize: 88,
          fontWeight: 900,
          letterSpacing: -10,
        }}
      >
        C
        <span
          style={{
            display: "flex",
            width: 12,
            height: 88,
            marginLeft: -4,
            background: "#17120d",
            transform: "rotate(18deg)",
          }}
        />
      </div>
    ),
    size
  );
}
