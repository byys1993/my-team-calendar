"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { F1_SERIES, f1Pick } from "@/lib/f1picks";
import { MAX_TEAMS, type Catalog, type CatalogTeam } from "@/lib/schedule";
import { PALETTE, teamInk } from "@/lib/palette";
import type { Selection } from "./selection";

interface Props {
  catalog: Catalog;
  selections: Selection[];
  onAdd(slug: string): void;
  onRemove(slug: string): void;
  onClear(): void;
  onClose(): void;
  f1MainOnly: boolean;
  onF1MainOnly(v: boolean): void;
}

export function TeamPicker({ catalog, selections, onAdd, onRemove, onClear, onClose, f1MainOnly, onF1MainOnly }: Props) {
  const { m: t, t: fmt } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [sport, setSport] = useState(catalog.sports[0]?.slug ?? "");
  const [query, setQuery] = useState("");
  const selected = new Map(selections.map((s) => [s.slug, s]));
  const full = selections.length >= MAX_TEAMS;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const q = query.trim().toLowerCase();
  const teams = catalog.teams.filter(
    (team) =>
      (team.slug !== F1_SERIES || selected.has(team.slug)) &&
      (q ? team.name.toLowerCase().includes(q) || team.short.toLowerCase().includes(q) : team.sport === sport),
  );
  const groups = catalog.competitions
    .map((c) => ({ comp: c, teams: teams.filter((team) => team.competition === c.slug) }))
    .filter((g) => g.teams.length > 0);

  const teamButton = (team: CatalogTeam) => {
    const sel = selected.get(team.slug);
    return (
      <button
        key={team.slug}
        type="button"
        className={sel ? "team-btn on" : "team-btn"}
        style={sel ? { borderColor: teamInk(sel.color) } : undefined}
        aria-pressed={!!sel}
        disabled={!sel && full}
        onClick={() => (sel ? onRemove(team.slug) : onAdd(team.slug))}
      >
        {sel && <span className="dot" style={{ background: PALETTE[sel.color] }} />}
        {team.name}
      </button>
    );
  };

  return (
    <dialog ref={dialog} className="picker" onClose={onClose} aria-labelledby="picker-title">
      <div className="picker-head">
        <h2 id="picker-title">{t.picker.title}</h2>
        <span className={full ? "count full" : "count"}>
          {selections.length}/{MAX_TEAMS}
        </span>
        <button type="button" className="icon-btn" onClick={() => dialog.current?.close()} aria-label={t.picker.close}>
          ✕
        </button>
      </div>
      <input className="search" type="search" placeholder={t.picker.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      {!q && (
        <div className="tabs" role="tablist">
          {catalog.sports.map((s) => (
            <button
              key={s.slug}
              type="button"
              role="tab"
              aria-selected={s.slug === sport}
              className={s.slug === sport ? "tab active" : "tab"}
              onClick={() => setSport(s.slug)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {full && <p className="notice">{fmt(t.picker.full, { max: MAX_TEAMS })}</p>}
      <div className="picker-body">
        {groups.length === 0 && <p className="muted">{t.picker.noResults}</p>}
        {groups.map(({ comp, teams }) => {
          // F1 은 팀 / 드라이버로 나눠 보여 준다 (시리즈 전체는 이미 고른 경우에만, 뺄 수 있게)
          const parts =
            comp.slug === "f1"
              ? [
                  { key: "all", title: t.picker.f1All, list: teams.filter((x) => !f1Pick(x.slug)) },
                  { key: "team", title: t.picker.f1Teams, list: teams.filter((x) => f1Pick(x.slug)?.kind === "team") },
                  { key: "driver", title: t.picker.f1Drivers, list: teams.filter((x) => f1Pick(x.slug)?.kind === "driver") },
                ].filter((p) => p.list.length > 0)
              : [{ key: "all", title: null, list: teams }];
          return (
            <section key={comp.slug}>
              <h3>{comp.name}</h3>
              {/* F1: 연습 주행·스프린트 예선을 뺄지 (화면·구독 주소·알림 메일) */}
              {comp.slug === "f1" && (
                <>
                  <label className="picker-option">
                    <input type="checkbox" checked={f1MainOnly} onChange={(e) => onF1MainOnly(e.target.checked)} />
                    {t.app.f1Main}
                  </label>
                  <p className="muted small picker-option-hint">{t.app.f1MainHint}</p>
                </>
              )}
              {parts.map((part) => (
                <div key={part.key}>
                  {part.title && <h4 className="picker-sub">{part.title}</h4>}
                  <div className="team-grid">{part.list.map(teamButton)}</div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <div className="picker-foot">
        {/* 고른 팀을 한 번에 모두 빼기 */}
        <button
          type="button"
          className="ghost"
          disabled={selections.length === 0}
          onClick={() => {
            if (confirm(t.picker.confirmReset)) onClear();
          }}
        >
          {t.picker.reset}
        </button>
        <button type="button" className="primary" onClick={() => dialog.current?.close()}>
          {t.picker.done}
        </button>
      </div>
    </dialog>
  );
}
