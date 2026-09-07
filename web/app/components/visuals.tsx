"use client";

// P9: deterministic Sakura petals (server/client must match) + Mascot SVG.
export function Sakura({ count = 16 }: { count?: number }) {
  const petals = [];
  for (let i = 0; i < count; i++) {
    // deterministic pseudo-random from index — no Math.random()
    const left = ((i * 61) % 100) + ((i * 7) % 10) / 10;
    const dur = 9 + ((i * 37) % 60) / 10;
    const delay = -(((i * 53) % 120) / 10);
    petals.push(
      <span
        key={i}
        className="petal"
        style={{ left: `${left}%`, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
      />,
    );
  }
  return <>{petals}</>;
}

export function Mascot({ size = 56, mood = "happy" }: { size?: number; mood?: "happy" | "sleepy" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="floaty" aria-hidden="true">
      {/* antenna */}
      <line x1="32" y1="10" x2="32" y2="18" stroke="#ff9eaa" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="8" r="4" fill="#ff9eaa" />
      {/* head */}
      <rect x="10" y="18" width="44" height="36" rx="14" fill="#cdcaeb" stroke="#807ea8" strokeWidth="2" />
      {/* screen */}
      <rect x="16" y="25" width="32" height="22" rx="9" fill="#3c2a45" />
      {mood === "happy" ? (
        <>
          <circle cx="26" cy="34" r="3" fill="#ffd2d9" />
          <circle cx="38" cy="34" r="3" fill="#ffd2d9" />
          <circle cx="26" cy="33" r="1.2" fill="#fff" />
          <circle cx="38" cy="33" r="1.2" fill="#fff" />
          <path d="M28 41 q4 3 8 0" stroke="#ffd2d9" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M22 34 q4 3 8 0" stroke="#ffd2d9" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M34 34 q4 3 8 0" stroke="#ffd2d9" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M29 42 q3 2 6 0" stroke="#ffd2d9" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {/* blush */}
      <circle cx="18" cy="42" r="2.4" fill="#ff9eaa" opacity="0.7" />
      <circle cx="46" cy="42" r="2.4" fill="#ff9eaa" opacity="0.7" />
    </svg>
  );
}
