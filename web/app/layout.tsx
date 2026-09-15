import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FABINVESTS TERMINAL . FX-2000",
  description:
    "Retro CRT paper-trading terminal for the FabInvests research simulator. Real observations, fake money, no guaranteed edge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* dot-matrix grid floor */}
        <div className="term-bg" />
        {/* CRT scanlines, vignette and rolling sweep — decorative only */}
        <div className="crt-overlay" aria-hidden="true" />
        <div className="crt-sweep" aria-hidden="true" />
        <div className="crt-flicker">{children}</div>
      </body>
    </html>
  );
}
