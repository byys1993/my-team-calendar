"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import { f1Driver, f1Team } from "@/lib/f1names";
import { teamVars } from "@/lib/palette";
import { SOURCE_LABEL } from "@/lib/sources";
import type { Catalog } from "@/lib/schedule";
import type { Selection } from "./selection";
import { updatedLabel } from "./time";
import { useTz } from "./timezone";

type StatKey = "gp" | "w" | "d" | "l" | "otl" | "pts" | "gf" | "ga" | "gd" | "pct" | "gb" | "wins";

interface Row {
  rank: number;
  team: string | null;
  name: string;
  driverId?: string;
  sub?: string;
  stats: Partial<Record<StatKey, number | string | null>>;
}
interface Table {
  kind: "teams" | "drivers" | "constructors";
  season: string | null;
  source: string;
  updatedAt: string;
  groups: { name: string | null; rows: Row[] }[];
}

// 종목별로 보여 줄 칸 (모든 줄이 비어 있는 칸은 숨긴다)
const COLUMNS: Record<string, StatKey[]> = {
  soccer: ["gp", "w", "d", "l", "gd", "pts"],
  baseball: ["gp", "w", "l", "d", "pct", "gb"],
  basketball: ["gp", "w", "l", "pct", "gb"],
  "american-football": ["w", "l", "d", "pct", "gb"],
  hockey: ["gp", "w", "l", "otl", "pts"],
  esports: ["w", "l"],
  motorsport: ["wins", "pts"],
};

function format(key: StatKey, v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  if (key === "pct") return v.toFixed(3);
  if (key === "gd" && v > 0) return `+${v}`;
  if (key === "gb" && v === 0) return "-";
  return String(v);
}

// 출처가 영어로 주는 조·지구 이름의 한국어 표기
const GROUP_KO: Record<string, string> = {
  "American League East": "AL 동부",
  "American League Central": "AL 중부",
  "American League West": "AL 서부",
  "National League East": "NL 동부",
  "National League Central": "NL 중부",
  "National League West": "NL 서부",
  "Eastern Conference": "동부 콘퍼런스",
  "Western Conference": "서부 콘퍼런스",
  Eastern: "동부 콘퍼런스",
  Western: "서부 콘퍼런스",
  "American Football Conference": "AFC",
  "National Football Conference": "NFC",
  "League Phase": "리그 페이즈",
};

// 순위 탭: 리그를 고르면 순위표. 내가 고른 팀은 팀 색으로 강조한다.
export function RecordsView({ catalog, selections }: { catalog: Catalog; selections: Selection[] }) {
  const { m, locale, intl } = useI18n();
  const tz = useTz();
  const [list, setList] = useState<{ slug: string; name: string; sport: string }[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [error, setError] = useState(false);

  const teamName = useMemo(() => new Map(catalog.teams.map((t) => [t.slug, t.name])), [catalog.teams]);
  const mine = useMemo(() => new Map(selections.map((s) => [s.slug, s.color])), [selections]);
  // 내 팀이 속한 대회를 앞에
  const myComps = useMemo(() => {
    const set = new Set<string>();
    for (const s of selections) {
      const c = catalog.teams.find((t) => t.slug === s.slug)?.competition;
      if (c) set.add(c);
    }
    return set;
  }, [catalog.teams, selections]);

  useEffect(() => {
    fetch(`/api/standings?lang=${locale}`)
      .then((r) => r.json())
      .then((d: { competitions: { slug: string; name: string; sport: string }[] }) => {
        const sorted = [...d.competitions].sort((a, b) => Number(myComps.has(b.slug)) - Number(myComps.has(a.slug)));
        setList(sorted);
        setCurrent((c) => c ?? sorted[0]?.slug ?? null);
      })
      .catch(() => setError(true));
  }, [locale, myComps]);

  useEffect(() => {
    if (!current) return;
    setTables(null);
    fetch(`/api/standings?c=${current}&lang=${locale}`)
      .then((r) => r.json())
      .then((d: { tables: Table[] }) => setTables(d.tables))
      .catch(() => setError(true));
  }, [current, locale]);

  const sport = list?.find((c) => c.slug === current)?.sport ?? "soccer";
  const columns = COLUMNS[sport] ?? COLUMNS.soccer;
  const label = (k: StatKey) => (sport === "motorsport" && k === "pts" ? m.records.points : m.records.cols[k]);

  if (error) return <p className="error">{m.records.error}</p>;
  if (!list) return <p className="muted">{m.app.loading}</p>;
  if (list.length === 0) return <p className="muted">{m.records.empty}</p>;

  return (
    <section className="records">
      <div className="records-tabs" role="tablist" aria-label={m.records.title}>
        {list.map((c) => (
          <button
            key={c.slug}
            type="button"
            role="tab"
            aria-selected={c.slug === current}
            className={`records-comp${c.slug === current ? " on" : ""}${myComps.has(c.slug) ? " mine" : ""}`}
            onClick={() => setCurrent(c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {!tables && <p className="muted">{m.app.loading}</p>}
      {tables?.length === 0 && <p className="muted">{m.records.empty}</p>}
      {tables?.map((t) => {
        const cols = columns.filter((k) => t.groups.some((g) => g.rows.some((r) => r.stats[k] != null && r.stats[k] !== "")));
        const nameHeader = t.kind === "drivers" ? m.records.driver : t.kind === "constructors" ? m.records.constructor : m.records.team;
        return (
          <div key={t.kind} className="standing">
            {t.kind !== "teams" && <h3>{t.kind === "drivers" ? m.records.drivers : m.records.constructors}</h3>}
            {t.groups.map((g, gi) => (
              <div key={gi} className="standing-group">
                {g.name && <h4>{locale === "ko" ? (GROUP_KO[g.name] ?? g.name) : g.name}</h4>}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">{m.records.rank}</th>
                        <th className="name">{nameHeader}</th>
                        {cols.map((k) => (
                          <th key={k} className="num">
                            {label(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => {
                        const color = r.team != null ? mine.get(r.team) : undefined;
                        const display =
                          t.kind === "drivers"
                            ? f1Driver(r.driverId ?? "", r.name, locale)
                            : t.kind === "constructors"
                              ? f1Team(r.name, locale)
                              : ((r.team && teamName.get(r.team)) ?? r.name);
                        return (
                          <tr
                            key={`${r.rank}-${r.name}-${i}`}
                            className={color != null ? "mine" : undefined}
                            style={color != null ? (teamVars(color) as React.CSSProperties) : undefined}
                          >
                            <td className="num">{r.rank}</td>
                            <td className="name">
                              {display}
                              {r.sub && <span className="muted"> · {f1Team(r.sub, locale)}</span>}
                            </td>
                            {cols.map((k) => (
                              <td key={k} className="num">
                                {format(k, r.stats[k])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="muted small">
              {t.season && `${t.season} · `}
              {updatedLabel(t.updatedAt, intl, tz)} · {SOURCE_LABEL(t.source)}
            </p>
          </div>
        );
      })}
    </section>
  );
}
