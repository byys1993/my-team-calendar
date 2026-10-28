"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { track } from "./track";

// 내 팀 구성 공유: 받은 사람이 링크를 열면 같은 팀들이 바로 담긴다 (/?add=팀,팀).
// 휴대폰은 공유 시트(카카오톡 등), 컴퓨터는 링크 복사.
export function ShareButton({ slugs, names }: { slugs: string[]; names: string[] }) {
  const { m, t: fmt } = useI18n();
  const [copied, setCopied] = useState(false);
  if (slugs.length === 0) return null;

  const share = async () => {
    const url = `${window.location.origin}/?add=${slugs.join(",")}`;
    const text = fmt(m.share.text, { teams: names.join(", ") });
    track("share");
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ text, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(m.share.copyPrompt, url);
    }
  };

  return (
    <button type="button" className="ghost cal-sub-btn" onClick={share}>
      🔗 {copied ? m.share.copied : m.share.button}
    </button>
  );
}
