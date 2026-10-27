import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { PageMatchList, PAGE_TZ } from "@/components/PageMatchList";
import { dateLabel, matchDateKey } from "@/components/time";
import { fmt, MESSAGES } from "@/i18n";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { getDb } from "@/lib/db";
import { getTeamPage } from "@/lib/pages";
import { SITE_URL } from "@/lib/site";

// 팀 페이지: '○○ 경기 일정' 검색으로 들어오는 입구. 서버에서 그리고 10분 캐시한다.
// 같은 요청 안에서 제목(메타데이터)과 본문이 한 번만 조회하도록 묶는다.
// (unstable_cache 는 Vercel 에서 이 페이지가 응답하지 않는 문제가 있어 쓰지 않는다)
const cached = cache((slug: string, locale: Locale) => getTeamPage(getDb(), slug, locale));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const m = MESSAGES[locale];
  const data = /^[a-z0-9-]{1,64}$/.test(slug) ? await cached(slug, locale) : null;
  if (!data) return {};
  const vars = { team: data.team.name, league: data.competition?.name ?? "", site: m.meta.title };
  const title = fmt(m.teamPage.metaTitle, vars);
  const description = fmt(m.teamPage.metaDesc, vars);
  return {
    title,
    description,
    alternates: { canonical: `/team/${slug}` },
    openGraph: { title, description, url: `/team/${slug}`, type: "website", siteName: m.meta.title },
  };
}

export default async function TeamPage({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();
  const locale = await getLocale();
  const data = await cached(slug, locale);
  if (!data) notFound();
  const m = MESSAGES[locale];
  const intl = INTL_LOCALE[locale];
  const { team, competition, upcoming, recent, standing, leagueTeams } = data;
  const league = competition?.name ?? "";
  const compName = () => league;
  const webcal = `${SITE_URL.replace(/^https?:/, "webcal:")}/ics/${slug}.ics?lang=${locale}`;
  const next = upcoming[0];

  // 검색엔진·AI 용: 팀과 다가오는 경기 (schema.org)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    name: team.name,
    sport: team.sport,
    url: `${SITE_URL}/team/${slug}`,
    ...(competition ? { memberOf: { "@type": "SportsOrganization", name: league } } : {}),
    event: upcoming
      .filter((x) => x.startAt && !(x.title && !x.away))
      .slice(0, 10)
      .map((x) => ({
        "@type": "SportsEvent",
        name: `${x.homeLabel} vs ${x.awayLabel}`,
        startDate: x.startAt,
        ...(x.venue ? { location: { "@type": "Place", name: x.venue } } : {}),
      })),
  };

  return (
    <main className="app page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="crumbs">
        <Link href="/">{m.teamPage.home}</Link>
        {competition && (
          <>
            {" › "}
            <Link href={`/league/${competition.slug}`}>{league}</Link>
          </>
        )}
      </nav>
      <h1>{fmt(m.teamPage.title, { team: team.name })}</h1>
      <p className="muted">
        {league}
        {standing && ` · ${fmt(m.teamPage.rank, { league: standing.group ?? league, rank: standing.rank })}`}
        {next && ` · ${m.teamPage.next}: ${dateLabel(matchDateKey(next, PAGE_TZ), intl)}`}
      </p>
      <div className="page-actions">
        <a className="primary" href={`/?add=${slug}`}>
          ➕ {m.teamPage.add}
        </a>
        <a className="ghost" href={webcal}>
          📅 {m.teamPage.subscribe}
        </a>
      </div>

      <section>
        <h2>{m.teamPage.upcoming}</h2>
        {upcoming.length ? (
          <PageMatchList matches={upcoming} team={slug} m={m} locale={locale} intl={intl} compName={compName} />
        ) : (
          <p className="muted">{m.teamPage.none}</p>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2>{m.teamPage.recent}</h2>
          <PageMatchList matches={recent} team={slug} m={m} locale={locale} intl={intl} compName={compName} showResult />
        </section>
      )}
      <p className="muted small">{m.teamPage.timesNote}</p>

      {competition && leagueTeams.length > 0 && (
        <section>
          <h2>{fmt(m.teamPage.others, { league })}</h2>
          <ul className="page-links">
            {leagueTeams.map((t) => (
              <li key={t.slug}>
                <Link href={`/team/${t.slug}`}>{t.name}</Link>
              </li>
            ))}
          </ul>
          <p>
            <Link href={`/league/${competition.slug}`}>{fmt(m.teamPage.league, { league })} →</Link>
          </p>
        </section>
      )}
    </main>
  );
}
