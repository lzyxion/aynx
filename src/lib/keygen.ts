/**
 * 키 쌍 만들기 · `~/.ssh` 키 파일 목록의 invoke 껍데기 (docs/log/2026-09-17-keygen.md).
 * 개인키도 암호구도 프런트로 돌아오지 않는다 — 암호구는 invoke 에 넘길 뿐 모듈 상태 · 로그에 남기지 않는다.
 */
import { invoke } from "./ipc";

/** 백엔드가 받는 둘뿐이다(`keygen.rs` 의 `canonical_kind`) */
export type KeyKind = "ed25519" | "rsa";

export const DEFAULT_KEY_KIND: KeyKind = "ed25519";

export interface GeneratedKey {
  privatePath: string;
  publicPath: string;
  /** 에이전트 키의 지문과 같은 함수가 만든 값이라 그대로 비교할 수 있다 */
  fingerprint: string;
  publicKeyLine: string;
}

/** `fingerprint` · `kind` 는 `AgentKey` 와 같은 꼴이다 — 설치 고르개가 두 목록을 지문으로 겹치지 않게 거른다 */
export interface KeyFile {
  privatePath: string;
  publicPath: string;
  fingerprint: string;
  comment: string;
  /** `"ssh-ed25519"` · `"ssh-rsa"` … */
  kind: string;
  publicLine: string;
}

function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 이름 · 종류 규칙은 백엔드(`keygen.rs`)에만 둔다 — 폼에 다시 적으면 두 곳이 어긋난다 */
export async function generateSshKey(
  name: string,
  kind: KeyKind,
  passphrase: string,
  comment: string,
): Promise<GeneratedKey> {
  try {
    return await invoke<GeneratedKey>("generate_ssh_key", {
      name,
      kind,
      passphrase: passphrase === "" ? null : passphrase,
      comment,
    });
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** 설치 고르개는 실패를 알아야 해서 던진다 */
export async function listSshKeyFiles(): Promise<KeyFile[]> {
  try {
    const keys = await invoke<KeyFile[]>("list_ssh_key_files");
    return Array.isArray(keys) ? keys : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

export function keyFileName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at < 0 ? path : path.slice(at + 1);
}

/** 별칭(`prod/web-01` · `user@bastion:2222`)을 그대로 이으면 백엔드의 이름 검증이 거절한다 */
function slugForName(alias: string): string {
  return alias
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * 키 이름 칸의 기본값 — 이미 있는 이름을 제안하지 않는다(백엔드는 덮어쓰기를 거절한다).
 * `existing` 은 파일 이름들이다. 대소문자를 무시한다 — Windows 파일 시스템이 그렇다.
 */
export function defaultKeyName(existing: readonly string[], alias?: string | null): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const free = (name: string) => !taken.has(name.toLowerCase());

  const base = "id_ed25519";
  if (free(base)) return base;

  const slug = alias ? slugForName(alias) : "";
  const stem = slug === "" ? base : `${base}_${slug}`;
  if (free(stem)) return stem;

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem}_${n}`;
    if (free(candidate)) return candidate;
  }
  return `${stem}_${Date.now()}`;
}
