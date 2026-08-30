// Shared "is this worth surfacing?" filter, used in two places:
//   1. scrapers/model-directories/huggingface.mjs — at collection time, so low-signal
//      repos never enter data/events.jsonl in the first place.
//   2. scripts/build-site-data.mjs — at display time, so junk recorded before this
//      filter existed is hidden from the site without rewriting the append-only log.
//
// Rationale: Hugging Face sees hundreds of new repos per hour, the overwhelming
// majority of which are test repos, student fine-tunes, LoRA adapters, and quant
// conversions of existing models. The radar's purpose is to catch *notable* new
// models and announcements early — so HF items are only kept when they come from
// a known major org, or show real traction (trending), and never when the name
// matches a known junk pattern.

// Hugging Face orgs (the part before "/" in a model id, lowercased) whose new repos
// are inherently newsworthy. Extends the MAJOR_LAB_SOURCES concept in
// scoring/score.mjs from official-blog sources to HF org accounts.
const MAJOR_HF_ORGS = new Set([
  "meta-llama",
  "google",
  "microsoft",
  "openai",
  "qwen",
  "deepseek-ai",
  "mistralai",
  "moonshotai",
  "zai-org",
  "minimaxai",
  "stepfun-ai",
  "baichuan-inc",
  "01-ai",
  "internlm",
  "thudm",
  "bigscience",
  "eleutherai",
  "stabilityai",
  "tiiuae",
  "allenai",
  "coherelabs",
  "nvidia",
  "apple",
  "ibm-granite",
  "tencentarc",
  "bytedance-seed",
  "black-forest-labs",
  "kwai-kolors",
  "openbmb",
  "hunyuan",
  "tencent",
]);

// Name patterns that are essentially never a notable new model. Matched against the
// full "org/repo" id. Deliberately conservative: a false negative here just means a
// borderline repo gets scored normally, a false positive would hide a real model.
const JUNK_PATTERNS = [
  // throwaway / tutorial repos
  /\b(test|testing|demo|sample|example|tutorial|playground|scratch|hello[-_]?world)\b/i,
  /\bmy[-_]?(awesome[-_]?)?model\b/i,
  // quant / format conversions of an existing model (gguf, mlx, awq, ...)
  /[-_](gguf|mlx|awq|gptq|exl2|exl3|int4|int8|fp8|mxfp4|mxfp8|bnb|4bit|8bit)([-_.]|$)/i,
  // adapters and fine-tunes of an existing model (lora, -ft, checkpoint, ...)
  /[-_](lora|qlora|adapter|checkpoint|ckpt|ft|finetuned|fine[-_]?tuned)([-_.]|$)/i,
];

// Repo names like "co21", "ab3" — a couple of letters plus a counter, typical of
// automated/experimental uploads. Applied to the repo part only.
const SERIAL_NAME_PATTERN = /^[a-z]{1,4}[-_]?\d+$/i;

export function hfOrgOf(modelId) {
  return String(modelId).split("/")[0]?.toLowerCase() ?? "";
}

export function isMajorOrg(modelId) {
  return MAJOR_HF_ORGS.has(hfOrgOf(modelId));
}

export function matchesJunkPattern(modelId) {
  const id = String(modelId);
  if (JUNK_PATTERNS.some((re) => re.test(id))) return true;
  const repo = id.split("/")[1] ?? "";
  return SERIAL_NAME_PATTERN.test(repo);
}

// Minimal early-traction bar. Newly created repos sit at 0/0, so this effectively
// identifies items that came in via the trending feed or gained quick attention.
export function hasTraction(meta) {
  const likes = typeof meta?.likes === "number" ? meta.likes : 0;
  const downloads = typeof meta?.downloads === "number" ? meta.downloads : 0;
  return likes >= 10 || downloads >= 1000;
}

// Google Trends' public RSS is *all* US trending searches — sports, betting, celebrity
// gossip included. The radar only cares about AI-related terms, so anything that
// doesn't mention AI / a known model or lab is noise for this project.
const AI_TERM_PATTERN =
  /\b(ai|artificial intelligence|llm|gpt[-\s]?\d*|chatgpt|claude|gemini|deepseek|qwen|mistral|llama|grok|kimi|copilot|openai|anthropic|deepmind|midjourney|sora|stable diffusion|veo|nano banana|machine learning|neural network|language model|chatbot)\b/i;

export function isAiRelated(text) {
  return AI_TERM_PATTERN.test(String(text ?? ""));
}

// One item-level verdict. Hugging Face items are filtered by org/junk/traction;
// Google Trends items must be AI-related. Official-source and other community items
// (vendor blogs, HN's AI-keyword search results) are inherently curated and pass.
export function isLowSignalItem(item) {
  if (item?.source === "google-trends") {
    return !isAiRelated(item.name);
  }
  if (item?.source !== "huggingface") return false;
  const id = item.id ?? item.name ?? "";
  if (isMajorOrg(id)) return false;
  if (matchesJunkPattern(id)) return true;
  return !hasTraction(item.meta);
}
