import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '@devvit/web/client';
import type {
  AnswerResponse,
  LeaderboardResponse,
  OkResponse,
  Pick,
  Prompt,
  Reveal,
  StateResponse,
  SuggestionsResponse,
} from '../shared/api';
import { GRADE_EMOJI, MAX_POINTS_PER_DAY, PROMPTS_PER_DAY, gradeFor, type Grade } from '../shared/scoring';
import { ApiError, api } from './api';

type View =
  | { kind: 'intro' }
  | { kind: 'pick'; index: number }
  | { kind: 'predict'; index: number; pick: Pick }
  | { kind: 'reveal'; index: number; reveal: Reveal; completed: boolean }
  | { kind: 'summary' };

type Sheet = null | 'leaderboard' | 'suggest' | 'howto';

const QUIPS: Record<Grade, string[]> = {
  bullseye: ['Bullseye. You ARE the room.', 'Scary accurate. Are you a mod?', 'Telepathy confirmed.'],
  close: ['Close! You get this crowd.', 'Solid read.', 'Nearly nailed it.'],
  off: ['Hmm, the room had other ideas.', 'Not quite the vibe.', 'Half right, half chaos.'],
  miss: ['Wildly off. Are you even subscribed?', 'The room said: who are you?', 'Bold read. Wrong, but bold.'],
};

const firstUnanswered = (answers: (Reveal | null)[]) => answers.findIndex((a) => a === null);
const pickRandom = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!;

export function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'intro' });
  const [sheet, setSheet] = useState<Sheet>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const s = await api.get<StateResponse>('/api/state');
      setState(s);
      const next = firstUnanswered(s.answers);
      if (s.summary) setView({ kind: 'summary' });
      else if (next > 0) setView({ kind: 'pick', index: next }); // resume mid-round
      else setView({ kind: 'intro' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the round.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Shell>
        <div className="center stack">
          <div className="big-emoji">😵</div>
          <p>{error}</p>
          <button className="btn primary" onClick={() => void load()}>Try again</button>
        </div>
      </Shell>
    );
  }
  if (!state) {
    return (
      <Shell>
        <div className="center">
          <div className="spinner" aria-label="Loading" />
        </div>
      </Shell>
    );
  }

  const onAnswered = (res: AnswerResponse, index: number) => {
    setState((s) => {
      if (!s) return s;
      const answers = [...s.answers];
      answers[index] = res.reveal;
      return { ...s, answers, summary: res.summary ?? s.summary, stats: res.stats };
    });
    setView({ kind: 'reveal', index, reveal: res.reveal, completed: Boolean(res.summary) });
  };

  return (
    <Shell
      header={
        <Header
          day={state.day}
          streak={state.stats.streak}
          answers={state.answers}
          current={'index' in view ? view.index : -1}
          onLeaderboard={() => setSheet('leaderboard')}
          onHelp={() => setSheet('howto')}
        />
      }
    >
      {view.kind === 'intro' && (
        <Intro state={state} onStart={() => setView({ kind: 'pick', index: 0 })} onHowTo={() => setSheet('howto')} />
      )}
      {view.kind === 'pick' && (
        <PickStep
          key={`pick-${view.index}`}
          prompt={state.prompts[view.index]!}
          index={view.index}
          onPick={(pick) => setView({ kind: 'predict', index: view.index, pick })}
        />
      )}
      {view.kind === 'predict' && (
        <PredictStep
          key={`predict-${view.index}`}
          prompt={state.prompts[view.index]!}
          index={view.index}
          pick={view.pick}
          onBack={() => setView({ kind: 'pick', index: view.index })}
          onAnswered={(res) => onAnswered(res, view.index)}
        />
      )}
      {view.kind === 'reveal' && (
        <RevealStep
          key={`reveal-${view.index}`}
          prompt={state.prompts[view.index]!}
          reveal={view.reveal}
          isLast={view.index === PROMPTS_PER_DAY - 1}
          onNext={() =>
            view.completed || view.index === PROMPTS_PER_DAY - 1
              ? setView({ kind: 'summary' })
              : setView({ kind: 'pick', index: view.index + 1 })
          }
        />
      )}
      {view.kind === 'summary' && state.summary && (
        <SummaryView
          state={state}
          onLeaderboard={() => setSheet('leaderboard')}
          onSuggest={() => setSheet('suggest')}
        />
      )}

      {sheet === 'leaderboard' && <LeaderboardSheet onClose={() => setSheet(null)} />}
      {sheet === 'suggest' && <SuggestSheet onClose={() => setSheet(null)} />}
      {sheet === 'howto' && <HowToSheet onClose={() => setSheet(null)} />}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function Shell({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="app">
      {header}
      <main className="main">{children}</main>
    </div>
  );
}

function Header(props: {
  day: number;
  streak: number;
  answers: (Reveal | null)[];
  current: number;
  onLeaderboard: () => void;
  onHelp: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <span className="logo" aria-hidden>👀</span>
        <span className="brand-text">
          <span className="brand-name">Read the Room </span><span className="muted">#{props.day}</span>
        </span>
      </div>
      <div className="dots" aria-label="Progress">
        {props.answers.map((a, i) => (
          <span
            key={i}
            className={`dot ${a ? `done ${gradeFor(a.points)}` : ''} ${i === props.current ? 'current' : ''}`}
          />
        ))}
      </div>
      <div className="header-actions">
        {props.streak > 0 && <span className="chip" title="Daily streak">🔥 {props.streak}</span>}
        <button className="icon-btn" onClick={props.onLeaderboard} aria-label="Leaderboard">🏆</button>
        <button className="icon-btn" onClick={props.onHelp} aria-label="How to play">?</button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function Intro({ state, onStart, onHowTo }: { state: StateResponse; onStart: () => void; onHowTo: () => void }) {
  return (
    <div className="stack center intro fade-in">
      {state.snoovatar && <img className="snoo" src={state.snoovatar} alt="" />}
      <h1 className="title">Don’t say what’s right.<br />Guess what the room thinks.</h1>
      <p className="muted">
        {PROMPTS_PER_DAY} quick debates. Pick your side, then predict how the subreddit split.
        Closer guess, more points.
      </p>
      <div className="row chips">
        <span className="chip">👥 {state.playersToday} played</span>
        {state.stats.streak > 0 && <span className="chip">🔥 {state.stats.streak}-day streak</span>}
        {!state.isToday && <span className="chip warn">📼 Past round · no streak</span>}
      </div>
      <button className="btn primary big" onClick={onStart}>
        {state.username ? 'Enter the room' : 'Log in & play'}
      </button>
      <button className="link" onClick={onHowTo}>How scoring works</button>
    </div>
  );
}

function PromptCard({ prompt, index }: { prompt: Prompt; index: number }) {
  return (
    <div className="prompt-card">
      <div className="prompt-meta">
        <span>{index >= 0 ? `Prompt ${index + 1}/${PROMPTS_PER_DAY}` : 'The room has spoken'}</span>
        {prompt.author && <span className="community">✨ from u/{prompt.author}</span>}
      </div>
      <h2 className="prompt-q">{prompt.q}</h2>
    </div>
  );
}

function PickStep({ prompt, index, onPick }: { prompt: Prompt; index: number; onPick: (p: Pick) => void }) {
  return (
    <div className="stack fade-in">
      <PromptCard prompt={prompt} index={index} />
      <p className="step-label">Step 1 · Your honest take</p>
      <div className="options">
        <button className="option a" onClick={() => onPick('a')}>{prompt.a}</button>
        <button className="option b" onClick={() => onPick('b')}>{prompt.b}</button>
      </div>
    </div>
  );
}

function PredictStep(props: {
  prompt: Prompt;
  index: number;
  pick: Pick;
  onBack: () => void;
  onAnswered: (r: AnswerResponse) => void;
}) {
  const { prompt, index, pick } = props;
  const [guess, setGuess] = useState(50);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      props.onAnswered(await api.post<AnswerResponse>('/api/answer', { index, pick, guess }));
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'LOGIN_REQUIRED')) showToast(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <div className="stack fade-in">
      <PromptCard prompt={prompt} index={index} />
      <p className="step-label">
        Step 2 · You picked <strong className={pick}>{pick === 'a' ? prompt.a : prompt.b}</strong>.
        How did the <em>room</em> split?
      </p>
      <SplitBar a={prompt.a} b={prompt.b} pctA={guess} />
      <input
        className="slider"
        type="range"
        min={0}
        max={100}
        value={guess}
        onChange={(e) => setGuess(Number(e.target.value))}
        aria-label={`Percent of the room choosing ${prompt.a}`}
      />
      <div className="row">
        <button className="btn ghost" onClick={props.onBack} disabled={busy}>← Change pick</button>
        <button className="btn primary grow" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Reading the room…' : 'Lock it in'}
        </button>
      </div>
    </div>
  );
}

function SplitBar({ a, b, pctA, marker }: { a: string; b: string; pctA: number; marker?: number }) {
  return (
    <div className="split">
      <div className="split-labels">
        <span className="a">{a} <strong>{Math.round(pctA)}%</strong></span>
        <span className="b"><strong>{100 - Math.round(pctA)}%</strong> {b}</span>
      </div>
      <div className="split-bar">
        <div className="split-a" style={{ width: `${pctA}%` }} />
        {marker !== undefined && (
          <div className="marker" style={{ left: `${marker}%` }}>
            <span>you</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RevealStep({ prompt, reveal, isLast, onNext }: { prompt: Prompt; reveal: Reveal; isLast: boolean; onNext: () => void }) {
  const [shownPct, setShownPct] = useState(reveal.guess);
  const points = useCountUp(reveal.points, 700);
  const grade = gradeFor(reveal.points);
  const quip = useMemo(() => pickRandom(QUIPS[grade]), [grade]);
  const myShare = reveal.pick === 'a' ? reveal.actualPctA : 100 - reveal.actualPctA;

  useEffect(() => {
    const t = setTimeout(() => setShownPct(reveal.actualPctA), 150);
    return () => clearTimeout(t);
  }, [reveal.actualPctA]);

  return (
    <div className="stack fade-in">
      <PromptCard prompt={prompt} index={-1} />
      <SplitBar a={prompt.a} b={prompt.b} pctA={shownPct} marker={reveal.guess} />
      <div className={`result ${grade}`}>
        <div className="result-points">
          {GRADE_EMOJI[grade]} +{points}
        </div>
        <div className="result-quip">{quip}</div>
        <div className="muted small">
          You guessed {reveal.guess}% · room says {reveal.actualPctA}% · {reveal.total} vote{reveal.total === 1 ? '' : 's'}
          {reveal.total < 10 && ' · early bird, the room is still filling up'}
        </div>
        {myShare < 50 && <div className="small">🙃 You’re in the minority on this one.</div>}
      </div>
      <button className="btn primary big" onClick={onNext}>{isLast ? 'See my results' : 'Next prompt →'}</button>
    </div>
  );
}

function SummaryView({ state, onLeaderboard, onSuggest }: { state: StateResponse; onLeaderboard: () => void; onSuggest: () => void }) {
  const s = state.summary!;
  const score = useCountUp(s.score, 900);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (path: string) => {
    setBusy(path);
    try {
      const res = await api.post<OkResponse>(path);
      showToast({ text: res.message ?? 'Done!', appearance: 'success' });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'LOGIN_REQUIRED')) showToast(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack center fade-in summary">
      <div className="big-emoji">{s.titleEmoji}</div>
      <div className="score">
        {score}<span className="muted">/{MAX_POINTS_PER_DAY}</span>
      </div>
      <div className="title-badge">{s.title}</div>
      <div className="grid-emoji">{s.grid}</div>
      <div className="row chips">
        <span className="chip">🏅 #{s.rank} of {s.players}</span>
        <span className="chip">🔥 {state.stats.streak} streak</span>
        {s.contrarianCount >= 3 && <span className="chip">🙃 Contrarian ×{s.contrarianCount}</span>}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={busy !== null} onClick={() => void act('/api/share')}>💬 Share to comments</button>
        <button className="btn" disabled={busy !== null} onClick={() => void act('/api/flair')}>🏷️ Wear my title</button>
        <button className="btn" onClick={onLeaderboard}>🏆 Leaderboard</button>
        <button className="btn" onClick={onSuggest}>✨ Shape tomorrow</button>
      </div>
      <Countdown />
    </div>
  );
}

function Countdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Matches the cron in devvit.json: 12:00 UTC daily.
  const next = new Date(now);
  next.setUTCHours(12, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  const ms = next.getTime() - now;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return (
    <p className="muted small">
      Next room opens in {h}h {String(m).padStart(2, '0')}m {String(sec).padStart(2, '0')}s
    </p>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function LeaderboardSheet({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'day' | 'allTime'>('day');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  useEffect(() => {
    api.get<LeaderboardResponse>('/api/leaderboard').then(setData, () => showToast('Could not load leaderboard'));
  }, []);
  const rows = data?.[tab] ?? [];
  const myRank = tab === 'day' ? data?.me.dayRank : data?.me.allTimeRank;
  return (
    <SheetFrame title="Leaderboard" onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'day' ? 'active' : ''} onClick={() => setTab('day')}>This round</button>
        <button className={tab === 'allTime' ? 'active' : ''} onClick={() => setTab('allTime')}>All time</button>
      </div>
      {!data ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <p className="muted center">Nobody yet. Be the first to read the room!</p>
      ) : (
        <ol className="board">
          {rows.map((r) => (
            <li key={r.rank}>
              <span className="rank">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`}</span>
              <span className="name">u/{r.username}</span>
              <span className="pts">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
      {myRank && <p className="muted small center">You’re #{myRank}</p>}
    </SheetFrame>
  );
}

function SuggestSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.get<SuggestionsResponse>('/api/suggestions').then(setData, () => setData({ items: [], remainingToday: 0 }));
  }, []);
  useEffect(refresh, [refresh]);

  const vote = async (id: string) => {
    setData((d) => d && { ...d, items: d.items.filter((s) => s.id !== id) });
    try {
      await api.post('/api/suggestions/vote', { id });
    } catch {
      /* optimistic; ignore */
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<OkResponse>('/api/suggest', { q, a, b });
      showToast({ text: res.message ?? 'Submitted!', appearance: 'success' });
      setQ(''); setA(''); setB('');
      refresh();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'LOGIN_REQUIRED')) showToast(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetFrame title="Shape tomorrow’s room" onClose={onClose}>
      <p className="muted small">Upvote prompts you want to see. The top picks get featured in upcoming rounds, with credit.</p>
      {data?.items.length ? (
        <ul className="sugg-list">
          {data.items.map((s) => (
            <li key={s.id}>
              <div>
                <div className="sugg-q">{s.q}</div>
                <div className="muted small">{s.a} vs {s.b} · u/{s.author}</div>
              </div>
              <button className="btn small" onClick={() => void vote(s.id)}>⬆ {s.votes}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No pending prompts to vote on. Add one!</p>
      )}

      <div className="form">
        <label>
          Question <span className="muted">{q.length}/70</span>
          <input value={q} maxLength={70} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Is cereal a soup?" />
        </label>
        <div className="row">
          <label className="grow">
            Option A
            <input value={a} maxLength={24} onChange={(e) => setA(e.target.value)} placeholder="🥣 Yes" />
          </label>
          <label className="grow">
            Option B
            <input value={b} maxLength={24} onChange={(e) => setB(e.target.value)} placeholder="🙅 No" />
          </label>
        </div>
        <button className="btn primary" disabled={busy || !q || !a || !b || data?.remainingToday === 0} onClick={() => void submit()}>
          {data?.remainingToday === 0 ? 'Daily limit reached' : `Submit prompt${data ? ` (${data.remainingToday} left today)` : ''}`}
        </button>
      </div>
    </SheetFrame>
  );
}

function HowToSheet({ onClose }: { onClose: () => void }) {
  return (
    <SheetFrame title="How to play" onClose={onClose}>
      <ol className="howto">
        <li><strong>Pick your side.</strong> Be honest, your vote becomes part of the room.</li>
        <li><strong>Predict the split.</strong> Slide to the % of the subreddit you think picked the left option.</li>
        <li><strong>Get scored.</strong> 100 points for a perfect read, −2 for every point you’re off.</li>
      </ol>
      <p className="small">
        🎯 94+ · 🟩 75+ · 🟨 45+ · 🟥 below. Score 450+/500 to earn <strong>🔮 Mind Reader</strong>.
        A new room opens every day; play daily to keep your 🔥 streak.
      </p>
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, durationMs]);
  return value;
}
