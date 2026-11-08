/** 권한 없는 아티스트 프로필. 서버 artists.rs와 같은 입력 검사다. */
import { effortOk, modelOk, type RoleCli } from "./config";
import type { Key } from "$lib/i18n/keys";

export interface ArtistProfile {
  id: string;
  name: string;
  icon: string;
  cli: RoleCli;
  kind: "write" | "judge";
  model: string;
  effort: string;
  instructions: string;
}
export type ArtistInput = Omit<ArtistProfile, "id"> & { id?: string };

export function blankArtist(): ArtistInput {
  return { name: "", icon: "claude", cli: "claude", kind: "write", model: "", effort: "", instructions: "" };
}

export function artistFormError(form: ArtistInput, original?: ArtistProfile | null): Key | null {
  if (!form.name.trim() || [...form.name.trim()].length > 40 || /[\x00-\x1f\x7f-\x9f]/.test(form.name)) return "orch.artists.error.name";
  if (new TextEncoder().encode(form.instructions).length > 4096 || form.instructions.includes("\0")) return "orch.artists.error.instructions";
  if (original && original.kind !== form.kind) return "orch.artists.error.kind";
  if (!modelOk(form.model.trim()) || !effortOk(form.cli, form.effort)) return "orch.artists.error.model";
  return null;
}

/** 저장할 것이 있는가 — 새 아티스트는 늘 참, 기존은 저장 때와 같은 정규화(이름 · 모델 공백 정리 · 지침 줄 끝 LF)로 비교한다.
 *  textarea 는 값을 LF 로 돌려주므로 CRLF 로 저장된 지침을 고르기만 해도 달라 보이지 않게 한다. */
export function artistDirty(form: ArtistInput, original: ArtistProfile | null): boolean {
  if (!original) return true;
  const norm = (a: ArtistInput) => [a.name.trim(), a.icon, a.cli, a.kind, a.model.trim(), a.effort, a.instructions.replace(/\r\n?/g, "\n")];
  const [x, y] = [norm(form), norm(original)];
  return x.some((v, i) => v !== y[i]);
}

/** 삭제 거절의 구조화된 runIds만 읽는다. 본문을 코드로 쓰지 않는다. */
export function artistInUseRunIds(error: unknown): string[] | null {
  const text = String(error);
  const start = text.indexOf("[artist-in-use]");
  if (start < 0) return null;
  try {
    const value = JSON.parse(text.slice(start + "[artist-in-use]".length).trim());
    return Array.isArray(value.runIds) ? value.runIds.filter((v: unknown): v is string => typeof v === "string") : [];
  } catch { return []; }
}
