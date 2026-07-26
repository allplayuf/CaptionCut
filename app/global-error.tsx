"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("CaptionCut global error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#06090d",
          color: "#f0f3f5",
          fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
        }}
      >
        <main
          role="alert"
          style={{
            width: "min(420px, calc(100vw - 32px))",
            boxSizing: "border-box",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 28,
            background: "#10161d",
            padding: 28,
            textAlign: "center",
            boxShadow: "0 28px 80px rgba(0,0,0,.45)",
          }}
        >
          <title>CaptionCut couldn’t start</title>
          <div
            aria-hidden="true"
            style={{ fontSize: 30, color: "#fda4af", lineHeight: 1 }}
          >
            !
          </div>
          <h1 style={{ margin: "18px 0 0", fontSize: 22 }}>
            CaptionCut couldn’t start
          </h1>
          <p style={{ margin: "10px 0 0", color: "#82909c", lineHeight: 1.6 }}>
            Reload the workspace. Your saved projects are unaffected.
          </p>
          <button
            type="button"
            onClick={unstable_retry}
            style={{
              width: "100%",
              height: 44,
              marginTop: 24,
              border: 0,
              borderRadius: 10,
              background: "#ffb45b",
              color: "#1b140b",
              font: "inherit",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ margin: "14px 0 0", color: "#53606c", fontSize: 11 }}>
              Error code {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
