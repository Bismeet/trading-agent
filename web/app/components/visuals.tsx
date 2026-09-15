"use client";

// ---------------------------------------------------------------------------
// Retro-terminal decorative visuals.
// Deterministic by construction (index arithmetic, no Math.random) so the
// server and client markup match and hydration never mismatches.
// Purely decorative: never feeds back into decisions or data.
// ---------------------------------------------------------------------------

/** Falling data-stream columns behind the terminal. */
export function DataStream({ count = 20 }: { count?: number }) {
  const cols = [];
  const CHARS = "01·<>/\\|=+-*#$%&ABCDEF0123456789";
  for (let i = 0; i < count; i++) {
    const left = ((i * 47) % 100) + ((i * 13) % 7) / 10;
    const dur = 14 + ((i * 29) % 90) / 10;
    const delay = -(((i * 71) % 200) / 10);
    // deterministic glyph run per column
    let run = "";
    for (let k = 0; k < 40; k++) {
      run += CHARS[(i * 31 + k * 17) % CHARS.length] + "\n";
    }
    cols.push(
      <span
        key={i}
        className="absolute top-0"
        style={{
          left: `${left}%`,
          animation: `datastream-fall ${dur}s linear ${delay}s infinite`,
          writingMode: "vertical-rl",
        }}
      >
        {run}
      </span>,
    );
  }
  return (
    <div className="datastream" aria-hidden="true">
      <style>{`@keyframes datastream-fall { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }`}</style>
      {cols}
    </div>
  );
}

/** Chunky block-glyph logo, drawn from rectangles in the classic style. */
export function TerminalLogo({ size = 44 }: { size?: number }) {
  const cell = size / 11;
  // 9x11 bitmap of a crude CRT monitor. 1 = lit pixel.
  const BMP = [
    "111111111",
    "100000001",
    "101111101",
    "101000101",
    "101111101",
    "100000001",
    "111111111",
    "000010000",
    "000010000",
    "011111110",
    "000000000",
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${9 * cell} ${11 * cell}`} aria-hidden="true">
      {BMP.map((row, y) =>
        row.split("").map((c, x) =>
          c === "1" ? (
            <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill="#33ff66" />
          ) : null,
        ),
      )}
    </svg>
  );
}

/** Legacy alias — previously the sakura petals. Now the data stream. */
export const Sakura = DataStream;

/** Blinking pixel status lamp. */
export function Lamp({
  on,
  tone = "text-phos",
  blink = false,
  label,
}: {
  on: boolean;
  tone?: string;
  blink?: boolean;
  label?: string;
}) {
  return (
    <span
      className={`lamp ${on ? "lamp-on" : "lamp-off"} ${blink && on ? "blink" : ""} ${tone}`}
      role="img"
      aria-label={label ?? (on ? "active" : "inactive")}
    />
  );
}

/** Segmented arcade-style level meter. Deterministic, no animation. */
export function SegBar({
  value,
  max = 100,
  segments = 20,
  tone = "text-phos",
}: {
  value: number;
  max?: number;
  segments?: number;
  tone?: string;
}) {
  const filled = Math.max(
    0,
    Math.min(segments, Math.round((value / Math.max(1e-9, max)) * segments)),
  );
  return (
    <div className={`seg-bar h-4 ${tone}`} aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={`seg ${i < filled ? "on" : ""}`} />
      ))}
    </div>
  );
}

/** ASCII rule with an embedded caption, in the classic banner style. */
export function AsciiRule({ text = "", width = 64 }: { text?: string; width?: number }) {
  if (!text)
    return (
      <div className="text-phosdeep select-none overflow-hidden whitespace-nowrap">{"─".repeat(width)}</div>
    );
  const pad = Math.max(2, width - text.length - 4);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return (
    <div className="text-phosdeep select-none overflow-hidden whitespace-nowrap font-term text-xs">
      {"─".repeat(left)}[ <span className="text-inksoft">{text}</span> ]{"─".repeat(right)}
    </div>
  );
}

/** Retro title bar for a terminal window. */
export function TitleBar({
  title,
  right,
  dark = false,
}: {
  title: string;
  right?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className={`titlebar ${dark ? "titlebar-dark" : ""}`}>
      <span>{title}</span>
      <span className="flex items-center gap-2">{right}</span>
    </div>
  );
}
