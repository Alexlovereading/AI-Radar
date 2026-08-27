// Generates the three keyword batches used for SEO/landing-page prep once an entity crosses
// a "worth acting on" score threshold. Pure string templating, no external data — the
// batches and exact phrasing are as specified by the user.

/**
 * @param {string} entityName - display name of the entity, e.g. "GPT-5.5"
 * @returns {{ launchDay: string[], usage: string[], competition: string[] }}
 */
export function generateKeywordMatrix(entityName) {
  const name = String(entityName).trim();

  const launchDay = [
    `"${name}"`,
    `"${name} ai"`,
    `"${name} model"`,
    `"${name} official"`,
    `"${name} openrouter"`,
    `"${name} benchmark"`,
    `"${name} context window"`,
    `"who made ${name}"`,
  ];

  const usage = [
    `"${name} api"`,
    `"${name} pricing"`,
    `"how to use ${name}"`,
    `"${name} free"`,
    `"${name} download"`,
    `"${name} login"`,
  ];

  const competition = [
    `"${name} vs claude"`,
    `"${name} vs gpt"`,
    `"${name} vs gemini"`,
    `"${name} alternative"`,
    `"best ${name} prompts"`,
  ];

  return { launchDay, usage, competition };
}

export default generateKeywordMatrix;
