"use client";

import type { ReactNode } from "react";
import { isRtl } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import type { MatchView } from "./matchView";
import { isTentative } from "./matchView";
import { resultFor } from "./result";
import { useSpoiler } from "./spoiler";
import { dateLabel, isDawn, keyOf, matchTimeLabel, monthLabel, weekdayNames } from "./time";
import { useTz } from "./timezone";

interface Props {
  year: number;
  month: number; // 0-11
  todayKey: string;
  selectedKey: string;
  byDay: Map<string, MatchView[]>;
  teamShort: (slug: string) => string;
  onSelectDay(key: string): void;
  onMove(delta: number): void;
  onToday(): void;
  // 리그 일정 탭: 칸 내용(그날 경기 수 등)을 직접 그린다. 주면 byDay 대신 쓴다
  cell?: (key: string) => { count: number; node: ReactNode };
}

const MAX_CHIPS = 3;

export function MonthCalendar({ year, month, todayKey, selectedKey, byDay, teamShort, onSelectDay, onMove, onToday, cell }: Props) {
  const { m: t, intl, locale, t: fmt } = useI18n();
  const tz = useTz();
  const spoiler = useSpoiler();
  const rtl = isRtl(locale);
  const title = monthLabel(year, month, intl);
  // 달력 칸은 시간대와 무관하게 날짜 숫자로 만든다 (UTC 기준 계산)
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((firstWeekday + daysInMonth) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(Date.UTC(year, month, 1 - firstWeekday + i));
    return { key: keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() };
  });

  return (
    <section className="card calendar" aria-label={title}>
      <div className="cal-head">
        <h2>{title}</h2>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => onMove(-1)} aria-label={t.calendar.prevMonth}>
            {rtl ? "›" : "‹"}
          </button>
          <button type="button" className="ghost" onClick={onToday}>
            {t.calendar.today}
          </button>
          <button type="button" className="icon-btn" onClick={() => onMove(1)} aria-label={t.calendar.nextMonth}>
            {rtl ? "‹" : "›"}
          </button>
        </div>
      </div>
      <div className="cal-grid" role="grid">
        {weekdayNames(intl).map((w, i) => (
          <div key={w} className={`cal-wd${i === 0 ? " sun" : i === 6 ? " sat" : ""}`} role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const key = d.key;
          const custom = cell?.(key);
          const items = custom ? [] : (byDay.get(key) ?? []);
          const cls = [
            "cal-day",
            d.month !== month && "out",
            key === todayKey && "today",
            key === selectedKey && "selected",
            d.weekday === 0 && "sun",
            d.weekday === 6 && "sat",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              className={cls}
              onClick={() => onSelectDay(key)}
              aria-label={fmt(t.calendar.dayMatches, { date: dateLabel(key, intl), count: custom?.count ?? items.length })}
            >
              <span className="num">{d.day}</span>
              {custom?.node}
              {!custom && (
                <span className="chips">
                  {items.slice(0, MAX_CHIPS).map((v) => {
                    // 끝난 경기는 시각 대신 결과 (스포일러 방지 중이면 시각 그대로)
                    const r = spoiler.hide ? null : resultFor(v.match, v.team);
                    return (
                      <span
                        key={v.match.id}
                        className={`chip${isTentative(v.match) ? " tentative" : ""}${v.match.status === "cancelled" ? " cancelled" : ""}`}
                        style={v.colors as React.CSSProperties}
                      >
                        {r ? (
                          <span className={`chip-time chip-result result-${r.outcome}`}>
                            {t.results[r.outcome]} {r.mine}:{r.theirs}
                          </span>
                        ) : (
                          <span className="chip-time">
                            {isDawn(v.match, tz) && "🌙"}
                            {matchTimeLabel(v.match, intl, t.match.timeTbdShort, tz)}
                          </span>
                        )}
                        <span className="chip-text">
                          {teamShort(v.team)} {v.side ? `${t.match.vs} ` : ""}
                          {v.opponent}
                        </span>
                      </span>
                    );
                  })}
                  {items.length > MAX_CHIPS && <span className="more">+{items.length - MAX_CHIPS}</span>}
                </span>
              )}
              {!custom && (
                <span className="dots" aria-hidden>
                  {items.slice(0, 4).map((v) => (
                    <span
                      key={v.match.id}
                      className={`dot${isTentative(v.match) ? " tentative" : ""}`}
                      style={v.colors as React.CSSProperties}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
