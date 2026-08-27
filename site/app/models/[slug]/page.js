import { loadEntity } from "../../../lib/entities.mjs";

const STATUS_LABEL = {
  confirmed: "confirmed",
  "public-preview": "in public preview",
  rumored: "rumored",
  unknown: "in an unknown status",
};

export default async function ModelOverviewPage({ params }) {
  const entity = await loadEntity(params.slug);

  if (!entity) {
    return null;
  }

  const developerKnown = entity.developer && entity.developer !== "unknown";
  const statusPhrase = STATUS_LABEL[entity.status] ?? "in an unknown status";

  return (
    <>
      <section>
        <h2>What we know</h2>
        <div className="prose">
          {entity.isRumor && (
            <p>
              This is currently unconfirmed. Treat the details below as
              speculation until an official source or a verified model ID
              appears.
            </p>
          )}
          <p>
            {entity.name} is currently tracked as{" "}
            {statusPhrase}
            {developerKnown ? (
              <> and attributed to {entity.developer}</>
            ) : (
              <>. The developer behind it is not yet known</>
            )}
            .{" "}
            {entity.officialModelId ? (
              <>
                It is referenced under the model ID{" "}
                <code>{entity.officialModelId}</code>.
              </>
            ) : (
              <>No official model ID has been confirmed.</>
            )}
          </p>
          <p>
            This entity has been assigned a tracking score of{" "}
            {entity.score}, based on the signals observed at the time it was
            last verified on {entity.lastVerified}. Anything not stated here
            is simply not yet known — we do not fill gaps with generic or
            invented detail.
          </p>
        </div>
      </section>

      <section>
        <h2>Sources</h2>
        {entity.sources && entity.sources.length > 0 ? (
          <ul className="sources-list">
            {entity.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="prose">No sources recorded yet.</p>
        )}
      </section>
    </>
  );
}
