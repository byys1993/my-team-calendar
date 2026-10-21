"use client";

export function DeleteButton() {
  return (
    <button
      type="submit"
      className="danger"
      onClick={(e) => {
        if (!confirm("이 경기를 삭제할까요? 되돌릴 수 없습니다.")) e.preventDefault();
      }}
    >
      이 경기 삭제
    </button>
  );
}
