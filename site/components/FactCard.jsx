// React Server Component — no interactivity, no "use client" needed.
//
// Standalone reusable fact-card for rendering an entity's key facts. This is
// provided as a reference/alternative implementation: if site/app/models/[slug]
// already renders its own inline fact-card, that file is left untouched — this
// component is available to import from wherever a "Developer / Status /
// Official model ID / Last verified" block is needed.

import styles from "./FactCard.module.css";

const STATUS_LABELS = {
  "public-preview": "Public preview",
  rumored: "Rumored",
  confirmed: "Confirmed",
  unknown: "Unknown",
};

function formatDeveloper(developer) {
  if (!developer || developer === "unknown") return "Unknown";
  return developer;
}

function formatStatus(status) {
  return STATUS_LABELS[status] ?? "Unknown";
}

function formatOfficialModelId(id) {
  return id ?? "Unknown";
}

export default function FactCard({ entity }) {
  if (!entity) return null;

  const developer = formatDeveloper(entity.developer);
  const officialModelId = formatOfficialModelId(entity.officialModelId);

  return (
    <div className={styles.card}>
      {entity.isRumor && (
        <div className={styles.rumorBadge}>
          <span aria-hidden="true">⚠</span>
          <span>Rumor / speculation — not independently confirmed</span>
        </div>
      )}
      <div className={styles.row}>
        <span className={styles.label}>Developer:</span>
        <span
          className={
            developer === "Unknown" ? styles.valueUnknown : styles.value
          }
        >
          {developer}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Status:</span>
        <span className={styles.value}>{formatStatus(entity.status)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Official model ID:</span>
        <span
          className={
            officialModelId === "Unknown" ? styles.valueUnknown : styles.value
          }
        >
          {officialModelId}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Last verified:</span>
        <span className={styles.value}>{entity.lastVerified ?? "Unknown"}</span>
      </div>
    </div>
  );
}
