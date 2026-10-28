import type { ScheduleMatch } from "@/lib/schedule";

// 팀 페이지의 다가오는 경기 → schema.org SportsEvent (Google 이벤트 구조화 데이터)
// Google 은 장소(location)가 없으면 '심각한 문제'로 보므로 경기장을 아는 경기만 넣는다 (유럽 축구는 홈팀 경기장).

// 끝나는 시각은 출처에 없어 종목별 보통 경기 시간으로 잡는다
const DURATION_MIN: Record<string, number> = {
  soccer: 120,
  baseball: 180,
  basketball: 150,
  "american-football": 210,
  hockey: 150,
  motorsport: 120,
  esports: 180,
};

const STATUS: Partial<Record<ScheduleMatch["status"], string>> = {
  postponed: "https://schema.org/EventPostponed",
  cancelled: "https://schema.org/EventCancelled",
};

export function sportsEventJsonLd(x: ScheduleMatch, names: { home: string; away: string }, league: { name: string; url: string } | null) {
  if (!x.startAt || !x.venue) return null;
  const start = new Date(x.startAt);
  const end = new Date(start.getTime() + (DURATION_MIN[x.sport] ?? 120) * 60_000);
  const team = (name: string) => ({ "@type": "SportsTeam", name });
  const name = `${names.home} vs ${names.away}`;
  return {
    "@type": "SportsEvent",
    name,
    description: league ? `${league.name} · ${name}` : name,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    eventStatus: STATUS[x.status] ?? "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: x.venue, address: x.venueCity ? `${x.venue}, ${x.venueCity}` : x.venue },
    homeTeam: team(names.home),
    awayTeam: team(names.away),
    performer: [team(names.home), team(names.away)],
    ...(league ? { organizer: { "@type": "SportsOrganization", name: league.name, url: league.url } } : {}),
  };
}
