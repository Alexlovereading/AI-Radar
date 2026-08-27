import { loadEntity } from "../../../../lib/entities.mjs";
import { Callout, RumorHedge, MissingEntity } from "../_ui.js";

const EXTERNAL_BENCHMARK_RESOURCES = [
  {
    label: "LM Arena",
    url: "https://lmarena.ai",
    note: "Community head-to-head voting across many models.",
  },
  {
    label: "Artificial Analysis",
    url: "https://artificialanalysis.ai",
    note: "Independent quality, speed, and price comparisons.",
  },
];

export default async function BenchmarksPage({ params }) {
  const { slug } = params;
  const entity = await loadEntity(slug);

  if (!entity) return <MissingEntity slug={slug} />;

  return (
    <section>
      <h2>Benchmarks</h2>

      <RumorHedge entity={entity} subject="benchmark performance" />

      <Callout tone="neutral">
        No independent benchmark results are on file for {entity.name}
        {entity.isRumor ? " — it hasn't even been officially confirmed yet" : ""}.
        We don&apos;t estimate or infer scores here; this section only
        fills in once a verified benchmark run for this exact entity is
        captured.
      </Callout>

      <h3>Where benchmark data typically surfaces</h3>
      <p style={{ color: "var(--ink-soft)" }}>
        These are general-purpose leaderboards worth checking directly —
        they are not a report on {entity.name} specifically, and a listing
        appearing (or not appearing) there isn&apos;t confirmed by us:
      </p>
      <ul>
        {EXTERNAL_BENCHMARK_RESOURCES.map((r) => (
          <li key={r.url} style={{ margin: "0.5em 0" }}>
            <a href={r.url} target="_blank" rel="noopener noreferrer">
              {r.label}
            </a>{" "}
            <span style={{ color: "var(--ink-soft)" }}>— {r.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
