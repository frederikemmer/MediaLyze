import type { SettingsPanelId } from "./settings-panel-state";

export type SettingsSearchTarget = {
  id: string;
  panel: SettingsPanelId;
  label: string;
  context: string;
  aliases?: string[];
  focus?: string;
};

export type SettingsSearchMatch = {
  target: SettingsSearchTarget;
  score: number;
  matchedValue: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + substitutionCost,
      ));
    }
    previous = current;
  }
  return previous[right.length];
}

function fuzzyTokenScore(queryToken: string, valueToken: string): number | null {
  if (!queryToken || !valueToken) return null;
  if (queryToken === valueToken) return 760;
  if (valueToken.startsWith(queryToken)) return 700 - Math.min(30, valueToken.length - queryToken.length);
  if (valueToken.includes(queryToken)) return 640 - Math.min(30, valueToken.length - queryToken.length);

  if (queryToken.length < 3) return null;
  const distance = editDistance(queryToken, valueToken);
  const maxDistance = Math.max(1, Math.floor(queryToken.length / 5));
  if (distance > maxDistance) return null;
  return 570 - distance * 70 - Math.min(24, Math.abs(queryToken.length - valueToken.length) * 6);
}

function scoreValue(query: string, value: string): number | null {
  const normalizedQuery = normalize(query);
  const normalizedValue = normalize(value);
  if (!normalizedQuery || !normalizedValue) return null;
  if (normalizedQuery === normalizedValue) return 1000;
  if (normalizedValue.startsWith(normalizedQuery)) return 920 - Math.min(80, normalizedValue.length - normalizedQuery.length);
  if (normalizedValue.includes(normalizedQuery)) return 820 - Math.min(80, normalizedValue.length - normalizedQuery.length);

  const queryTokens = normalizedQuery.split(" ");
  const valueTokens = normalizedValue.split(" ");
  const tokenScores = queryTokens.map((queryToken) => {
    const scores = valueTokens
      .map((valueToken) => fuzzyTokenScore(queryToken, valueToken))
      .filter((score): score is number => score !== null);
    return scores.length ? Math.max(...scores) : null;
  });
  const matchedTokenScores = tokenScores.filter((score): score is number => score !== null);
  if (matchedTokenScores.length !== queryTokens.length) return null;
  return 560 + matchedTokenScores.reduce((sum, score) => sum + score, 0) / queryTokens.length * 0.25;
}

export function normalizeSettingsSearchQuery(value: string): string {
  return normalize(value);
}

export function rankSettingsSearchTargets(
  targets: SettingsSearchTarget[],
  query: string,
  activePanel?: SettingsPanelId,
): SettingsSearchMatch[] {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];

  return targets
    .map((target) => {
      const values = [target.label, ...(target.aliases ?? [])];
      const best = values.reduce<SettingsSearchMatch | null>((currentBest, value) => {
        const valueScore = scoreValue(normalizedQuery, value);
        if (valueScore === null || (currentBest && currentBest.score >= valueScore)) return currentBest;
        return { target, score: valueScore, matchedValue: value };
      }, null);
      if (!best) return null;
      return {
        ...best,
        score: best.score + (target.panel === activePanel ? 45 : 0),
      };
    })
    .filter((match): match is SettingsSearchMatch => match !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.target.label.length !== right.target.label.length) {
        return left.target.label.length - right.target.label.length;
      }
      return left.target.label.localeCompare(right.target.label);
    });
}

export function isConfidentSettingsSearchMatch(match: SettingsSearchMatch | undefined): boolean {
  return Boolean(match && match.score >= 600);
}
