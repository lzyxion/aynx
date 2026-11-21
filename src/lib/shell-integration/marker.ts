// OSC 133 payload 의 순수 필드 분해 — 출처 태그 `aynx=1` 은 Rust `shell_integration.rs` 스니펫이 찍는 글자와 같다.

import type { MarkerTag } from "./types";

/** `;` 로 필드 분해한다 — `charAt(0)` · `slice(2)` 로 읽으면 `A;aynx=1` 처럼 필드가 늘 때 깨진다. */
export function parseMarker(data: string): { kind: string; fields: string[]; tag: MarkerTag } {
  const fields = data.split(";");
  return { kind: fields[0] ?? "", fields, tag: fields.includes("aynx=1") ? "aynx" : "foreign" };
}
