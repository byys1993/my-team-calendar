"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";
import { PALETTE, PICKER_ORDER } from "@/lib/palette";

interface Props {
  teamName: string;
  current: number;
  onPick(color: number): void;
  onClose(): void;
}

// 팀 색 고르기: 색상표에서 하나를 누르면 바로 바뀌고 창이 닫힌다
export function ColorPicker({ teamName, current, onPick, onClose }: Props) {
  const { m, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="picker color-dialog" onClose={onClose} aria-labelledby="color-title">
      <div className="picker-head">
        <h2 id="color-title">{t(m.app.colorTitle, { team: teamName })}</h2>
        <button type="button" className="icon-btn" onClick={() => dialog.current?.close()} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="swatches" role="radiogroup" aria-label={m.app.changeColor}>
        {PICKER_ORDER.map((i) => {
          const color = PALETTE[i];
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === current}
              aria-label={color}
              className={i === current ? "swatch on" : "swatch"}
              style={{ background: color }}
              onClick={() => {
                onPick(i);
                dialog.current?.close();
              }}
            />
          );
        })}
      </div>
    </dialog>
  );
}
