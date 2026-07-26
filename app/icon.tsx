import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 112,
          background: "#f2a65a",
          color: "#17120d",
          fontFamily: "Arial, sans-serif",
          fontSize: 250,
          fontWeight: 900,
          letterSpacing: -28,
        }}
      >
        C
        <span
          style={{
            display: "flex",
            width: 34,
            height: 250,
            marginLeft: -12,
            background: "#17120d",
            transform: "rotate(18deg)",
          }}
        />
      </div>
    ),
    size
  );
}
