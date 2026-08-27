import { loadEntity } from "../../../../lib/entities.mjs";
import { Callout, RumorHedge, MissingEntity } from "../_ui.js";

export default async function NewsPage({ params }) {
  const { slug } = params;
  const entity = await loadEntity(slug);

  if (!entity) return <MissingEntity slug={slug} />;

  const hasSources = entity.sources && entity.sources.length > 0;

  return (
    <section>
      <h2>News &amp; updates</h2>

      <RumorHedge entity={entity} subject="every item below" />

      <p style={{ color: "var(--ink-soft)" }}>
        This page tracks every signal we&apos;ve captured for {entity.name}.
        It&apos;s currently a flat list of sources rather than a true
        timeline — once the monitoring pipeline&apos;s event history
        (<code className="mono">events.jsonl</code>) is wired into this
        page, entries here will carry real detection timestamps and update
        automatically as new signals come in.
      </p>

      {hasSources ? (
        <ol style={{ padding: 0, margin: "1.5em 0", listStyle: "none" }}>
          {entity.sources.map((s, i) => (
            <li
              key={s.url}
              style={{
                display: "flex",
                gap: "1em",
                padding: "0.9em 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--ink-soft)",
                  fontSize: "0.85em",
                  minWidth: "2em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
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
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Callout tone="neutral">
          No sources captured for {entity.name} yet.
        </Callout>
      )}

      <p style={{ fontSize: "0.85em", color: "var(--ink-soft)" }}>
        Last verified: {entity.lastVerified}
      </p>
    </section>
  );
}
