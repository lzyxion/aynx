/**
 * **키 쌍 만들기 · `~/.ssh` 키 파일 목록**의 invoke 얇은 껍데기 —
 * docs/log/2026-09-17-keygen.md.
 *
 * 이 앱은 개인키 파일을 읽지 않고 ssh-agent 에만 서명을 맡긴다(`$lib/copyid` 머리말). 그
 * 원칙에는 구멍이 하나 있었다 — **키가 아직 하나도 없는 사람**이다. 공개키 설치 모달은
 * `ssh-add` 를 안내했지만 더할 키 자체가 없으면 그 안내는 막다른 골목이라, 사용자가 터미널을
 * 따로 열어 `ssh-keygen` 을 쳐야 했다. 이 모듈이 그 한 걸음을 앱 안으로 들인다.
 *
 * 만드는 것은 **여전히 `ssh-keygen`** 이다 (백엔드가 대신 부른다). 프런트로 오는 것은
 * 경로·지문·공개키 한 줄뿐이고, **개인키도 암호구도 이 모듈을 지나 돌아오지 않는다.**
 *
 * ## 암호구는 인자 하나로 지나간다
 *
 * [`generateSshKey`] 는 암호구를 받아 invoke 에 그대로 넘길 뿐 **모듈 상태에 남기지 않고
 * 로그에도 찍지 않는다** (`$lib/copyid` 의 `installPublicKey` 와 같은 규칙). 호출부도 같은
 * 규칙을 진다 — 모달의 입력 칸은 닫히는 순간 `""` 로 지워진다
 * (`$lib/app/keygen.svelte.ts`).
 */
import { invoke } from "./ipc";

/** 키 종류 — 백엔드가 받는 둘뿐이다 (`keygen.rs` 의 `canonical_kind`) */
export type KeyKind = "ed25519" | "rsa";

/** 종류 고르개의 기본값 */
export const DEFAULT_KEY_KIND: KeyKind = "ed25519";

/**
 * 방금 만든 키 쌍 (Rust 계약 — **camelCase**). 암호구가 실릴 자리가 없다 (필드 넷뿐).
 */
export interface GeneratedKey {
  /** `IdentityFile` 칸에 그대로 들어갈 경로 */
  privatePath: string;
  publicPath: string;
  /** `SHA256:…` — 에이전트 키의 지문과 **같은 함수**가 만든 값이라 그대로 비교할 수 있다 */
  fingerprint: string;
  /** 서버의 `authorized_keys` 에 그대로 들어갈 한 줄 */
  publicKeyLine: string;
}

/**
 * `~/.ssh` 에서 찾은 키 파일 하나 (Rust 계약 — **camelCase**).
 *
 * `AgentKey` 와 일부러 같은 알파벳이다 — `fingerprint` 는 같은 기계가 만들고 `kind` 는
 * `AgentKey.keyType` 과 같은 `"ssh-ed25519"` 꼴이다. 설치 고르개가 두 목록을 한 화면에
 * 섞어 놓고 **지문으로 겹치는 것을 걸러 내려면** 그래야 한다.
 */
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

/**
 * 키 쌍 하나를 `~/.ssh/<name>` 에 만든다.
 *
 * 이름·종류 규칙의 단일 진실은 **백엔드**다 (`keygen.rs` 의 `validate_name`·
 * `canonical_kind`) — 폼이 같은 규칙을 한 번 더 적으면 두 곳이 언젠가 어긋나고, 어긋난
 * 쪽이 조용히 이기는 자리가 생긴다. 프런트는 받은 문구를 그대로 보여 준다.
 *
 * `passphrase` 가 빈 문자열이면 **암호구 없는 키**다 (`null` 과 같은 뜻으로 보낸다).
 */
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

/**
 * `~/.ssh` 의 키 파일 목록.
 *
 * **빈 배열은 오류가 아니다** — "아직 만든 키가 없다" 는 사실이고, 그때 화면은 "새 키
 * 만들기…" 를 권한다. `listAgentPublicKeys` 와 달리 실패도 조용히 `[]` 로 삼키는 자리가
 * 있는데(호스트 폼), 그쪽은 이 목록이 **이름 후보를 고르는 데만** 쓰이기 때문이다 — 실패해도
 * 사용자가 할 일은 달라지지 않는다. 설치 고르개는 실패를 알아야 하므로 이 함수는 던진다.
 */
export async function listSshKeyFiles(): Promise<KeyFile[]> {
  try {
    const keys = await invoke<KeyFile[]>("list_ssh_key_files");
    return Array.isArray(keys) ? keys : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

// ---------------------------------------------------------------------------
// 순수 함수 (테스트 대상)
// ---------------------------------------------------------------------------

/** 경로에서 파일 이름만 (`C:\Users\wl\.ssh\id_ed25519` → `id_ed25519`) — **순수 함수** */
export function keyFileName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at < 0 ? path : path.slice(at + 1);
}

/**
 * 별칭을 파일 이름 조각으로 다듬는다 — **순수 함수**.
 *
 * 호스트 별칭에는 `~/.ssh/config` 가 허용하는 것이 전부 들어온다 (`prod/web-01`,
 * `user@bastion:2222`). 그것을 그대로 파일 이름에 이으면 백엔드의 이름 검증이 곧바로
 * 거절한다 — 사용자가 고쳐야 할 이유가 없는 자리라 여기서 먼저 다듬는다.
 */
function slugForName(alias: string): string {
  return alias
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * 키 이름 칸의 **기본값** — **순수 함수**.
 *
 * ```
 * id_ed25519                     아무것도 없을 때
 * id_ed25519_web01               그 이름이 이미 있고 호스트를 알 때
 * id_ed25519_web01_2             그것마저 있을 때
 * id_ed25519_2                   호스트를 모를 때
 * ```
 *
 * **이미 있는 이름을 제안하지 않는다**는 것이 이 함수의 전부다. 백엔드는 덮어쓰기를
 * 거절하므로(개인키를 덮어쓰면 그 키로 붙던 서버가 한 번에 잠긴다), 기본값이 이미 있는
 * 이름이면 사용자는 모달을 열자마자 빨간 줄부터 본다.
 *
 * `existing` 은 파일 **이름**들이다 (`keyFileName` 을 지난 값). 대소문자를 무시하는 이유는
 * Windows 파일 시스템이 그렇기 때문이다 — `ID_ED25519` 가 있으면 `id_ed25519` 도 못 만든다.
 */
export function defaultKeyName(existing: readonly string[], alias?: string | null): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const free = (name: string) => !taken.has(name.toLowerCase());

  const base = "id_ed25519";
  if (free(base)) return base;

  const slug = alias ? slugForName(alias) : "";
  const stem = slug === "" ? base : `${base}_${slug}`;
  if (free(stem)) return stem;

  // 꼬리 번호는 2부터 — `_1` 은 "첫 번째" 로 읽혀서 없는 `_0` 을 찾게 만든다.
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem}_${n}`;
    if (free(candidate)) return candidate;
  }
  return `${stem}_${Date.now()}`;
}
