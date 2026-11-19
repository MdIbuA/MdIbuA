import type { IncomingMessage, ServerResponse } from 'node:http';
import { context, createServer, getServerPort, reddit } from '@devvit/web/server';
import type {
  AnswerRequest,
  AnswerResponse,
  ErrorResponse,
  LeaderboardResponse,
  OkResponse,
  StateResponse,
  SuggestRequest,
  SuggestionsResponse,
} from '../shared/api';
import { MAX_POINTS_PER_DAY, PROMPTS_PER_DAY } from '../shared/scoring';
import { validateSuggestion } from './moderation';
import {
  addSuggestion,
  buildNextRound,
  clearSuggestions,
  finalizeRound,
  getAnswers,
  getCurrentDay,
  getDayForPost,
  getLeaderboards,
  getRound,
  getSuggestionsFor,
  getSummary,
  getTodayPlayers,
  getUserStats,
  saveRound,
  submitAnswer,
  suggestionsRemaining,
  voteSuggestion,
  withLock,
} from './store';

// ---------------------------------------------------------------------------
// Tiny router (no framework needed for a dozen JSON routes)
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ErrorResponse['code'],
  ) {
    super(message);
  }
}

type Handler = (body: unknown, url: URL) => Promise<unknown>;
const routes = new Map<string, Handler>();
const route = (method: 'GET' | 'POST', path: string, h: Handler) => routes.set(`${method} ${path}`, h);

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method !== 'POST') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, 'Request too large', 'BAD_REQUEST');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON', 'BAD_REQUEST');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const handler = routes.get(`${req.method} ${url.pathname}`);
  if (!handler) return send(res, 404, { error: 'Not found', code: 'NOT_FOUND' } satisfies ErrorResponse);
  try {
    const body = await readJson(req);
    send(res, 200, await handler(body, url));
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code } satisfies ErrorResponse);
    console.error(`[${url.pathname}]`, err);
    send(res, 500, { error: 'Something went wrong. Try again in a moment.' } satisfies ErrorResponse);
  }
});
server.listen(getServerPort());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function requireUser(): { userId: string; username: string } {
  const { userId, username } = context;
  if (!userId || !username) throw new HttpError(401, 'Log in to play', 'LOGIN_REQUIRED');
  return { userId, username };
}

async function dayForThisPost(): Promise<number> {
  const fromData = context.postData?.day;
  if (typeof fromData === 'number') return fromData;
  if (context.postId) {
    const d = await getDayForPost(context.postId);
    if (d) return d;
  }
  throw new HttpError(404, 'This post is not a Read the Room round.', 'NOT_FOUND');
}

async function createRound(reason: 'cron' | 'menu' | 'install'): Promise<{ day: number; url: string } | null> {
  return withLock('new-round', async () => {
    const current = await getCurrentDay();
    // Avoid back-to-back rounds if a mod posted one manually shortly before the cron fires.
    if (reason === 'cron' && current > 0) {
      const last = await getRound(current);
      if (last && Date.now() - last.createdAt < 6 * 60 * 60 * 1000) return null;
    }
    const day = current + 1;
    const round = await buildNextRound(day);
    const sub = context.subredditName;
    const post = await reddit.submitCustomPost({
      subredditName: sub,
      title: `Read the Room #${day}: can you guess what r/${sub} thinks?`,
      postData: { day },
      textFallback: {
        text:
          `Read the Room #${day}\n\n` +
          round.prompts.map((p, i) => `${i + 1}. ${p.q} (${p.a} vs ${p.b})`).join('\n') +
          `\n\nOpen this post in the Reddit app or new Reddit to play.`,
      },
    });
    await saveRound(round, post.id);
    console.log(`[round] #${day} created via ${reason}: ${post.id}`);
    return { day, url: post.url };
  });
}

// ---------------------------------------------------------------------------
// Game API (called by the web view)
// ---------------------------------------------------------------------------
route('GET', '/api/state', async (): Promise<StateResponse> => {
  const day = await dayForThisPost();
  const round = await getRound(day);
  if (!round) throw new HttpError(404, 'Round not found', 'NOT_FOUND');
  const { userId, username, snoovatar } = context;
  const [answers, summary, stats, playersToday, currentDay] = await Promise.all([
    userId ? getAnswers(day, userId) : Promise.resolve(Array(PROMPTS_PER_DAY).fill(null)),
    userId ? getSummary(day, userId) : Promise.resolve(null),
    getUserStats(userId),
    getTodayPlayers(day),
    getCurrentDay(),
  ]);
  return {
    day,
    isToday: day === currentDay,
    username: username ?? null,
    snoovatar: snoovatar ?? null,
    prompts: round.prompts,
    answers,
    summary,
    stats,
    playersToday,
  };
});

route('POST', '/api/answer', async (body): Promise<AnswerResponse> => {
  const { userId, username } = requireUser();
  const { index, pick, guess } = (body ?? {}) as Partial<AnswerRequest>;
  if (
    !Number.isInteger(index) || index! < 0 || index! >= PROMPTS_PER_DAY ||
    (pick !== 'a' && pick !== 'b') ||
    typeof guess !== 'number' || !Number.isFinite(guess) || guess < 0 || guess > 100
  ) {
    throw new HttpError(400, 'Invalid answer', 'BAD_REQUEST');
  }
  const day = await dayForThisPost();
  if (!(await getRound(day))) throw new HttpError(404, 'Round not found', 'NOT_FOUND');

  const result = await submitAnswer(day, userId, index!, pick, guess);
  if (!result.ok) throw new HttpError(400, result.error, result.code);

  let summary = null;
  if (result.completed) {
    const answers = (await getAnswers(day, userId)).filter((a) => a !== null);
    summary = await finalizeRound(day, userId, username, answers);
  }
  return { reveal: result.reveal, summary, stats: await getUserStats(userId) };
});

route('GET', '/api/leaderboard', async (): Promise<LeaderboardResponse> => {
  const day = await dayForThisPost();
  return getLeaderboards(day, context.userId);
});

route('POST', '/api/share', async (): Promise<OkResponse> => {
  const { userId, username } = requireUser();
  const day = await dayForThisPost();
  const summary = await getSummary(day, userId);
  if (!summary || !context.postId) throw new HttpError(400, 'Finish the round first.', 'BAD_REQUEST');
  const text =
    `Read the Room #${day}: **${summary.score}/${MAX_POINTS_PER_DAY}** ${summary.titleEmoji} ${summary.title}\n\n` +
    `${summary.grid}\n\n` +
    `Rank #${summary.rank} of ${summary.players}` +
    (summary.contrarianCount >= 3 ? ` · 🙃 went against the room ${summary.contrarianCount}×` : '');
  try {
    await reddit.submitComment({ id: context.postId, text, runAs: 'USER' });
  } catch (err) {
    // Fall back to the app account if user-run comments aren't available.
    console.warn('[share] USER comment failed, falling back to APP', err);
    await reddit.submitComment({ id: context.postId, text: `u/${username} — ${text}`, runAs: 'APP' });
  }
  return { ok: true, message: 'Result posted to the comments!' };
});

route('POST', '/api/flair', async (): Promise<OkResponse> => {
  const { userId, username } = requireUser();
  const day = await dayForThisPost();
  const summary = await getSummary(day, userId);
  if (!summary) throw new HttpError(400, 'Finish the round first.', 'BAD_REQUEST');
  const stats = await getUserStats(userId);
  const text = `${summary.titleEmoji} ${summary.title}${stats.streak > 1 ? ` · 🔥${stats.streak}` : ''}`;
  await reddit.setUserFlair({ subredditName: context.subredditName, username, text });
  return { ok: true, message: `Flair set: ${text}` };
});

route('GET', '/api/suggestions', async (): Promise<SuggestionsResponse> => {
  const day = await dayForThisPost();
  const { userId } = context;
  return {
    items: await getSuggestionsFor(userId),
    remainingToday: userId ? await suggestionsRemaining(userId, day) : 0,
  };
});

route('POST', '/api/suggest', async (body): Promise<OkResponse> => {
  const { userId, username } = requireUser();
  const day = await dayForThisPost();
  const v = validateSuggestion((body ?? {}) as Partial<SuggestRequest>);
  if (!v.ok) throw new HttpError(400, v.error, 'BAD_REQUEST');
  const res = await addSuggestion(userId, username, day, v.value);
  if (!res.ok) throw new HttpError(429, 'You’ve hit today’s suggestion limit — come back tomorrow!', 'RATE_LIMITED');
  return { ok: true, message: 'Submitted! Upvoted prompts make it into future rounds.' };
});

route('POST', '/api/suggestions/vote', async (body): Promise<OkResponse> => {
  const { userId } = requireUser();
  const id = (body as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string' || id.length > 40) throw new HttpError(400, 'Invalid suggestion', 'BAD_REQUEST');
  const counted = await voteSuggestion(userId, id);
  return { ok: true, message: counted ? 'Upvoted!' : 'Already voted.' };
});

// ---------------------------------------------------------------------------
// Internal endpoints (cron, menu, triggers)
// ---------------------------------------------------------------------------
route('POST', '/internal/scheduler/daily-round', async () => {
  await createRound('cron');
  return {};
});

route('POST', '/internal/triggers/install', async () => {
  await createRound('install');
  return {};
});

route('POST', '/internal/menu/new-round', async () => {
  const created = await createRound('menu');
  if (!created) return { showToast: 'A round is already being created — try again in a minute.' };
  return { showToast: { text: `Round #${created.day} posted!`, appearance: 'success' }, navigateTo: created.url };
});

route('POST', '/internal/menu/clear-suggestions', async () => {
  const n = await clearSuggestions();
  return { showToast: `Cleared ${n} pending suggestion${n === 1 ? '' : 's'}.` };
});
