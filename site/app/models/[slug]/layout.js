import { loadEntity } from "../../../lib/entities.mjs";

const STATUS_LABEL = {
  confirmed: "Confirmed",
  "public-preview": "Public preview",
  rumored: "Rumored",
  unknown: "Unknown",
};

export default async function ModelLayout({ children, params }) {
  const entity = await loadEntity(params.slug);

  if (!entity) {
    return (
      <main className="container">
        <div className="not-found">
          <h1>Model not found</h1>
          <p className="prose">
            We don&apos;t have a tracked entity for &quot;{params.slug}&quot;.
            It may have been removed, or the link may be incorrect.
          </p>
        </div>
      </main>
    );
  }

  const statusLabel = STATUS_LABEL[entity.status] ?? "Unknown";
  const developerLabel =
    !entity.developer || entity.developer === "unknown" ? "Unknown" : entity.developer;

  return (
    <main className="container">
      <div className="fact-card">
        <div className="fact-card-title">
          <h1>{entity.name}</h1>
          {entity.isRumor && (
            <span className="rumor-badge">⚠ 传闻 / 未经证实</span>
          )}
        </div>
        <dl className="fact-grid">
          <div>
            <dt>Developer</dt>
            <dd>{developerLabel}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div>
            <dt>Official model ID</dt>
            <dd>{entity.officialModelId ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Last verified</dt>
            <dd>{entity.lastVerified}</dd>
          </div>
        </dl>
      </div>

      <nav className="model-nav" aria-label="Model sections">
        <a href={`/models/${entity.slug}`}>首页</a>
        <a href={`/models/${entity.slug}/how-to-use`}>How to Use</a>
        <a href={`/models/${entity.slug}/pricing`}>Pricing</a>
        <a href={`/models/${entity.slug}/api`}>API</a>
        <a href={`/models/${entity.slug}/benchmarks`}>Benchmarks</a>
        <a href={`/models/${entity.slug}/alternatives`}>Alternatives</a>
        <a href={`/models/${entity.slug}/news`}>News</a>
      </nav>

      {children}
    </main>
  );
}
