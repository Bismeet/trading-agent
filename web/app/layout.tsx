import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "@FabRichhhhhh . Trading Bot",
  description: "Paper-trading simulator. Fake money, real lessons.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Zen+Maru+Gothic:wght@400;700&family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="sky" />
        <div className="sun" />
        {children}
      </body>
    </html>
  );
}
