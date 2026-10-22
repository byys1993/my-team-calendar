"use client";

import { useCallback, useEffect, useState } from "react";
import { PALETTE } from "@/lib/palette";
import { MAX_TEAMS } from "@/lib/schedule";

// 팀별 색상: 새 팀에는 아직 안 쓴 색을 순서대로 배정하고, 사용자가 색을 직접 바꿀 수 있다
export { PALETTE } from "@/lib/palette";

export interface Selection {
  slug: string;
  color: number; // PALETTE index
  enabled: boolean;
}

const STORAGE_KEY = "mtc.selection.v1";

function read(validSlugs: Set<string>): Selection[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is Selection => typeof s?.slug === "string" && validSlugs.has(s.slug))
      .slice(0, MAX_TEAMS)
      .map((s) => ({ slug: s.slug, color: Number(s.color) % PALETTE.length || 0, enabled: s.enabled !== false }));
  } catch {
    return [];
  }
}

function write(list: Selection[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 사생활 보호 모드 등에서는 저장 없이 동작
  }
}

export function useSelection(validSlugs: string[]) {
  const [list, setList] = useState<Selection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const key = validSlugs.join(",");

  useEffect(() => {
    setList(read(new Set(key.split(","))));
    setLoaded(true);
  }, [key]);

  const update = useCallback((fn: (prev: Selection[]) => Selection[]) => {
    setList((prev) => {
      const next = fn(prev);
      write(next);
      return next;
    });
  }, []);

  const add = useCallback(
    (slug: string) =>
      update((prev) => {
        if (prev.length >= MAX_TEAMS || prev.some((s) => s.slug === slug)) return prev;
        const used = new Set(prev.map((s) => s.color));
        const color = PALETTE.findIndex((_, i) => !used.has(i));
        return [...prev, { slug, color: color < 0 ? 0 : color, enabled: true }];
      }),
    [update],
  );
  const remove = useCallback((slug: string) => update((prev) => prev.filter((s) => s.slug !== slug)), [update]);
  const toggle = useCallback(
    (slug: string) => update((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled: !s.enabled } : s))),
    [update],
  );

  // 계정에 저장된 목록으로 통째로 바꾼다 (로그인 직후). 지금 목록에 없는 팀은 버린다.
  const replace = useCallback(
    (items: Selection[]) => {
      const valid = new Set(key.split(","));
      update(() => items.filter((s) => valid.has(s.slug)).slice(0, MAX_TEAMS));
    },
    [update, key],
  );

  const clear = useCallback(() => update(() => []), [update]);
  const setColor = useCallback(
    (slug: string, color: number) => update((prev) => prev.map((s) => (s.slug === slug ? { ...s, color } : s))),
    [update],
  );

  return { list, loaded, add, remove, toggle, replace, clear, setColor };
}
