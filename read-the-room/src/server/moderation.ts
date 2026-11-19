// Lightweight guardrails for community-submitted prompts. Mods remain the
// real safety net (suggestions need votes AND can be cleared via the mod menu),
// but this blocks the obvious junk before it is ever shown to anyone.

// Word-boundary match so "cocktail", "Essex", "Dickens" etc. are not blocked.
// Slur stems match as prefixes (e.g. "retard" -> "retarded").
const BLOCKED_WORDS = [
  'nazi', 'hitler', 'kys', 'suicide', 'rape', 'porn', 'sex', 'sexy', 'nude', 'nudes',
  'cock', 'pussy', 'dick', 'cunt', 'whore', 'slut',
  'trump', 'biden', 'modi', 'putin', 'israel', 'palestine', 'abortion', 'religion',
];
const BLOCKED_STEMS = ['nigg', 'fag', 'retard', 'kill yourself'];
const BLOCKED_RE = new RegExp(
  `\\b(?:${BLOCKED_WORDS.join('|')})\\b|\\b(?:${BLOCKED_STEMS.join('|')})|https?:|www\\.|\\.(?:com|net|org|gg|io)\\b`,
  'i',
);

export const LIMITS = { q: 70, label: 24, minLen: 2 } as const;

export type CleanPrompt = { q: string; a: string; b: string };

function normalize(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

/** Returns a cleaned prompt or an error message suitable for the user. */
export function validateSuggestion(input: { q?: unknown; a?: unknown; b?: unknown }):
  | { ok: true; value: CleanPrompt }
  | { ok: false; error: string } {
  const q = normalize(input.q);
  const a = normalize(input.a);
  const b = normalize(input.b);

  if (q.length < 5 || q.length > LIMITS.q) return { ok: false, error: `Question must be 5–${LIMITS.q} characters.` };
  for (const opt of [a, b]) {
    if (opt.length < LIMITS.minLen || opt.length > LIMITS.label)
      return { ok: false, error: `Options must be ${LIMITS.minLen}–${LIMITS.label} characters.` };
  }
  if (a.toLowerCase() === b.toLowerCase()) return { ok: false, error: 'The two options must be different.' };

  if (BLOCKED_RE.test(`${q} ${a} ${b}`))
    return { ok: false, error: 'Keep it fun and lighthearted — no politics, NSFW, or links.' };

  return { ok: true, value: { q, a, b } };
}
