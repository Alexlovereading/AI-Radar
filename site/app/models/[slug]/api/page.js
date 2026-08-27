import { loadEntity } from "../../../../lib/entities.mjs";
import { Callout, SourceLinks, RumorHedge, MissingEntity } from "../_ui.js";

export default async function ApiPage({ params }) {
  const { slug } = params;
  const entity = await loadEntity(slug);

  if (!entity) return <MissingEntity slug={slug} />;

  return (
    <section>
      <h2>API access</h2>

      <RumorHedge entity={entity} subject="the API pattern below" />

      {entity.officialModelId ? (
        <>
          <p>
            The tracked official model ID for {entity.name} is{" "}
            <code className="mono">{entity.officialModelId}</code>. Many
            model marketplaces (OpenRouter, Together, Fireworks, and
            similar) expose an OpenAI-compatible chat completions endpoint,
            so a request would <em>typically</em> take a shape like this:
          </p>

          <pre
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "1em",
              overflowX: "auto",
              fontSize: "0.85em",
            }}
          >
            <code className="mono">{`curl https://<platform-api-base>/v1/chat/completions \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${entity.officialModelId}",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'`}</code>
          </pre>

          <Callout tone="warn">
            <strong>This is an illustrative pattern, not a verified
            endpoint.</strong> We have not confirmed that{" "}
            <code className="mono">{entity.officialModelId}</code> is
            reachable at any specific base URL, that it accepts this exact
            request shape, or that API access is even open yet. Confirm
            everything — base URL, auth, model ID, availability — against
            the source link below before writing real code against it.
          </Callout>
        </>
      ) : (
        <Callout tone="neutral">
          No official model ID is on file for {entity.name} yet, so we
          can&apos;t even sketch a plausible API call. Check the sources
          below for anything more specific.
        </Callout>
      )}

      <h3>Verify at the source</h3>
      <SourceLinks sources={entity.sources} />
    </section>
  );
}
