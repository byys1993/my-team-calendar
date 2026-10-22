// DB 접속에 실패했을 때 주소를 '안전하게' 요약해 보여준다. 비밀번호 자체는 절대 출력하지 않고
// 길이와 흔한 실수(괄호·공백·특수문자)만 알려준다. GitHub Secret 은 저장 후 다시 볼 수 없어서 필요하다.
export function describeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return "DATABASE_URL 이 비어 있습니다.";
  const lines: string[] = [];
  const trimmed = raw.trim();
  if (trimmed !== raw) lines.push("⚠ 주소 앞뒤에 빈칸이나 줄바꿈이 있습니다.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return [...lines, "⚠ 주소 형식이 올바르지 않습니다 (postgresql:// 로 시작해야 함)."].join("\n");
  }
  const password = decodeURIComponent(url.password);
  lines.push(
    `사용자: ${decodeURIComponent(url.username)}`,
    `호스트: ${url.hostname}:${url.port || "5432"}`,
    `비밀번호 길이: ${password.length}자`,
  );
  if (!url.username.includes(".")) lines.push("⚠ 사용자가 'postgres.<프로젝트ID>' 형식이 아닙니다 (Transaction pooler 주소인지 확인).");
  if (!url.hostname.includes("pooler.supabase.com")) lines.push("⚠ pooler 주소가 아닙니다 (Connect → Transaction pooler).");
  if (url.port !== "6543") lines.push("⚠ 포트가 6543 이 아닙니다 (Transaction pooler 는 6543).");
  if (/YOUR-PASSWORD|\[|\]/.test(password)) lines.push("⚠ 비밀번호 자리에 [YOUR-PASSWORD] 나 대괄호가 남아 있습니다.");
  if (/\s/.test(password)) lines.push("⚠ 비밀번호에 빈칸이 있습니다.");
  if (/[^A-Za-z0-9]/.test(password)) lines.push("⚠ 비밀번호에 영문·숫자 외 문자가 있습니다 (주소 안에서 깨질 수 있음).");
  return lines.join("\n");
}
