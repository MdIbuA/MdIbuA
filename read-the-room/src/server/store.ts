import { redis } from '@devvit/web/server';
import type { LeaderboardEntry, Pick, Prompt, Reveal, Suggestion, Summary, UserStats } from '../shared/api';
import {
  GRADE_EMOJI,
  PROMPTS_PER_DAY,
  displayPctA,
  gradeFor,
  nextStreak,
  pointsFor,
  scoringPctA,
  titleFor,
} from '../shared/scoring';
import { CURATED_PROMPTS } from './prompts';

// ---------------------------------------------------------------------------
// Key layout (Redis is already scoped per subreddit installation)
// ---------------------------------------------------------------------------
const K = {
  currentDay: 'rtr:currentDay',
  round: (day: number) => `rtr:round:${day}`,
  postDay: (postId: string) => `rtr:post:${postId}`,
  tally: (day: number, i: number) => `rtr:tally:${day}:${i}`,
  answers: (day: number, userId: string) => `rtr:ans:${day}:${userId}`,
  summary: (day: number, userId: string) => `rtr:sum:${day}:${userId}`,
  dayBoard: (day: number) => `rtr:board:${day}`,
  allTimeBoard: 'rtr:board:all',
  names: 'rtr:names',
  user: (userId: string) => `rtr:user:${userId}`,
  curatedCursor: 'rtr:curatedCursor',
  locks: 'rtr:locks',
  suggPending: 'rtr:sugg:pending', // zset id -> votes
  sugg: (id: string) => `rtr:sugg:${id}`,
  suggVoters: (id: string) => `rtr:sugg:${id}:voters`,
  suggDaily: (userId: string, day: number) => `rtr:sugg:limit:${userId}:${day}`,
} as const;

export type Round = { day: number; createdAt: number; prompts: Prompt[] };

/** Community suggestions need this many upvotes before they can be picked. */
export const SUGGESTION_MIN_VOTES = 2;
/** Max community prompts per round; the rest come from the curated bank. */
export const SUGGESTIONS_PER_ROUND = 2;
export const SUGGESTIONS_PER_USER_PER_DAY = 3;

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
export async function getCurrentDay(): Promise<number> {
  return Number((await redis.get(K.currentDay)) ?? 0);
}

export async function getRound(day: number): Promise<Round | null> {
  const raw = await redis.get(K.round(day));
  return raw ? (JSON.parse(raw) as Round) : null;
}

export async function getDayForPost(postId: string): Promise<number | null> {
  const raw = await redis.get(K.postDay(postId));
  return raw ? Number(raw) : null;
}

/** Simple mutex so the cron job and a mod menu click can't create two rounds at once. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const got = await redis.hSetNX(K.locks, name, String(Date.now()));
  if (!got) {
    // Recover from a crashed holder after 2 minutes.
    const since = Number((await redis.hGet(K.locks, name)) ?? 0);
    if (Date.now() - since < 120_000) return null;
    await redis.hSet(K.locks, { [name]: String(Date.now()) });
  }
  try {
    return await fn();
  } finally {
    await redis.hDel(K.locks, [name]);
  }
}

/** Builds the next round's prompts: top community picks first, then curated. */
export async function buildNextRound(day: number): Promise<Round> {
  const prompts: Prompt[] = [];

  const top = await redis.zRange(K.suggPending, 0, SUGGESTIONS_PER_ROUND - 1, { by: 'rank', reverse: true });
  for (const { member: id, score } of top) {
    if (score < SUGGESTION_MIN_VOTES) break;
    const s = await redis.hGetAll(K.sugg(id));
    if (s.q && s.a && s.b) prompts.push({ id: `s${id}`, q: s.q, a: s.a, b: s.b, author: s.author });
    await redis.zRem(K.suggPending, [id]);
  }

  let cursor = Number((await redis.get(K.curatedCursor)) ?? 0);
  while (prompts.length < PROMPTS_PER_DAY) {
    const p = CURATED_PROMPTS[cursor % CURATED_PROMPTS.length]!;
    prompts.push(p);
    cursor++;
  }
  await redis.set(K.curatedCursor, String(cursor));

  // Shuffle so community prompts aren't always first.
  for (let i = prompts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [prompts[i], prompts[j]] = [prompts[j]!, prompts[i]!];
  }
  return { day, createdAt: Date.now(), prompts };
}

export async function saveRound(round: Round, postId: string): Promise<void> {
  await redis.set(K.round(round.day), JSON.stringify(round));
  await redis.set(K.postDay(postId), String(round.day));
  await redis.set(K.currentDay, String(round.day));
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------
export async function getAnswers(day: number, userId: string): Promise<(Reveal | null)[]> {
  const raw = await redis.hGetAll(K.answers(day, userId));
  return Array.from({ length: PROMPTS_PER_DAY }, (_, i) => {
    const v = raw[String(i)];
    return v && v !== 'pending' ? (JSON.parse(v) as Reveal) : null;
  });
}

export type SubmitResult =
  | { ok: true; reveal: Reveal; completed: boolean }
  | { ok: false; error: string; code: 'BAD_REQUEST' };

export async function submitAnswer(
  day: number,
  userId: string,
  index: number,
  pick: Pick,
  guess: number,
): Promise<SubmitResult> {
  const key = K.answers(day, userId);
  const existing = await redis.hGetAll(key);
  for (let i = 0; i < index; i++) {
    if (!existing[String(i)]) return { ok: false, error: 'Answer the prompts in order.', code: 'BAD_REQUEST' };
  }

  // Write-once reservation: a double tap or retry can never count twice.
  const reserved = await redis.hSetNX(key, String(index), 'pending');
  if (!reserved) {
    const prev = await redis.hGet(key, String(index));
    if (prev && prev !== 'pending') {
      const answers = await getAnswers(day, userId);
      return { ok: true, reveal: JSON.parse(prev) as Reveal, completed: answers.every(Boolean) };
    }
    return { ok: false, error: 'Still saving your last answer — try again.', code: 'BAD_REQUEST' };
  }

  const tallyKey = K.tally(day, index);
  await redis.hIncrBy(tallyKey, pick, 1);
  const t = await redis.hGetAll(tallyKey);
  const tally = { a: Number(t.a ?? 0), b: Number(t.b ?? 0) };

  const scoredPctA = scoringPctA(tally);
  const reveal: Reveal = {
    pick,
    guess: Math.round(guess),
    actualPctA: displayPctA(tally),
    scoredPctA,
    total: tally.a + tally.b,
    points: pointsFor(guess, scoredPctA),
  };
  await redis.hSet(key, { [String(index)]: JSON.stringify(reveal) });

  const answers = await getAnswers(day, userId);
  return { ok: true, reveal, completed: answers.every(Boolean) };
}

export async function getTodayPlayers(day: number): Promise<number> {
  return redis.zCard(K.dayBoard(day));
}

/** Called once when a player finishes all prompts. Idempotent. */
export async function finalizeRound(
  day: number,
  userId: string,
  username: string,
  answers: Reveal[],
): Promise<Summary> {
  const existing = await getSummary(day, userId);
  if (existing) return existing;

  const score = answers.reduce((s, a) => s + a.points, 0);
  const title = titleFor(score);
  const contrarianCount = answers.filter((a) => {
    const myShare = a.pick === 'a' ? a.actualPctA : 100 - a.actualPctA;
    return myShare < 50;
  }).length;

  await redis.zAdd(K.dayBoard(day), { member: userId, score });
  await redis.hSet(K.names, { [userId]: username });
  await redis.zIncrBy(K.allTimeBoard, userId, score);

  // Streaks only advance on the current round, so replaying old posts can't farm them.
  const currentDay = await getCurrentDay();
  const u = await redis.hGetAll(K.user(userId));
  const lastDay = u.lastDay ? Number(u.lastDay) : undefined;
  const prevStreak = Number(u.streak ?? 0);
  const streak = day === currentDay ? nextStreak(prevStreak, lastDay, day) : prevStreak;
  await redis.hSet(K.user(userId), {
    streak: String(streak),
    bestStreak: String(Math.max(streak, Number(u.bestStreak ?? 0))),
    lastDay: String(day === currentDay ? day : (lastDay ?? 0)),
  });
  await redis.hIncrBy(K.user(userId), 'played', 1);
  await redis.hIncrBy(K.user(userId), 'totalScore', score);

  const summary: Summary = {
    score,
    title: title.name,
    titleEmoji: title.emoji,
    grid: answers.map((a) => GRADE_EMOJI[gradeFor(a.points)]).join(''),
    rank: 0,
    players: 0,
    contrarianCount,
  };
  await redis.set(K.summary(day, userId), JSON.stringify(summary));
  return withRank(day, userId, summary);
}

export async function getSummary(day: number, userId: string): Promise<Summary | null> {
  const raw = await redis.get(K.summary(day, userId));
  return raw ? withRank(day, userId, JSON.parse(raw) as Summary) : null;
}

async function withRank(day: number, userId: string, s: Summary): Promise<Summary> {
  const players = await redis.zCard(K.dayBoard(day));
  const asc = await redis.zRank(K.dayBoard(day), userId);
  return { ...s, players, rank: asc === undefined ? 0 : players - asc };
}

export async function getUserStats(userId: string | undefined): Promise<UserStats> {
  if (!userId) return { streak: 0, bestStreak: 0, played: 0, totalScore: 0 };
  const u = await redis.hGetAll(K.user(userId));
  const currentDay = await getCurrentDay();
  const lastDay = Number(u.lastDay ?? 0);
  // A streak is "alive" if you played the current or the previous round.
  const alive = lastDay >= currentDay - 1;
  return {
    streak: alive ? Number(u.streak ?? 0) : 0,
    bestStreak: Number(u.bestStreak ?? 0),
    played: Number(u.played ?? 0),
    totalScore: Number(u.totalScore ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------
async function topOf(key: string, n: number): Promise<LeaderboardEntry[]> {
  const rows = await redis.zRange(key, 0, n - 1, { by: 'rank', reverse: true });
  if (rows.length === 0) return [];
  const names = await Promise.all(rows.map((r) => redis.hGet(K.names, r.member)));
  return rows.map((r, i) => ({ rank: i + 1, username: names[i] ?? 'someone', score: r.score }));
}

async function rankOf(key: string, userId: string | undefined): Promise<number | null> {
  if (!userId) return null;
  const asc = await redis.zRank(key, userId);
  if (asc === undefined) return null;
  return (await redis.zCard(key)) - asc;
}

export async function getLeaderboards(day: number, userId: string | undefined) {
  const [dayTop, allTop, dayRank, allTimeRank] = await Promise.all([
    topOf(K.dayBoard(day), 10),
    topOf(K.allTimeBoard, 10),
    rankOf(K.dayBoard(day), userId),
    rankOf(K.allTimeBoard, userId),
  ]);
  return { day: dayTop, allTime: allTop, me: { dayRank, allTimeRank } };
}

// ---------------------------------------------------------------------------
// Community suggestions
// ---------------------------------------------------------------------------
export async function suggestionsRemaining(userId: string, day: number): Promise<number> {
  const used = Number((await redis.get(K.suggDaily(userId, day))) ?? 0);
  return Math.max(0, SUGGESTIONS_PER_USER_PER_DAY - used);
}

export async function addSuggestion(
  userId: string,
  username: string,
  day: number,
  p: { q: string; a: string; b: string },
): Promise<{ ok: boolean; remaining: number }> {
  const used = await redis.incrBy(K.suggDaily(userId, day), 1);
  await redis.expire(K.suggDaily(userId, day), 60 * 60 * 48);
  if (used > SUGGESTIONS_PER_USER_PER_DAY) return { ok: false, remaining: 0 };

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await redis.hSet(K.sugg(id), { ...p, author: username, authorId: userId, createdAt: String(Date.now()) });
  // Author's own upvote counts, like a Reddit post.
  await redis.hSet(K.suggVoters(id), { [userId]: '1' });
  await redis.zAdd(K.suggPending, { member: id, score: 1 });
  return { ok: true, remaining: SUGGESTIONS_PER_USER_PER_DAY - used };
}

/** A handful of pending suggestions the user hasn't voted on yet. */
export async function getSuggestionsFor(userId: string | undefined, limit = 3): Promise<Suggestion[]> {
  const rows = await redis.zRange(K.suggPending, 0, 49, { by: 'rank', reverse: true });
  const out: Suggestion[] = [];
  for (const { member: id, score } of rows) {
    if (out.length >= limit) break;
    if (userId && (await redis.hGet(K.suggVoters(id), userId))) continue;
    const s = await redis.hGetAll(K.sugg(id));
    if (!s.q || !s.a || !s.b) continue;
    out.push({ id, q: s.q, a: s.a, b: s.b, author: s.author ?? 'someone', votes: score });
  }
  return out;
}

export async function voteSuggestion(userId: string, id: string): Promise<boolean> {
  if ((await redis.zScore(K.suggPending, id)) === undefined) return false;
  const first = await redis.hSetNX(K.suggVoters(id), userId, '1');
  if (!first) return false;
  await redis.zIncrBy(K.suggPending, id, 1);
  return true;
}

/** Mod tool: wipe the pending suggestion queue. */
export async function clearSuggestions(): Promise<number> {
  const n = await redis.zCard(K.suggPending);
  await redis.del(K.suggPending);
  return n;
}
