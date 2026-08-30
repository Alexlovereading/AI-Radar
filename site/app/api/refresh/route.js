import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

// Matches the radar.yml cron cadence, so a manual click can't outrun the
// scheduled run and double up on scraping/API-quota usage.
const COOLDOWN_MS = 20 * 60 * 1000;
const COOLDOWN_KEY = "last-manual-refresh";

function json(body, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request) {
  const { env } = await getCloudflareContext({ async: true });

  let token = "";
  try {
    const body = await request.json();
    token = typeof body?.token === "string" ? body.token : "";
  } catch {
    // no/invalid body -> falls through to the invalid-token response below
  }

  if (!env.REFRESH_ACCESS_TOKEN || token !== env.REFRESH_ACCESS_TOKEN) {
    return json({ ok: false, error: "invalid_token" }, 401);
  }

  const kv = env.REFRESH_KV;
  if (kv) {
    const last = await kv.get(COOLDOWN_KEY);
    if (last) {
      const elapsedMs = Date.now() - Number(last);
      if (elapsedMs < COOLDOWN_MS) {
        return json(
          {
            ok: false,
            error: "cooldown",
            retryAfterSeconds: Math.ceil((COOLDOWN_MS - elapsedMs) / 1000),
          },
          429
        );
      }
    }
  }

  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPO) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const [owner, repo] = env.GITHUB_REPO.split("/");
  const githubResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/radar.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-word-radar-site",
      },
      body: JSON.stringify({ ref: env.GITHUB_REF || "main" }),
    }
  );

  if (!githubResponse.ok) {
    const detail = await githubResponse.text().catch(() => "");
    return json(
      { ok: false, error: "github_error", detail: detail.slice(0, 300) },
      502
    );
  }

  if (kv) {
    await kv.put(COOLDOWN_KEY, String(Date.now()), {
      expirationTtl: Math.ceil(COOLDOWN_MS / 1000) + 60,
    });
  }

  return json({ ok: true });
}
