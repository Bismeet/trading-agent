"use client";

// P9: deterministic aurora motes (server/client must match) + Mascot SVG.
// No Math.random() — every position/animation derives from the index so the
// server-rendered markup and the client hydration pass agree exactly.
const MOTE_VARIANTS = ["mote-teal", "mote-violet", "mote-green"] as const;

export function AuroraMotes({ count = 16 }: { count?: number }) {
  const motes = [];
  for (let i = 0; i < count; i++) {
    // deterministic pseudo-random from index — no Math.random()
    const left = ((i * 61) % 100) + ((i * 7) % 10) / 10;
    const dur = 11 + ((i * 37) % 70) / 10;
    const delay = -(((i * 53) % 140) / 10);
    const sway = ((i % 2 === 0 ? 1 : -1) * (24 + ((i * 29) % 48)));
    motes.push(
      <span
        key={i}
        className={`mote ${MOTE_VARIANTS[i % MOTE_VARIANTS.length]}`}
        style={
          {
            left: `${left}%`,
            animationDuration: `${dur}s`,
            animationDelay: `${delay}s`,
            "--sway": `${sway}px`,
          } as React.CSSProperties
        }
      />,
    );
  }
  return <>{motes}</>;
}

export function Mascot({ size = 56, mood = "happy" }: { size?: number; mood?: "happy" | "sleepy" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="floaty" aria-hidden="true">
      {/* antenna */}
      <line x1="32" y1="10" x2="32" y2="18" stroke="#1fb3a6" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="8" r="4" fill="#1fb3a6" />
      {/* head */}
      <rect x="10" y="18" width="44" height="36" rx="14" fill="#ccd5f6" stroke="#6b77cf" strokeWidth="2" />
      {/* screen */}
      <rect x="16" y="25" width="32" height="22" rx="9" fill="#16213f" />
      {mood === "happy" ? (
        <>
          <circle cx="26" cy="34" r="3" fill="#b9ece6" />
          <circle cx="38" cy="34" r="3" fill="#b9ece6" />
          <circle cx="26" cy="33" r="1.2" fill="#fff" />
          <circle cx="38" cy="33" r="1.2" fill="#fff" />
          <path d="M28 41 q4 3 8 0" stroke="#b9ece6" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M22 34 q4 3 8 0" stroke="#b9ece6" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M34 34 q4 3 8 0" stroke="#b9ece6" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M29 42 q3 2 6 0" stroke="#b9ece6" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {/* blush */}
      <circle cx="18" cy="42" r="2.4" fill="#62c99b" opacity="0.7" />
      <circle cx="46" cy="42" r="2.4" fill="#62c99b" opacity="0.7" />
    </svg>
  );
}
