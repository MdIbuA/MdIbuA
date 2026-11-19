import { describe, expect, it } from 'vitest';
import { displayPctA, gradeFor, nextStreak, pointsFor, scoringPctA, titleFor } from '../src/shared/scoring';
import { validateSuggestion } from '../src/server/moderation';
import { CURATED_PROMPTS } from '../src/server/prompts';

describe('scoring', () => {
  it('perfect guess = 100, each point off costs 2', () => {
    expect(pointsFor(62, 62)).toBe(100);
    expect(pointsFor(52, 62)).toBe(80);
    expect(pointsFor(0, 100)).toBe(0);
    expect(pointsFor(150, 50)).toBe(0); // clamps bad input
  });
  it('smooths tiny rooms toward 50%', () => {
    expect(scoringPctA({ a: 1, b: 0 })).toBe(60); // (1+2)/(1+4)
    expect(scoringPctA({ a: 0, b: 0 })).toBe(50);
    expect(scoringPctA({ a: 900, b: 100 })).toBeCloseTo(89.8, 1);
  });
  it('display pct uses raw votes', () => {
    expect(displayPctA({ a: 1, b: 0 })).toBe(100);
    expect(displayPctA({ a: 0, b: 0 })).toBe(50);
  });
  it('grades and titles', () => {
    expect(gradeFor(100)).toBe('bullseye');
    expect(gradeFor(80)).toBe('close');
    expect(gradeFor(50)).toBe('off');
    expect(gradeFor(10)).toBe('miss');
    expect(titleFor(500).name).toBe('Mind Reader');
    expect(titleFor(0).name).toBe('Certified Contrarian');
  });
  it('streaks', () => {
    expect(nextStreak(3, 4, 5)).toBe(4);
    expect(nextStreak(3, 5, 5)).toBe(3);
    expect(nextStreak(3, 2, 5)).toBe(1);
    expect(nextStreak(0, undefined, 1)).toBe(1);
  });
});

describe('moderation', () => {
  const ok = (q: string, a = 'Yes', b = 'No') => validateSuggestion({ q, a, b }).ok;
  it('accepts normal prompts, including words containing blocked substrings', () => {
    expect(ok('Is cereal a soup?')).toBe(true);
    expect(ok('Best cocktail for a party?', 'Mojito', 'Margarita')).toBe(true);
    expect(ok('Should Dickens be required reading?')).toBe(true);
  });
  it('rejects junk', () => {
    expect(ok('Hi')).toBe(false);
    expect(ok('Same options?', 'Yes', 'yes')).toBe(false);
    expect(ok('Visit https://spam.example now')).toBe(false);
    expect(ok('Is porn art?')).toBe(false);
    expect(ok('Is trump right?')).toBe(false);
  });
});

describe('curated bank', () => {
  it('has enough unique, length-safe prompts', () => {
    expect(CURATED_PROMPTS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(CURATED_PROMPTS.map((p) => p.q)).size).toBe(CURATED_PROMPTS.length);
    for (const p of CURATED_PROMPTS) {
      expect(p.a.length, p.a).toBeLessThanOrEqual(24);
      expect(p.b.length, p.b).toBeLessThanOrEqual(24);
    }
  });
});
