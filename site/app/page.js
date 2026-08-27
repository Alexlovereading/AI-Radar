import Link from "next/link";
import { loadAllEntities } from "../lib/entities.mjs";

const STATUS_LABEL = {
  confirmed: "Confirmed",
  "public-preview": "Public preview",
  rumored: "Rumored",
  unknown: "Unknown",
};

function StatusPill({ status }) {
  const label = STATUS_LABEL[status] ?? "Unknown";
  const modifier = STATUS_LABEL[status] ? status : "unknown";
  return <span className={`status-pill status-pill--${modifier}`}>{label}</span>;
}

export default async function HomePage() {
  const entities = await loadAllEntities();

  return (
    <main className="container">
      <header className="site-header">
        <div className="kicker">AI Word Radar</div>
        <h1>Tracking new AI model releases as they appear</h1>
        <p className="intro">
          AI Model Radar watches model directories, official vendor
          channels, and community discussion for signs that a new AI
          model is about to go viral — including anonymous &quot;stealth&quot;
          releases with no confirmed developer. Every entry below shows
          exactly what has been verified and what has not: we do not
          fabricate a developer, parameters, or pricing for models whose
          origin is unconfirmed.
        </p>
      </header>

      <section>
        <ul className="entity-list">
          {entities.map((entity) => (
            <li key={entity.slug} className="entity-card">
              <div className="entity-card-main">
                <Link href={`/models/${entity.slug}`} className="entity-card-name">
                  {entity.name}
                </Link>
              </div>
              <div className="entity-card-meta">
                <StatusPill status={entity.status} />
                <span className="score-badge">score {entity.score}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
