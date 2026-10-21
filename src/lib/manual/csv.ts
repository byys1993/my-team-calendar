// 엑셀에서 저장한 CSV 를 읽는다. UTF-8(BOM 포함)과 한글 윈도우 엑셀의 기본 형식(CP949/EUC-KR)을 모두 받는다.
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

// RFC 4180 CSV (따옴표 안의 쉼표·줄바꿈, "" 이스케이프). 각 행에 원래 줄 번호를 붙인다.
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ line: rowLine, cells });
      cells = [];
      cell = "";
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length) {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
  }
  // 빈 줄과 # 으로 시작하는 설명 줄은 건너뛴다
  return rows.filter((r) => r.cells.some((c) => c.trim() !== "") && !r.cells[0].trim().startsWith("#"));
}
