import { espn } from "./sources/espn";
import { jolpica, openF1 } from "./sources/f1";
import { footballData } from "./sources/footballData";
import { kbo } from "./sources/kbo";
import { lolesports } from "./sources/lolesports";
import { mlb } from "./sources/mlb";
import { nhl } from "./sources/nhl";
import type { SourceAdapter } from "./types";

// competition_source_ref.source 값 → 수집기
export function defaultAdapters(env: NodeJS.ProcessEnv = process.env): Record<string, SourceAdapter> {
  const list = [
    footballData(env.FOOTBALL_DATA_API_KEY),
    espn(),
    jolpica(),
    openF1(),
    mlb(),
    nhl(),
    lolesports(fetch, { apiKey: env.LOLESPORTS_API_KEY }),
    kbo(),
  ];
  return Object.fromEntries(list.map((a) => [a.source, a]));
}
