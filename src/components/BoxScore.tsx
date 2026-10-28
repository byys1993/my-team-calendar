"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatLabel } from "@/i18n/format";
import { BOX_COMPETITIONS, type BoxGroup, type BoxScore } from "@/lib/boxscore";
import type { ScheduleMatch } from "@/lib/schedule";
import { track } from "./track";

const SOURCE_NAME: Record<BoxScore["source"], string> = { espn: "ESPN", mlb: "MLB Stats API", nhl: "NHL" };

// 끝난 경기 결과 옆 '기록' 버튼 → 기록지 창 (처음 열 때 받아 온다)
export function BoxScoreButton({ match, team }: { match: ScheduleMatch; team: string }) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  if (!BOX_COMPETITIONS.has(match.competition) || match.homeScore == null) return null;
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
  const { m } = useI18n();
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
  const label = (key: string, list: Record<string, string>) => list[key] ?? key;

  return (
    <dialog ref={ref} className="picker auth-dialog box-dialog" onClose={onClose} aria-labelledby="box-title">
      <div className="picker-head">
        <h2 id="box-title">
          {away} {match.awayScore} : {match.homeScore} {home}
        </h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="picker-body box-body">
        {!box && !failed && <p className="muted">{m.box.loading}</p>}
        {failed && <p className="muted">{m.box.error}</p>}
        {box && (
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
                    {(["away", "home"] as const).map((s) => (
                      <tr key={s}>
                        <th>{name[s]}</th>
                        {box.line![s].map((v, i) => (
                          <td key={i} className={i >= box.line!.labels.length - (box.source === "mlb" ? 3 : 1) ? "box-sum" : undefined}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {box.stats.length > 0 && (
              <>
                <h3>{m.box.teamStats}</h3>
                <table className="box-table box-team">
                  <thead>
                    <tr>
                      <th />
                      <th>{away}</th>
                      <th>{home}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {box.stats.map((s) => (
                      <tr key={s.key}>
                        <th>{label(s.key, m.box.stats)}</th>
                        <td>{s.away}</td>
                        <td>{s.home}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="box-tabs" role="tablist">
              {(["away", "home"] as const).map((s) => (
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

            <p className="muted small">{m.box.source.replace("{name}", SOURCE_NAME[box.source])}</p>
          </>
        )}
      </div>
    </dialog>
  );
}

function PlayerTable({ group, title, total }: { group: BoxGroup; title: string; total: string }) {
  return (
    <>
      <h3>{title}</h3>
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
