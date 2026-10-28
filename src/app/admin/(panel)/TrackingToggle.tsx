"use client";

import { useEffect, useState } from "react";
import { NO_TRACK_KEY, trackingOff } from "@/components/track";

// 운영자 본인의 접속(테스트 포함)이 방문자 수·이용 흐름에 섞이지 않도록 이 브라우저만 집계에서 뺀다.
// 브라우저(기기·시크릿 창)마다 따로 저장되므로 쓰는 곳마다 한 번씩 누른다.
export function TrackingToggle() {
  const [off, setOff] = useState<boolean | null>(null);
  useEffect(() => setOff(trackingOff()), []);
  if (off === null) return null;
  const toggle = () => {
    try {
      if (off) localStorage.removeItem(NO_TRACK_KEY);
      else localStorage.setItem(NO_TRACK_KEY, "1");
      setOff(!off);
    } catch {
      // 저장소를 못 쓰는 브라우저는 바꿀 수 없다
    }
  };
  return (
    <p>
      {off ? "이 브라우저는 집계에서 빠져 있습니다. " : "이 브라우저의 방문도 지금 집계되고 있습니다. "}
      <button type="button" className="ghost" onClick={toggle}>
        {off ? "다시 집계하기" : "이 브라우저는 집계에서 빼기"}
      </button>
    </p>
  );
}
