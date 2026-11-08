// OSC 133 payload 의 **순수 필드 분해**(`parseMarker`) — 출처 태그(`aynx=1`)까지. 상태 기계는 `osc133.ts`.

import type { MarkerTag } from "./types";

/**
 * OSC 133 payload 를 **`;` 로 필드 분해**한다 — 순수 함수.
 *
 * 예전에는 `data.charAt(0)` 과 `data.slice(2)` 로 읽었다. 그건 `A`·`D;0` 에서 **우연히**
 * 맞을 뿐이고, `A;aynx=1` 처럼 필드가 늘면 곧바로 깨진다 (설계 §5 ②).
 *
 * | payload | kind | fields[1] | tag |
 * | --- | --- | --- | --- |
 * | `A;aynx=1` | `A` | `aynx=1` | `aynx` |
 * | `D;1;aynx=1` | `D` | `1` | `aynx` |
 * | `D;1` | `D` | `1` | `foreign` |
 * | `A` | `A` | `undefined` | `foreign` |
 */
export function parseMarker(data: string): { kind: string; fields: string[]; tag: MarkerTag } {
  const fields = data.split(";");
  return { kind: fields[0] ?? "", fields, tag: fields.includes("aynx=1") ? "aynx" : "foreign" };
}
