import { loadEntity } from "../../../lib/entities.mjs";
import { Callout, tableStyles } from "../../models/[slug]/_ui.js";

function humanizeSlug(slug) {
  const ACRONYMS = new Set(["gpt", "ai", "llm", "api", "lm"]);
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

export async function generateMetadata({ params }) {
  const { pair } = params;
  return { title: `${humanizeSlug(pair)} comparison — AI Word Radar` };
}

export default async function ComparePage({ params }) {
  const { pair } = params;
  const [slugA, slugB] = (pair || "").split("-vs-");

  if (!slugA || !slugB) {
    return (
      <section>
        <h1>Not enough data yet</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          &ldquo;{pair}&rdquo; isn&apos;t a recognized comparison URL.
          Expected the shape <code className="mono">a-vs-b</code>.
        </p>
      </section>
    );
  }

  const entityA = await loadEntity(slugA);
  const entityB = await loadEntity(slugB);

  if (!entityA) {
    return (
      <section>
        <h1>Not enough data yet</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          We don&apos;t have a tracked entity for &ldquo;{slugA}&rdquo;, so
          there&apos;s nothing verified to compare here yet.
        </p>
      </section>
    );
  }

  const nameA = entityA.name;
  const nameB = entityB ? entityB.name : humanizeSlug(slugB);

  const rows = [
    ["Developer", entityA.developer || "Unknown", entityB ? entityB.developer || "Unknown" : "not tracked"],
    ["Status", entityA.status, entityB ? entityB.status : "not tracked"],
    ["Official ID", entityA.officialModelId || "—", entityB ? entityB.officialModelId || "—" : "not tracked"],
    ["Last verified", entityA.lastVerified, entityB ? entityB.lastVerified : "not tracked"],
  ];

  return (
    <section>
      <h1>
        {nameA} vs {nameB}
      </h1>

      {(entityA.isRumor || (entityB && entityB.isRumor)) && (
        <Callout tone="warn">
          <strong>Unconfirmed data involved.</strong>{" "}
          {entityA.isRumor ? nameA : nameB} is currently rumored, not
          officially confirmed. Treat this comparison as provisional.
        </Callout>
      )}

      {!entityB && (
        <Callout tone="neutral">
          &ldquo;{slugB}&rdquo; isn&apos;t a tracked entity in our data —
          it&apos;s shown here only as a generic comparison anchor, with no
          fabricated details attached to it.
        </Callout>
      )}

      <table style={tableStyles.table}>
        <thead>
          <tr>
            <th style={tableStyles.th}>Field</th>
            <th style={tableStyles.th}>{nameA}</th>
            <th style={tableStyles.th}>{nameB}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td style={tableStyles.td}>{label}</td>
              <td style={tableStyles.td}>{a}</td>
              <td style={{ ...tableStyles.td, color: entityB ? "var(--ink)" : "var(--ink-soft)" }}>
                {b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: "0.85em", color: "var(--ink-soft)" }}>
        Data shown for {nameA} reflects what&apos;s been independently
        verified and tracked — nothing here is estimated.
      </p>
    </section>
  );
}
