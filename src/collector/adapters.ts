import { espnSoccer } from "./sources/espnSoccer";
import { footballData } from "./sources/footballData";
import type { SourceAdapter } from "./types";

// competition_source_ref.source 값 → 수집기
export function defaultAdapters(env: NodeJS.ProcessEnv = process.env): Record<string, SourceAdapter> {
  const list = [footballData(env.FOOTBALL_DATA_API_KEY), espnSoccer()];
  return Object.fromEntries(list.map((a) => [a.source, a]));
}
