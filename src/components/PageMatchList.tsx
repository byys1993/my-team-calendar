import { fmt, type Messages } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { formatLabel, formatTitle } from "@/i18n/format";
import { f1Driver } from "@/lib/f1names";
import type { ScheduleMatch } from "@/lib/schedule";
import { extraLabel, resultFor } from "./result";
import { dateLabel, isDawn, matchDateKey, matchTimeLabel } from "./time";

// 팀·리그 페이지의 경기 목록 (서버에서 그린다). 시각은 한국 시간 기준.
export const PAGE_TZ = "Asia/Seoul";

export function PageMatchList({
  matches,
  team,
  m,
  locale,
  intl,
  compName,
  showResult,
}: {
  matches: ScheduleMatch[];
  team: string | null; // 이 팀 기준으로 '내 팀 vs 상대 (홈/원정)'·승패 표시. 리그 페이지는 null
  m: Messages;
  locale: Locale;
  intl: string;
  compName: (slug: string) => string;
  showResult?: boolean;
}) {
  const label = (s: string) => formatLabel(s, m) ?? s;
  return (
    <ul className="page-matches">
      {matches.map((x) => {
        const isEvent = !!x.title && !x.away;
        const mine = team && (x.home === team || x.away === team) ? team : null;
        const isHome = mine ? x.home === mine : true;
        const [a, b] = isHome ? [x.homeLabel, x.awayLabel] : [x.awayLabel, x.homeLabel];
        const side = !mine || x.sport === "esports" ? null : x.isNeutral ? m.match.neutral : isHome ? m.match.home : m.match.away;
        const r = showResult && mine ? resultFor(x, mine) : null;
        const plainScore =
          showResult && !mine && x.homeScore != null && x.awayScore != null
            ? `${x.homeScore}:${x.awayScore}` +
              (x.homePen != null && x.awayPen != null
                ? ` (${fmt(m.results.pens, { a: x.homePen, b: x.awayPen })})`
                : extraLabel(x.extra, m.results)
                  ? ` (${extraLabel(x.extra, m.results)})`
                  : "")
            : null;
        const status = x.status !== "scheduled" && x.status !== "time_tbd" ? m.status[x.status] : null;
        const round = formatLabel(x.roundLabel, m);
        return (
          <li key={x.id}>
            <span className="pm-when">
              {dateLabel(matchDateKey(x, PAGE_TZ), intl)}{" "}
              <b>
                {isDawn(x, PAGE_TZ) && "🌙"}
                {matchTimeLabel(x, intl, m.match.timeTbd, PAGE_TZ)}
              </b>
            </span>
            <span className="pm-what">
              {isEvent ? formatTitle(x.title, m, locale) : `${label(a)} ${m.match.vs} ${label(b)}`}
              {side && <span className="muted"> ({side})</span>}
              {status && <span className="status"> {status}</span>}
              {r && (
                <span className={`result result-${r.outcome}`}>
                  {m.results[r.outcome]} {r.mine}:{r.theirs}
                  {r.pen && <small className="result-pen">{fmt(m.results.pens, { a: r.pen.mine, b: r.pen.theirs })}</small>}
                  {!r.pen && extraLabel(x.extra, m.results) && <small className="result-pen">{extraLabel(x.extra, m.results)}</small>}
                </span>
              )}
              {plainScore && <span className="result result-draw">{plainScore}</span>}
              {showResult && isEvent && x.podium?.length ? (
                <span className="podium">
                  {x.title?.endsWith(":qualifying")
                    ? `${m.results.pole} ${f1Driver(x.podium[0].driverId, x.podium[0].name, locale)}`
                    : x.podium.map((p) => `${["🥇", "🥈", "🥉"][p.pos - 1] ?? ""} ${f1Driver(p.driverId, p.name, locale)}`).join("  ")}
                </span>
              ) : null}
            </span>
            <span className="pm-meta muted">
              {[compName(x.competition), round, x.venue].filter(Boolean).join(" · ")}
              {x.broadcast && ` · 📺 ${x.broadcast}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
