import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { PageMatchList } from "@/components/PageMatchList";
import { SpoilerProvider, SpoilerToggle } from "@/components/spoiler";
import { dateLabel } from "@/components/time";
import { COLUMNS, format, GROUP_KO, type ColKey } from "@/components/standingFormat";
import { fmt, MESSAGES } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { formatLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { getDb } from "@/lib/db";
import { sportsEventList } from "@/lib/jsonld";
import { f1Driver, f1Team } from "@/lib/f1names";
import { getLeaguePage, type LeagueNavQuery } from "@/lib/pages";
import { SITE_URL } from "@/lib/site";

// 리그 페이지: '○○리그 일정·순위' 검색으로 들어오는 입구. 이번 주 경기(라운드·주 단위로 앞뒤 이동), 순위표, 개인 순위, 팀 페이지 링크.
// 같은 요청 안에서 제목(메타데이터)과 본문이 한 번만 조회하도록 묶는다.
// (unstable_cache 는 Vercel 에서 이 페이지가 응답하지 않는 문제가 있어 쓰지 않는다)
const cached = cache((slug: string, locale: Locale, round?: number, from?: string) =>
  getLeaguePage(getDb(), slug, locale, new Date(), { round, from }),
);

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// ?round=9 (축구 라운드) 또는 ?from=2026-10-28 (그날부터 7일). 이상한 값은 무시하고 기본 화면
async function navQuery(searchParams: Props["searchParams"]): Promise<LeagueNavQuery> {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const round = one(sp.round);
  return { round: round && /^\d{1,3}$/.test(round) ? Number(round) : undefined, from: one(sp.from) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const q = await navQuery(searchParams);
  const locale = await getLocale();
  const m = MESSAGES[locale];
  const data = /^[a-z0-9-]{1,64}$/.test(slug) ? await cached(slug, locale, q.round, q.from) : null;
  if (!data) return {};
  const vars = { league: data.competition.name, site: m.meta.title };
  const title = fmt(m.leaguePage.metaTitle, vars);
  const description = fmt(m.leaguePage.metaDesc, vars);
  return {
    title,
    description,
    alternates: { canonical: `/league/${slug}` },
    openGraph: { title, description, url: `/league/${slug}`, type: "website", siteName: m.meta.title },
  };
}

export default async function LeaguePage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();
  const q = await navQuery(searchParams);
  const locale = await getLocale();
  const data = await cached(slug, locale, q.round, q.from);
  if (!data) notFound();
  const m = MESSAGES[locale];
  const intl = INTL_LOCALE[locale];
  const { competition, week, nav, tables, teams, teamName } = data;
  const league = competition.name;
  const columns = COLUMNS[competition.sport] ?? COLUMNS.soccer;
  const label = (k: ColKey) => (competition.sport === "motorsport" && k === "pts" ? m.records.points : m.records.cols[k]);
  const groupName = (g: string | null) => (g && locale === "ko" ? (GROUP_KO[g] ?? g) : g);
  const rowName = (r: (typeof tables)[number]["groups"][number]["rows"][number], kind: string) =>
    kind === "drivers"
      ? f1Driver(r.driverId ?? "", r.name, locale)
      : kind === "constructors"
        ? f1Team(r.name, locale)
        : ((r.team && teamName[r.team]) ?? r.name);
  const standings = tables.filter((t) => t.kind !== "leaders");
  // 경기 목록 제목: 라운드('9라운드'), 기본 7일('이번 주 경기'), 이동한 7일('10월 28일 (수) – 11월 3일 (화)')
  const heading =
    nav.mode === "round"
      ? (formatLabel(`@md:${nav.round}`, m) ?? String(nav.round))
      : nav.isDefault
        ? m.leaguePage.week
        : `${dateLabel(nav.from, intl)} – ${dateLabel(nav.to, intl)}`;
  const leaders = tables.find((t) => t.kind === "leaders");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: league,
    sport: competition.sport,
    url: `${SITE_URL}/league/${slug}`,
    ...(teams.length ? { member: teams.map((t) => ({ "@type": "SportsTeam", name: t.name, url: `${SITE_URL}/team/${t.slug}` })) } : {}),
    // 지금 보는 라운드·주의 남은 경기 (경기장을 아는 것만)
    event: sportsEventList(week, (l) => formatLabel(l, m) ?? l, { name: league, url: `${SITE_URL}/league/${slug}` }, new Date(), 20),
  };

  return (
    <main className="app page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="crumbs">
        <Link href="/">{m.teamPage.home}</Link>
      </nav>
      <h1>{fmt(m.leaguePage.title, { league })}</h1>
      <div className="page-actions">
        <Link className="primary" href="/">
          {m.leaguePage.open}
        </Link>
      </div>

      <I18nProvider locale={locale} messages={m}>
        <SpoilerProvider>
          <section id="matches">
            <div className="league-nav-head">
              <h2>{heading}</h2>
              {week.some((x) => x.homeScore != null || x.podium?.length) && <SpoilerToggle />}
            </div>
            <nav className="league-nav" aria-label={heading}>
              {nav.prev ? (
                <Link href={`/league/${slug}${nav.prev}#matches`} rel="nofollow">
                  {m.leaguePage.prev}
                </Link>
              ) : (
                <span className="disabled">{m.leaguePage.prev}</span>
              )}
              {!nav.isDefault && (
                <Link href={`/league/${slug}#matches`} className="current">
                  {m.leaguePage.current}
                </Link>
              )}
              {nav.next ? (
                <Link href={`/league/${slug}${nav.next}#matches`} rel="nofollow">
                  {m.leaguePage.next}
                </Link>
              ) : (
                <span className="disabled">{m.leaguePage.next}</span>
              )}
            </nav>
            {week.length ? (
              <PageMatchList matches={week} team={null} m={m} locale={locale} intl={intl} compName={() => league} showResult interactive />
            ) : (
              <p className="muted">{nav.mode === "week" && nav.isDefault ? m.leaguePage.noWeek : m.leaguePage.noRange}</p>
            )}
            <p className="muted small">{m.teamPage.timesNote}</p>
          </section>
        </SpoilerProvider>
      </I18nProvider>

      {standings.map((t) => {
        const cols = columns.filter((k) => t.groups.some((g) => g.rows.some((r) => r.stats[k] != null && r.stats[k] !== "")));
        const head = t.kind === "drivers" ? m.records.driver : t.kind === "constructors" ? m.records.constructor : m.records.team;
        return (
          <section key={t.kind} className="standing">
            <h2>
              {t.kind === "drivers" ? m.records.drivers : t.kind === "constructors" ? m.records.constructors : m.leaguePage.standings}
            </h2>
            {t.groups.map((g, gi) => (
              <div key={gi} className="standing-group">
                {g.name && <h4>{groupName(g.name)}</h4>}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">{m.records.rank}</th>
                        <th className="name">{head}</th>
                        {cols.map((k) => (
                          <th key={k} className="num">
                            {label(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => (
                        <tr key={`${r.rank}-${r.name}-${i}`}>
                          <td className="num">{r.rank}</td>
                          <td className="name">
                            {r.team ? <Link href={`/team/${r.team}`}>{rowName(r, t.kind)}</Link> : rowName(r, t.kind)}
                            {r.sub && <span className="muted"> · {f1Team(r.sub, locale)}</span>}
                          </td>
                          {cols.map((k) => (
                            <td key={k} className="num">
                              {format(k, r.stats[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {leaders && leaders.groups.length > 0 && (
        <section>
          <h2>{m.leaguePage.leaders}</h2>
          <div className="leaders">
            {leaders.groups.map((g) => (
              <div key={g.name} className="leader-card">
                <h4>{(g.name && (m.records.leaders as Record<string, string>)[g.name]) ?? g.name}</h4>
                <ol>
                  {g.rows.map((r, i) => (
                    <li key={`${r.rank}-${r.name}-${i}`}>
                      <span className="lr-rank">{r.rank}</span>
                      <span className="lr-name">
                        {r.driverId ? f1Driver(r.driverId, r.name, locale) : r.name}
                        <span className="muted">
                          {" "}
                          {r.driverId ? f1Team(r.sub ?? "", locale) : ((r.team && teamName[r.team]) ?? r.sub ?? "")}
                        </span>
                      </span>
                      <span className="lr-value">{r.stats.value}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {teams.length > 0 && (
        <section>
          <h2>{m.leaguePage.teams}</h2>
          <ul className="page-links">
            {teams.map((t) => (
              <li key={t.slug}>
                <Link href={`/team/${t.slug}`}>{t.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
