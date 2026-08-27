// Feishu (Lark) incoming-webhook notifier.
//
// Sends a plain-text message (the simple, reliable payload shape) rather than an interactive
// card, since card schemas are easy to get subtly wrong and a broken card silently fails to
// render in Feishu. If FEISHU_WEBHOOK_URL isn't set, this warns and skips — it never throws,
// so a missing webhook can't take down the rest of the run.
//
// Only entities scoring >= 30 ("reserve" tier or above) should be notified — callers
// (scripts/run-all.mjs) are expected to filter before calling this, but notifyEntity()
// also enforces the threshold itself as a safety net.

const MIN_NOTIFY_SCORE = 30;

/**
 * @param {{ name: string, score: number, tier: string, items: Array<{ url?: string, sourceLabel?: string }> }} entity
 * @returns {Promise<boolean>} true if a notification was sent, false if skipped
 */
export async function notifyEntity(entity) {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[feishu] FEISHU_WEBHOOK_URL not set — skipping notification.");
    return false;
  }

  if (typeof entity?.score !== "number" || entity.score < MIN_NOTIFY_SCORE) {
    // Not an error condition, just a no-op below threshold.
    return false;
  }

  const topSource = pickTopSource(entity.items);
  const text = buildMessageText(entity, topSource);

  const payload = {
    msg_type: "text",
    content: { text },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[feishu] webhook POST failed: HTTP ${res.status}`);
      return false;
    }
    const body = await res.json().catch(() => ({}));
    if (body?.code && body.code !== 0) {
      console.warn(`[feishu] webhook responded with error: ${JSON.stringify(body)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[feishu] webhook POST threw: ${err.message}`);
    return false;
  }
}

function pickTopSource(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  // "Top" = most recently detected, since that's the freshest confirmation we have.
  return [...items].sort((a, b) =>
    new Date(b.detectedAt ?? 0) - new Date(a.detectedAt ?? 0)
  )[0];
}

function buildMessageText(entity, topSource) {
  const lines = [
    `AI Word Radar: "${entity.name}"`,
    `Score: ${entity.score} (${entity.tier})`,
  ];
  if (topSource?.url) {
    lines.push(`Top source: ${topSource.sourceLabel ?? topSource.source ?? "unknown"} — ${topSource.url}`);
  }
  return lines.join("\n");
}

export default notifyEntity;
