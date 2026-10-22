"use client";

import { isRtl } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import type { MatchView } from "./matchView";
import { isTentative } from "./matchView";
import { dateLabel, matchTimeLabel, monthLabel, toDateKey, weekdayNames } from "./time";

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
}

const MAX_CHIPS = 3;

export function MonthCalendar({ year, month, todayKey, selectedKey, byDay, teamShort, onSelectDay, onMove, onToday }: Props) {
  const { m: t, intl, locale, t: fmt } = useI18n();
  const rtl = isRtl(locale);
  const title = monthLabel(year, month, intl);
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));

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
          const key = toDateKey(d);
          const items = byDay.get(key) ?? [];
          const cls = [
            "cal-day",
            d.getMonth() !== month && "out",
            key === todayKey && "today",
            key === selectedKey && "selected",
            d.getDay() === 0 && "sun",
            d.getDay() === 6 && "sat",
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
              aria-label={fmt(t.calendar.dayMatches, { date: dateLabel(key, intl), count: items.length })}
            >
              <span className="num">{d.getDate()}</span>
              <span className="chips">
                {items.slice(0, MAX_CHIPS).map((v) => (
                  <span
                    key={v.match.id}
                    className={`chip${isTentative(v.match) ? " tentative" : ""}${v.match.status === "cancelled" ? " cancelled" : ""}`}
                    style={{ "--team": v.color } as React.CSSProperties}
                  >
                    <span className="chip-time">{matchTimeLabel(v.match, intl, t.match.timeTbdShort)}</span>
                    <span className="chip-text">
                      {teamShort(v.team)} {v.side ? `${t.match.vs} ` : ""}
                      {v.opponent}
                    </span>
                  </span>
                ))}
                {items.length > MAX_CHIPS && <span className="more">+{items.length - MAX_CHIPS}</span>}
              </span>
              <span className="dots" aria-hidden>
                {items.slice(0, 4).map((v) => (
                  <span
                    key={v.match.id}
                    className={`dot${isTentative(v.match) ? " tentative" : ""}`}
                    style={{ "--team": v.color } as React.CSSProperties}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
