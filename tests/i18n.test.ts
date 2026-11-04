import { describe, expect, it } from "vitest";
import { kboRound } from "@/collector/sources/kbo";
import { lolBlock } from "@/collector/sources/lolesports";
import { LOCALES, matchLocale } from "@/i18n/config";
import { formatLabel, formatTitle } from "@/i18n/format";
import { fmt, MESSAGES } from "@/i18n";

describe("언어 고르기", () => {
  it("Accept-Language 에서 지원 언어 중 가장 선호하는 것을 고른다", () => {
    expect(matchLocale("ko-KR,ko;q=0.9,en-US;q=0.8")).toBe("ko");
    expect(matchLocale("it-IT,it;q=0.9,de;q=0.7")).toBe("de");
    expect(matchLocale("pt-BR")).toBe("pt");
    expect(matchLocale("it-IT")).toBe("en"); // 지원하지 않으면 영어
    expect(matchLocale(null)).toBe("ko"); // 언어 정보 없음(검색 수집기) → 한국어
    expect(matchLocale("")).toBe("ko");
  });

  it("모든 언어 문구가 같은 자리 표시({max} 등)를 가진다", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = MESSAGES.en;
    for (const l of LOCALES) {
      const m = MESSAGES[l];
      expect(placeholders(m.app.emptyHint), l).toEqual(placeholders(en.app.emptyHint));
      expect(placeholders(m.auth.codeSent), l).toEqual(placeholders(en.auth.codeSent));
      expect(placeholders(m.round.matchday), l).toEqual(["n"]);
      expect(placeholders(m.teamPage.metaNext), l).toEqual(["next", "team"]);
      expect(placeholders(m.leaguePage.metaNext), l).toEqual(["league", "next"]);
      expect(m.privacyPage.body.length, l).toBe(en.privacyPage.body.length);
    }
  });
});

describe("토큰을 화면 언어로", () => {
  const ko = MESSAGES.ko;
  const en = MESSAGES.en;

  it("라운드·시리즈·경기 방식", () => {
    expect(formatLabel("@md:9", ko)).toBe("9라운드");
    expect(formatLabel("@md:9", en)).toBe("Matchday 9");
    expect(formatLabel("@stage:league|@md:3", ko)).toBe("리그 페이즈 · 3라운드");
    expect(formatLabel("@series:ws|@game:5", ko)).toBe("월드시리즈 · 5차전");
    expect(formatLabel("@series:kbo_po|@game:4", en)).toBe("Playoff · Game 4");
    expect(formatLabel("@lol:swiss|@bo:1", ko)).toBe("스위스 스테이지 · 단판");
    expect(formatLabel("@lol:finals|@bo:5", ko)).toBe("결승 · 5판 3선승");
    expect(formatLabel("@lol:finals|@bo:5", en)).toBe("Finals · Best of 5");
    expect(formatLabel("@playoffs:2|@game:6", en)).toBe("Playoffs round 2 · Game 6");
    expect(formatLabel("@tbd", MESSAGES.ja)).toBe("未定");
  });

  it("토큰이 아니면 원문 그대로 (ESPN 영문 비고, 관리자 입력)", () => {
    expect(formatLabel("Wild Card Playoffs", ko)).toBe("Wild Card Playoffs");
    expect(formatLabel("정규리그", en)).toBe("정규리그");
    expect(formatLabel("@t:Fourth Round", ko)).toBe("Fourth Round");
    expect(formatLabel(null, ko)).toBeNull();
  });

  it("F1 제목", () => {
    expect(formatTitle("@f1:United States Grand Prix:race", ko, "ko")).toBe("미국 GP 결승");
    expect(formatTitle("@f1:United States Grand Prix:qualifying", en, "en")).toBe("United States GP Qualifying");
    expect(formatTitle("@f1:Las Vegas Grand Prix:sprint", MESSAGES.de, "de")).toBe("Las Vegas GP Sprint");
  });

  it("자리 표시 채우기", () => {
    expect(fmt(MESSAGES.fr.picker.full, { max: 10 })).toContain("10");
  });
});

describe("수집기 토큰 만들기", () => {
  it("LoL 영문 블록 이름", () => {
    expect(lolBlock("Week 7")).toBe("@week:7");
    expect(lolBlock("Round 1")).toBe("@round:1");
    expect(lolBlock("Swiss")).toBe("@lol:swiss");
    expect(lolBlock("Quarterfinals")).toBe("@stage:qf");
    expect(lolBlock("Play In Knockouts")).toBe("@lol:playin|@lol:knockouts");
    expect(lolBlock("Something New")).toBe("@t:Something New");
  });

  it("KBO 비고", () => {
    expect(kboRound("준PO 2차전")).toBe("@series:kbo_semi|@game:2");
    expect(kboRound("KS 7차전")).toBe("@series:kbo_ks|@game:7");
    expect(kboRound("-")).toBe("@postseason");
    expect(kboRound("올스타전")).toBe("@t:올스타전");
  });
});
