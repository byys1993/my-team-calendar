// F1 에서 고를 수 있는 팀·드라이버 (시드 data/seed/f1.json 의 팀과 slug 가 같아야 한다. 시즌이 바뀌면 둘 다 고친다)
// team: Jolpica 결과의 컨스트럭터 이름(팀명이 바뀌면 옛 이름도), driver: Jolpica driverId
import type { Podium } from "@/collector/types";

// 모든 F1 세션이 묶여 저장되는 시리즈 팀. 새로 고를 수는 없다 (이미 고른 사람은 그대로 받고, 팀 고르기 창에서 뺄 수만 있다)
export const F1_SERIES = "f1";

export interface F1Pick {
  kind: "team" | "driver";
  match: string[];
}

export const F1_PICKS: Record<string, F1Pick> = {
  "f1-mercedes": { kind: "team", match: ["Mercedes"] },
  "f1-ferrari": { kind: "team", match: ["Ferrari"] },
  "f1-red-bull": { kind: "team", match: ["Red Bull"] },
  "f1-mclaren": { kind: "team", match: ["McLaren"] },
  "f1-racing-bulls": { kind: "team", match: ["RB F1 Team"] },
  "f1-alpine": { kind: "team", match: ["Alpine F1 Team"] },
  "f1-haas": { kind: "team", match: ["Haas F1 Team"] },
  "f1-audi": { kind: "team", match: ["Audi", "Sauber"] },
  "f1-williams": { kind: "team", match: ["Williams"] },
  "f1-aston-martin": { kind: "team", match: ["Aston Martin"] },
  "f1-cadillac": { kind: "team", match: ["Cadillac F1 Team"] },
  "f1-antonelli": { kind: "driver", match: ["antonelli"] },
  "f1-russell": { kind: "driver", match: ["russell"] },
  "f1-hamilton": { kind: "driver", match: ["hamilton"] },
  "f1-leclerc": { kind: "driver", match: ["leclerc"] },
  "f1-verstappen": { kind: "driver", match: ["max_verstappen"] },
  "f1-hadjar": { kind: "driver", match: ["hadjar"] },
  "f1-norris": { kind: "driver", match: ["norris"] },
  "f1-piastri": { kind: "driver", match: ["piastri"] },
  "f1-lawson": { kind: "driver", match: ["lawson"] },
  "f1-lindblad": { kind: "driver", match: ["arvid_lindblad"] },
  "f1-tsunoda": { kind: "driver", match: ["tsunoda"] },
  "f1-gasly": { kind: "driver", match: ["gasly"] },
  "f1-colapinto": { kind: "driver", match: ["colapinto"] },
  "f1-ocon": { kind: "driver", match: ["ocon"] },
  "f1-bearman": { kind: "driver", match: ["bearman"] },
  "f1-hulkenberg": { kind: "driver", match: ["hulkenberg"] },
  "f1-bortoleto": { kind: "driver", match: ["bortoleto"] },
  "f1-albon": { kind: "driver", match: ["albon"] },
  "f1-sainz": { kind: "driver", match: ["sainz"] },
  "f1-alonso": { kind: "driver", match: ["alonso"] },
  "f1-stroll": { kind: "driver", match: ["stroll"] },
  "f1-perez": { kind: "driver", match: ["perez"] },
  "f1-bottas": { kind: "driver", match: ["bottas"] },
};

export const f1Pick = (slug: string): F1Pick | null => (Object.hasOwn(F1_PICKS, slug) ? F1_PICKS[slug] : null);

// 전체 순위에서 이 팀(두 드라이버)·드라이버의 줄
export function pickResults(results: Podium[] | null | undefined, slug: string): Podium[] {
  const pick = f1Pick(slug);
  if (!pick || !results) return [];
  return results.filter((r) => pick.match.includes(pick.kind === "team" ? r.team : r.driverId));
}
