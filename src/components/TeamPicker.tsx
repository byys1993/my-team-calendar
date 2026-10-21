"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TEAMS, type Catalog } from "@/lib/schedule";
import { PALETTE, type Selection } from "./selection";

interface Props {
  catalog: Catalog;
  selections: Selection[];
  onAdd(slug: string): void;
  onRemove(slug: string): void;
  onClose(): void;
}

export function TeamPicker({ catalog, selections, onAdd, onRemove, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sport, setSport] = useState(catalog.sports[0]?.slug ?? "");
  const [query, setQuery] = useState("");
  const selected = new Map(selections.map((s) => [s.slug, s]));
  const full = selections.length >= MAX_TEAMS;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const q = query.trim().toLowerCase();
  const teams = catalog.teams.filter((t) =>
    q ? t.nameKo.toLowerCase().includes(q) || t.shortKo.toLowerCase().includes(q) : t.sport === sport,
  );
  const groups = catalog.competitions
    .map((c) => ({ comp: c, teams: teams.filter((t) => t.competition === c.slug) }))
    .filter((g) => g.teams.length > 0);

  return (
    <dialog ref={dialog} className="picker" onClose={onClose} aria-labelledby="picker-title">
      <div className="picker-head">
        <h2 id="picker-title">팀 선택</h2>
        <span className={full ? "count full" : "count"}>
          {selections.length}/{MAX_TEAMS}
        </span>
        <button type="button" className="icon-btn" onClick={() => dialog.current?.close()} aria-label="닫기">
          ✕
        </button>
      </div>
      <input
        className="search"
        type="search"
        placeholder="팀 이름 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
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
              {s.nameKo}
            </button>
          ))}
        </div>
      )}
      {full && <p className="notice">최대 {MAX_TEAMS}팀까지 선택할 수 있어요. 다른 팀을 빼면 추가할 수 있습니다.</p>}
      <div className="picker-body">
        {groups.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}
        {groups.map(({ comp, teams }) => (
          <section key={comp.slug}>
            <h3>{comp.nameKo}</h3>
            <div className="team-grid">
              {teams.map((t) => {
                const sel = selected.get(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    className={sel ? "team-btn on" : "team-btn"}
                    style={sel ? { borderColor: PALETTE[sel.color] } : undefined}
                    aria-pressed={!!sel}
                    disabled={!sel && full}
                    onClick={() => (sel ? onRemove(t.slug) : onAdd(t.slug))}
                  >
                    {sel && <span className="dot" style={{ background: PALETTE[sel.color] }} />}
                    {t.nameKo}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="picker-foot">
        <button type="button" className="primary" onClick={() => dialog.current?.close()}>
          완료
        </button>
      </div>
    </dialog>
  );
}
