import { ImageResponse } from "next/og";

// 카카오톡·SNS 에 링크를 붙였을 때 뜨는 미리보기 그림 (1200×630). 빌드할 때 한 번 만든다.
export const alt = "마이팀 캘린더";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TITLE = "마이팀 캘린더";
const TAGLINE = "내 팀 경기 일정·결과·중계를 한 캘린더에";
const LEAGUES = ["KBO", "K리그", "KBL", "EPL", "NBA", "MLB", "F1", "LCK"];
const COLORS = ["#D42E26", "#204E9C", "#EDB94E", "#316E44", "#531F82", "#D32D63", "#DA6B2A", "#7DC3EE"];

// 그림에 쓰는 글자만 담은 한글 글꼴을 구글 폰트에서 받는다 (실패하면 영문 그림)
async function koreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@800&text=${encodeURIComponent(text)}`)
    ).text();
    const url = css.match(/src: url\((.+?)\) format/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OgImage() {
  const font = await koreanFont(TITLE + TAGLINE + LEAGUES.join("") + "·my-team-calendar.com");
  const ko = !!font;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "70px 80px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#f8fafc",
          fontFamily: ko ? "NotoKR" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 36 }}>
          {COLORS.map((c) => (
            <div key={c} style={{ width: 28, height: 28, borderRadius: 14, background: c }} />
          ))}
        </div>
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>{ko ? TITLE : "My Team Calendar"}</div>
        <div style={{ fontSize: 40, marginTop: 18, color: "#cbd5e1" }}>
          {ko ? TAGLINE : "All your teams' fixtures, results and TV in one calendar"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 44 }}>
          {LEAGUES.map((l) => (
            <div
              key={l}
              style={{ fontSize: 28, padding: "8px 20px", borderRadius: 999, border: "2px solid #475569", color: "#e2e8f0" }}
            >
              {ko ? l : l.replace("K리그", "K League")}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 28, marginTop: "auto", color: "#94a3b8" }}>my-team-calendar.com</div>
      </div>
    ),
    { ...size, ...(font ? { fonts: [{ name: "NotoKR", data: font, weight: 800 as const, style: "normal" as const }] } : {}) },
  );
}
