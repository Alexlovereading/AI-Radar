import { loadEntity } from "../../../../lib/entities.mjs";
import { Callout, RumorHedge, MissingEntity } from "../_ui.js";

// Deliberately generic and templated: real, well-known model families,
// not a ranked or fabricated "better than X" comparison. We don't have
// enough verified data on most tracked entities to claim comparative
// superiority, so this stays framed as "if you're evaluating options."
const GENERIC_ALTERNATIVES = [
  {
    group: "Major general-purpose assistants",
    items: [
      "GPT models (OpenAI)",
      "Claude models (Anthropic)",
      "Gemini models (Google DeepMind)",
    ],
  },
  {
    group: "Open-weight options",
    items: [
      "Llama models (Meta)",
      "Qwen models (Alibaba)",
      "DeepSeek models (DeepSeek)",
    ],
  },
];

export default async function AlternativesPage({ params }) {
  const { slug } = params;
  const entity = await loadEntity(slug);

  if (!entity) return <MissingEntity slug={slug} />;

  return (
    <section>
      <h2>Alternatives</h2>

      <RumorHedge
        entity={entity}
        subject="how it stacks up against anything below"
      />

      <p>
        If you&apos;re evaluating options alongside {entity.name}, here are
        well-known, real model families worth putting on your shortlist.
        This is a general reference list, not a ranking — we don&apos;t
        have verified head-to-head data comparing {entity.name} against any
        of these.
      </p>

      {GENERIC_ALTERNATIVES.map((group) => (
        <div key={group.group}>
          <h3>{group.group}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}

      <Callout tone="neutral">
        Also worth checking: whatever marketplace or platform{" "}
        {entity.name} itself is listed on (see the{" "}
        <a href={`/models/${entity.slug}/how-to-use`}>how to use</a> page)
        usually surfaces other comparable models side by side, often with
        live pricing and benchmark filters we don&apos;t maintain here.
      </Callout>
    </section>
  );
}
