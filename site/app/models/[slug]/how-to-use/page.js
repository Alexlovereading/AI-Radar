import { loadEntity } from "../../../../lib/entities.mjs";
import { Callout, SourceLinks, RumorHedge, MissingEntity } from "../_ui.js";

// Known model marketplaces / inference platforms we can confidently point
// readers toward when a source URL resolves to one of them. Anything not
// in this list still gets linked, just without the "here's how to use a
// listing on X" framing.
const KNOWN_PLATFORMS = [
  { match: "openrouter.ai", name: "OpenRouter" },
  { match: "huggingface.co", name: "Hugging Face" },
  { match: "replicate.com", name: "Replicate" },
  { match: "together.ai", name: "Together AI" },
  { match: "fireworks.ai", name: "Fireworks AI" },
  { match: "ollama.com", name: "Ollama" },
  { match: "fal.ai", name: "fal.ai" },
];

function findPlatformSource(sources) {
  if (!sources) return null;
  for (const s of sources) {
    const hit = KNOWN_PLATFORMS.find((p) => s.url && s.url.includes(p.match));
    if (hit) return { source: s, platform: hit.name };
  }
  return null;
}

export default async function HowToUsePage({ params }) {
  const { slug } = params;
  const entity = await loadEntity(slug);

  if (!entity) return <MissingEntity slug={slug} />;

  const platformHit = findPlatformSource(entity.sources);

  return (
    <section>
      <h2>How to use {entity.name}</h2>

      <RumorHedge entity={entity} subject="any usage instructions below" />

      {platformHit ? (
        <>
          <p>
            {entity.name} is currently listed on{" "}
            <strong>{platformHit.platform}</strong>
            {entity.officialModelId ? (
              <>
                {" "}
                under the model ID{" "}
                <code className="mono">{entity.officialModelId}</code>
              </>
            ) : null}
            . The official listing below is the most reliable place to check
            current availability, quota, and access requirements — this page
            does not maintain its own copy of that information.
          </p>
          <h3>Official listing</h3>
          <SourceLinks sources={[platformHit.source]} />
          <Callout tone="info">
            Follow the link above, look for a &ldquo;Deploy&rdquo;,
            &ldquo;API&rdquo;, or &ldquo;Playground&rdquo; entry point on the
            listing page, and confirm the exact model identifier matches{" "}
            {entity.officialModelId ? (
              <code className="mono">{entity.officialModelId}</code>
            ) : (
              "what's shown here"
            )}{" "}
            before wiring it into anything.
          </Callout>
        </>
      ) : (
        <>
          <Callout tone="neutral">
            Setup instructions aren&apos;t published yet for {entity.name}.
            No source we&apos;re tracking points to a marketplace listing,
            playground, or documented access path.
          </Callout>
          <p style={{ color: "var(--ink-soft)" }}>
            Check the sources below directly — one of them may lead to
            access details that aren&apos;t structured data yet.
          </p>
        </>
      )}

      <h3>All tracked sources</h3>
      <SourceLinks sources={entity.sources} />
    </section>
  );
}
