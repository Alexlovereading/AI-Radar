// Shared, dependency-free presentational bits for the model sub-pages.
// Server components only — no "use client" needed, no external styling
// system. Colors always come from the CSS custom properties defined in
// app/globals.css (--bg, --surface, --ink, --ink-soft, --line, --accent,
// --accent-soft, --good, --warn, --bad). Never hardcode a different palette.

export function Callout({ tone = "neutral", children }) {
  const palette = {
    neutral: { border: "var(--line)", bg: "var(--surface)" },
    warn: { border: "var(--warn)", bg: "var(--accent-soft)" },
    info: { border: "var(--accent)", bg: "var(--accent-soft)" },
  };
  const c = palette[tone] || palette.neutral;
  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        background: c.bg,
        borderRadius: 10,
        padding: "0.9em 1.1em",
        margin: "1.25em 0",
        color: "var(--ink)",
        fontSize: "0.95em",
      }}
    >
      {children}
    </div>
  );
}

export function SourceLinks({ sources }) {
  if (!sources || sources.length === 0) {
    return (
      <p style={{ color: "var(--ink-soft)" }}>
        No sources on file for this entity yet.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "1em 0" }}>
      {sources.map((s) => (
        <li
          key={s.url}
          style={{
            borderBottom: "1px solid var(--line)",
            padding: "0.65em 0",
          }}
        >
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontWeight: 600 }}
          >
            {s.label}
          </a>
          <div
            style={{
              fontSize: "0.8em",
              color: "var(--ink-soft)",
              fontFamily: "var(--font-mono)",
              wordBreak: "break-all",
            }}
          >
            {s.url}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RumorHedge({ entity, subject = "this model" }) {
  if (!entity || !entity.isRumor) return null;
  return (
    <Callout tone="warn">
      <strong>Unconfirmed / rumored.</strong> {entity.name} has not been
      officially confirmed by a developer. Treat every claim about {subject}{" "}
      as speculative until a primary source verifies it.
    </Callout>
  );
}

export function MissingEntity({ slug }) {
  return (
    <section>
      <h2>Not enough data yet</h2>
      <p style={{ color: "var(--ink-soft)" }}>
        We don&apos;t have a tracked entity for &ldquo;{slug}&rdquo;. It may
        have been renamed, merged, or dropped below the tracking threshold.
      </p>
    </section>
  );
}

export const tableStyles = {
  table: {
    width: "100%",
    borderCollapse: "collapse",
    margin: "1em 0",
    fontSize: "0.95em",
  },
  th: {
    textAlign: "left",
    padding: "0.6em 0.75em",
    borderBottom: "2px solid var(--line)",
    color: "var(--ink-soft)",
    fontWeight: 600,
    fontSize: "0.85em",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  td: {
    padding: "0.6em 0.75em",
    borderBottom: "1px solid var(--line)",
    color: "var(--ink)",
  },
};
