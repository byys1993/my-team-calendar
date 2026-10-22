"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { MatchStatus } from "@/collector/types";
import { adminEnabled, endSession, requireAdmin, startSession } from "@/lib/admin/auth";
import { checkPassword } from "@/lib/admin/session";
import { hitRateLimit } from "@/lib/auth/core";
import { getDb } from "@/lib/db";
import {
  createManualMatch,
  deleteManualMatch,
  manualKeyExists,
  updateManualMatch,
  updateTeamName,
} from "@/lib/manual/admin";
import { decodeCsv } from "@/lib/manual/csv";
import {
  loadManualCompetitions,
  normalizeDate,
  normalizeTime,
  parseImport,
  saveManualMatches,
  type ImportError,
  type ManualRow,
} from "@/lib/manual/import";

const ADMIN_LOGIN_LIMIT = 10;

export async function login(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  if (!adminEnabled()) return { error: "ADMIN_PASSWORD 환경변수가 설정되지 않았습니다." };
  // 비밀번호 무작위 대입을 막기 위해 IP 당 시간당 10번까지만 시도할 수 있다
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await hitRateLimit(getDb(), `admin-login:${ip}`, ADMIN_LOGIN_LIMIT, 3600))) {
    return { error: "시도 횟수가 너무 많습니다. 1시간 뒤에 다시 시도해 주세요." };
  }
  const ok = checkPassword(String(form.get("password") ?? ""), process.env.ADMIN_PASSWORD!);
  if (!ok) {
    // 무작위 대입을 늦춘다
    await new Promise((r) => setTimeout(r, 800));
    return { error: "비밀번호가 맞지 않습니다." };
  }
  await startSession();
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/admin/login");
}

export interface UploadState {
  done?: "checked" | "saved";
  rows?: number;
  errors?: ImportError[];
  summary?: string[];
}

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// '검사'는 저장하지 않고 오류만 보여주고, '저장'은 오류가 하나도 없을 때만 전부 저장한다.
export async function uploadCsv(_prev: UploadState, form: FormData): Promise<UploadState> {
  await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: [{ line: 0, message: "CSV 파일을 선택해 주세요." }] };
  if (file.size > MAX_UPLOAD_BYTES) return { errors: [{ line: 0, message: "파일이 너무 큽니다 (최대 2MB)." }] };

  const db = getDb();
  const comps = await loadManualCompetitions(db);
  const parsed = parseImport(decodeCsv(new Uint8Array(await file.arrayBuffer())), comps);
  if (parsed.errors.length) return { rows: parsed.rows, errors: parsed.errors };

  const names = new Map(comps.map((c) => [c.id, c.slug.toUpperCase()]));
  if (form.get("mode") !== "save") {
    return {
      done: "checked",
      rows: parsed.rows,
      summary: [...parsed.byCompetition].map(([id, list]) => `${names.get(id)} ${list.length}경기`),
    };
  }
  const summary: string[] = [];
  for (const [id, list] of parsed.byCompetition) {
    const r = await saveManualMatches(db, id, list);
    summary.push(`${names.get(id)}: 신규 ${r.inserted} · 수정 ${r.updated} · 변경 없음 ${list.length - r.inserted - r.updated - r.skipped}`);
  }
  revalidatePath("/");
  revalidateTag("catalog");
  return { done: "saved", rows: parsed.rows, summary };
}

const STATUSES: MatchStatus[] = ["scheduled", "time_tbd", "conditional", "draw_pending", "postponed", "cancelled"];

function rowFromForm(form: FormData, league: string, gameKey: string): ManualRow | string {
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  const date = normalizeDate(String(form.get("date") ?? ""));
  if (!date) return "날짜를 확인해 주세요.";
  const time = normalizeTime(String(form.get("time") ?? ""));
  if (time === undefined) return "시간은 18:30 처럼 적거나 비워 두세요.";
  const status = String(form.get("status")) as MatchStatus;
  if (!STATUSES.includes(status)) return "상태를 골라 주세요.";
  const home = text("home");
  const away = text("away");
  if (!home && !away) return "홈·원정 중 적어도 한 팀은 골라 주세요.";
  if (home && home === away) return "홈과 원정이 같은 팀입니다.";
  return {
    gameKey,
    league,
    date,
    time,
    home,
    away,
    status,
    round: text("round"),
    homePlaceholder: home ? null : text("home_placeholder"),
    awayPlaceholder: away ? null : text("away_placeholder"),
    venue: text("venue"),
  };
}

export async function saveMatch(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const db = getDb();
  const id = String(form.get("id") ?? "");
  const league = String(form.get("league") ?? "");
  const gameKey = String(form.get("game_key") ?? "").trim();
  if (!/^[\w가-힣-]+$/.test(gameKey)) return { error: "경기 키에는 글자·숫자·-·_ 만 쓸 수 있습니다." };
  const row = rowFromForm(form, league, gameKey);
  if (typeof row === "string") return { error: row };
  try {
    if (id) {
      await updateManualMatch(db, id, row);
    } else {
      if (await manualKeyExists(db, league, gameKey)) return { error: "이미 있는 경기 키입니다. 다른 이름을 써 주세요." };
      await createManualMatch(db, row);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/");
  revalidateTag("catalog");
  redirect(`/admin/matches?league=${league}&month=${row.date.slice(0, 7)}&saved=1`);
}

export async function removeMatch(form: FormData): Promise<void> {
  await requireAdmin();
  const league = String(form.get("league") ?? "");
  const month = String(form.get("month") ?? "");
  await deleteManualMatch(getDb(), String(form.get("id") ?? ""));
  revalidatePath("/");
  revalidateTag("catalog");
  redirect(`/admin/matches?league=${league}&month=${month}&deleted=1`);
}

export async function saveTeam(form: FormData): Promise<void> {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "");
  const nameKo = String(form.get("name_ko") ?? "").trim();
  if (slug && nameKo) {
    await updateTeamName(getDb(), slug, nameKo, String(form.get("short_ko") ?? "").trim() || null);
    revalidatePath("/");
    revalidateTag("catalog");
  }
  redirect("/admin/teams");
}
