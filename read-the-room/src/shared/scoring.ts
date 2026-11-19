// Pure scoring logic shared by client (previews) and server (authoritative).
// Kept dependency-free so it can be unit-tested.

export const PROMPTS_PER_DAY = 5;
export const MAX_POINTS_PER_PROMPT = 100;
export const MAX_POINTS_PER_DAY = PROMPTS_PER_DAY * MAX_POINTS_PER_PROMPT;

/**
 * Virtual votes added (split evenly) so the first few players aren't scored
 * against a "room" of 1-2 people. Fades out naturally as real votes arrive.
 */
export const PRIOR_VOTES = 4;

export type Tally = { a: number; b: number };

/** % of the room that picked A, smoothed with the prior. 0..100, 1 decimal. */
export function scoringPctA(t: Tally): number {
  const half = PRIOR_VOTES / 2;
  const pct = ((t.a + half) / (t.a + t.b + PRIOR_VOTES)) * 100;
  return Math.round(pct * 10) / 10;
}

/** Raw % of real votes that picked A (what we show players). */
export function displayPctA(t: Tally): number {
  const total = t.a + t.b;
  if (total === 0) return 50;
  return Math.round((t.a / total) * 100);
}

/** Every point of error costs 2 points: perfect = 100, 50% off = 0. */
export function pointsFor(guessPctA: number, actualPctA: number): number {
  const guess = clamp(Math.round(guessPctA), 0, 100);
  const err = Math.abs(guess - actualPctA);
  return clamp(Math.round(MAX_POINTS_PER_PROMPT - err * 2), 0, MAX_POINTS_PER_PROMPT);
}

export type Grade = 'bullseye' | 'close' | 'off' | 'miss';

export function gradeFor(points: number): Grade {
  if (points >= 94) return 'bullseye';
  if (points >= 75) return 'close';
  if (points >= 45) return 'off';
  return 'miss';
}

export const GRADE_EMOJI: Record<Grade, string> = {
  bullseye: '🎯',
  close: '🟩',
  off: '🟨',
  miss: '🟥',
};

export type Title = { name: string; emoji: string; min: number };

/** Daily titles, highest first. Used for summary + user flair. */
export const TITLES: Title[] = [
  { name: 'Mind Reader', emoji: '🔮', min: 450 },
  { name: 'Room Reader', emoji: '🧠', min: 380 },
  { name: 'Vibe Checker', emoji: '📡', min: 300 },
  { name: 'Hot Take Haver', emoji: '🌶️', min: 200 },
  { name: 'Certified Contrarian', emoji: '🙃', min: 0 },
];

export function titleFor(score: number): Title {
  return TITLES.find((t) => score >= t.min) ?? TITLES[TITLES.length - 1]!;
}

/** Streak update. Only the current day's round extends a streak. */
export function nextStreak(prevStreak: number, lastDay: number | undefined, day: number): number {
  if (lastDay === day) return prevStreak; // already counted today
  if (lastDay === day - 1) return prevStreak + 1;
  return 1;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
