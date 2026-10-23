// F1 드라이버·컨스트럭터의 한국어 이름 (Jolpica driverId / 팀 이름 기준). 없으면 영문 그대로.
const DRIVER_KO: Record<string, string> = {
  albon: "알본",
  alonso: "알론소",
  antonelli: "안토넬리",
  arvid_lindblad: "린드블라드",
  bearman: "베어먼",
  bortoleto: "보르톨레투",
  bottas: "보타스",
  colapinto: "콜라핀토",
  doohan: "두한",
  gasly: "가슬리",
  hadjar: "아자르",
  hamilton: "해밀턴",
  hulkenberg: "휠켄베르크",
  lawson: "로슨",
  leclerc: "르클레르",
  max_verstappen: "베르스타펜",
  norris: "노리스",
  ocon: "오콘",
  perez: "페레스",
  piastri: "피아스트리",
  russell: "러셀",
  sainz: "사인츠",
  stroll: "스트롤",
  tsunoda: "츠노다",
};

const TEAM_KO: Record<string, string> = {
  "Alpine F1 Team": "알핀",
  "Aston Martin": "애스턴 마틴",
  Audi: "아우디",
  "Cadillac F1 Team": "캐딜락",
  Ferrari: "페라리",
  "Haas F1 Team": "하스",
  McLaren: "맥라렌",
  Mercedes: "메르세데스",
  "RB F1 Team": "레이싱 불스",
  "Red Bull": "레드불",
  Sauber: "자우버",
  Williams: "윌리엄스",
};

export const f1Driver = (driverId: string, english: string, locale: string) =>
  locale === "ko" ? (DRIVER_KO[driverId] ?? english) : english;

export const f1Team = (english: string, locale: string) => (locale === "ko" ? (TEAM_KO[english] ?? english) : english);
