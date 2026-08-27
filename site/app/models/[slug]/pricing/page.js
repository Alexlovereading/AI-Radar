import { loadEntity } from "../../../../lib/entities.mjs";
import { Callout, RumorHedge, MissingEntity, tableStyles } from "../_ui.js";

// The entity contract (CONTRACT.md section 6) has no pricing field. This
// page is deliberately built as an empty shell — a table shape that will
// light up the moment real pricing data gets added upstream — rather than
// guessing at numbers now.
const PRICE_ROWS = [
  { label: "Input (per 1M tokens)" },
  { label: "Output (per 1M tokens)" },
  { label: "Context window" },
  { label: "Free tier" },
];

export default async function PricingPage({ params }) {
  const { slug } = params;
  const entity = await loadEntity(slug);

  if (!entity) return <MissingEntity slug={slug} />;

  return (
    <section>
      <h2>Pricing</h2>

      <RumorHedge entity={entity} subject="any pricing figures" />

      <Callout tone="neutral">
        Pricing not publicly confirmed yet for {entity.name}. We don&apos;t
        fabricate numbers here — this table will populate automatically once
        a verified rate is captured from a tracked source.
      </Callout>

      <table style={tableStyles.table}>
        <thead>
          <tr>
            <th style={tableStyles.th}>Metric</th>
            <th style={tableStyles.th}>Value</th>
          </tr>
        </thead>
        <tbody>
          {PRICE_ROWS.map((row) => (
            <tr key={row.label}>
              <td style={tableStyles.td}>{row.label}</td>
              <td style={{ ...tableStyles.td, color: "var(--ink-soft)" }}>
                —
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: "var(--ink-soft)", fontSize: "0.9em" }}>
        If {entity.name} is listed on a model marketplace (see the
        {" "}
        <a href={`/models/${entity.slug}/how-to-use`}>how to use</a> page),
        that listing&apos;s own pricing panel is the most current source —
        this page has not yet been wired up to ingest it automatically.
      </p>
    </section>
  );
}
