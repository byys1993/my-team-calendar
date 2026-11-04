"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatLabel, formatTitle } from "@/i18n/format";
import { AWAY_FIRST_COMPETITIONS, BOX_COMPETITIONS, type BoxEvent, type BoxGroup, type BoxScore } from "@/lib/boxscore";
import { LOL_PLAYER_LABELS } from "@/lib/boxscoreKr";
import type { F1Result } from "@/lib/boxscoreF1";
import { f1Driver, f1Team } from "@/lib/f1names";
import type { ScheduleMatch } from "@/lib/schedule";
import { track } from "./track";

const SUM_LABELS = new Set(["T", "R", "H", "E"]); // 합계 칸 (굵게)
const EVENT_ICON: Record<BoxEvent["type"], string> = { goal: "⚽", pen: "⚽", own: "⚽", yellow: "🟨", red: "🟥" };
const SOURCE_NAME: Record<BoxScore["source"], string> = {
  espn: "ESPN",
  mlb: "MLB Stats API",
  nhl: "NHL",
  kbo: "KBO",
  kbl: "KBL",
  kleague: "K League",
  kovo: "KOVO",
  lolesports: "LoL Esports",
  jolpica: "Jolpica F1",
};
type Side = "home" | "away";
type TeamStat = BoxScore["stats"][number];

// 끝난 경기 결과 옆 '기록' 버튼 (미국 4대 리그·KBO·KBL·V-리그·축구·K리그·LoL·F1) → 기록지 창 (처음 열 때 받아 온다)
export function BoxScoreButton({ match, team }: { match: ScheduleMatch; team: string }) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  if (!BOX_COMPETITIONS.has(match.competition) || (match.homeScore == null && !match.podium?.length)) return null;
  return (
    <>
      <button
        type="button"
        className="box-btn"
        onClick={() => {
          setOpen(true);
          track("box_open");
        }}
      >
        📋 {m.box.button}
      </button>
      {open && <BoxScoreDialog match={match} team={team} onClose={() => setOpen(false)} />}
    </>
  );
}

function BoxScoreDialog({ match, team, onClose }: { match: ScheduleMatch; team: string; onClose(): void }) {
  const { m, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [box, setBox] = useState<BoxScore | null>(null);
  const [failed, setFailed] = useState(false);
  // 처음엔 내 팀 선수 기록을 보여 준다
  const [side, setSide] = useState<"home" | "away">(match.away === team ? "away" : "home");

  useEffect(() => {
    ref.current?.showModal();
    const ctrl = new AbortController();
    fetch(`/api/boxscore?match=${match.id}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { box: BoxScore }) => setBox(d.box))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => ctrl.abort();
  }, [match.id]);

  const away = formatLabel(match.awayLabel, m) ?? match.awayLabel;
  const home = formatLabel(match.homeLabel, m) ?? match.homeLabel;
  const name = { away, home };
  // 야구·미국 리그는 원정팀을 먼저, 나머지(축구·KBL·e스포츠)는 홈팀(첫 번째 팀)을 먼저 쓴다
  const order: readonly [Side, Side] = AWAY_FIRST_COMPETITIONS.has(match.competition) ? ["away", "home"] : ["home", "away"];
  const score = { away: match.awayScore, home: match.homeScore };
  const label = (key: string, list: Record<string, string>) => list[key] ?? key;

  return (
    <dialog ref={ref} className="picker auth-dialog box-dialog" onClose={onClose} aria-labelledby="box-title">
      <div className="picker-head">
        <h2 id="box-title">
          {match.competition === "f1"
            ? (formatTitle(match.title, m, locale) ?? match.title)
            : `${name[order[0]]} ${score[order[0]]} : ${score[order[1]]} ${name[order[1]]}`}
        </h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="picker-body box-body">
        {!box && !failed && <p className="muted">{m.box.loading}</p>}
        {failed && <p className="muted">{m.box.error}</p>}
        {box?.f1 && (
          <>
            <F1Table result={box.f1} locale={locale} />
            <p className="muted small">{m.box.source.replace("{name}", SOURCE_NAME[box.source])}</p>
          </>
        )}
        {box && !box.f1 && (
          <>
            {box.line && (
              <div className="box-scroll">
                <table className="box-table box-line">
                  <thead>
                    <tr>
                      <th />
                      {box.line.labels.map((l, i) => (
                        <th key={i}>{l === "T" ? m.box.total : l}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((s) => (
                      <tr key={s}>
                        <th>{name[s]}</th>
                        {box.line![s].map((v, i) => (
                          <td key={i} className={SUM_LABELS.has(box.line!.labels[i]) ? "box-sum" : undefined}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {box.info && (box.info.crowd || box.info.duration) && (
              <p className="muted small box-info">
                {[
                  box.info.crowd && m.box.crowd.replace("{n}", box.info.crowd),
                  box.info.duration && m.box.duration.replace("{t}", box.info.duration),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {box.events && box.events.length > 0 && (
              <>
                <h3>{m.box.events}</h3>
                <ul className="box-events">
                  {box.events.map((e, i) => (
                    <li key={i} className={`box-ev-${e.side}`}>
                      <span className="box-min">{e.min}</span> {EVENT_ICON[e.type]} {e.player}
                      {e.type === "own" && <small> ({m.box.own})</small>}
                      {e.type === "pen" && <small> ({m.box.pen})</small>}
                      {e.assist && <small> ({e.assist})</small>}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {box.notes && box.notes.length > 0 && (
              <>
                <h3>{m.box.notes}</h3>
                <dl className="box-notes">
                  {box.notes.map((n, i) => (
                    <div key={i}>
                      <dt>{n.label}</dt>
                      <dd>{n.text}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {box.stats.length > 0 && (
              <>
                <h3>{m.box.teamStats}</h3>
                <TeamStats stats={box.stats} order={order} name={name} label={(k) => label(k, m.box.stats)} />
              </>
            )}

            <div className="box-tabs" role="tablist">
              {order.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={side === s}
                  className={side === s ? "on" : ""}
                  onClick={() => setSide(s)}
                >
                  {name[s]}
                </button>
              ))}
            </div>
            {box[side].map((g, i) => (
              <PlayerTable key={`${side}-${i}`} group={g} title={label(g.key, m.box.groups)} total={m.box.total} />
            ))}

            {/* LoL: 세트마다 팀 기록과 고른 팀 선수(챔피언·KDA) */}
            {box.sets?.map((set) => (
              <section key={set.n} className="box-set">
                <h3>
                  {m.box.set.replace("{n}", String(set.n))}
                  {set.winner && <small className="box-note"> · {m.box.won.replace("{team}", name[set.winner])}</small>}
                </h3>
                <TeamStats stats={set.stats} order={order} name={name} label={(k) => label(k, m.box.stats)} />
                <PlayerTable group={{ key: "", labels: LOL_PLAYER_LABELS, rows: set[side] }} total={m.box.total} />
              </section>
            ))}

            <p className="muted small">{m.box.source.replace("{name}", SOURCE_NAME[box.source])}</p>
          </>
        )}
      </div>
    </dialog>
  );
}

function TeamStats({
  stats,
  order,
  name,
  label,
}: {
  stats: TeamStat[];
  order: readonly [Side, Side];
  name: Record<Side, string>;
  label(key: string): string;
}) {
  return (
    <table className="box-table box-team">
      <thead>
        <tr>
          <th />
          <th>{name[order[0]]}</th>
          <th>{name[order[1]]}</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.key}>
            <th>{label(s.key)}</th>
            <td>{s[order[0]]}</td>
            <td>{s[order[1]]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlayerTable({ group, title, total }: { group: BoxGroup; title?: string; total: string }) {
  return (
    <>
      {title && <h3>{title}</h3>}
      <div className="box-scroll">
        <table className="box-table box-players">
          <thead>
            <tr>
              <th />
              {group.labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r, i) => (
              <tr key={i} className={r.sub ? "box-sub" : undefined}>
                <th>
                  {r.name}
                  {r.pos && <small> {r.pos}</small>}
                  {r.note && <small className="box-note"> {r.note}</small>}
                </th>
                {r.stats.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
            {group.totals && (
              <tr className="box-sum">
                <th>{total}</th>
                {group.totals.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// F1: 결승·스프린트 전체 순위, 예선 Q1~Q3. 드라이버·팀 이름은 화면 언어로
function F1Table({ result, locale }: { result: F1Result; locale: string }) {
  const { m } = useI18n();
  const f = m.box.f1;
  const quali = result.kind === "quali";
  const labels = quali ? ["Q1", "Q2", "Q3"] : [f.grid, f.laps, f.time, f.pts];
  const fl = result.fastestLap;
  return (
    <>
      {fl && (
        <p className="muted small box-info">
          ⏱ {f.fastestLap.replace("{name}", f1Driver(fl.driverId, fl.name, locale)).replace("{t}", fl.time)}
        </p>
      )}
      <div className="box-scroll">
        <table className="box-table box-players box-f1">
          <thead>
            <tr>
              <th>{f.pos}</th>
              <th>{f.driver}</th>
              {labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.driverId}>
                <td>{r.pos}</td>
                <th>
                  {f1Driver(r.driverId, r.name, locale)}
                  {r.fastest && " ⏱"}
                  <small className="box-note"> {f1Team(r.team, locale)}</small>
                </th>
                {(quali ? (r.q ?? []) : [r.grid ?? "", r.laps ?? "", r.time ?? "", r.pts && r.pts !== "0" ? r.pts : ""]).map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
