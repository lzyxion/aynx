/**
 * 공개키 설치(`ssh-copy-id` 상당)의 invoke 껍데기. 거부 페이로드가 `open_ssh_session` 과 같은 태그 유니온이라 [`SessionOpenError`]
 * 하나만 던진다 — 호출부가 로그인과 같은 TOFU · 비밀번호 모달을 재사용한다. 자체 오류 타입을 만들면 그 재사용이 끊긴다.
 */
import { invoke } from "./ipc";
import { SessionOpenError, parseSessionError, type Tr } from "$lib/session";
import type { KeyFile } from "$lib/keygen";

/** OpenSSH 인증서 항목은 백엔드가 뺀다 — 접속 경로가 인증서를 쓰지 않아 보이면 "설치했는데 왜 안 되지" 를 겪는다 */
export interface AgentKey {
  /** 설치할 때 되돌려 줄 열쇠는 이 값이다(공개키 본문이 아니다) */
  fingerprint: string;
  keyType: string;
  comment: string;
  publicLine: string;
}

/** 비밀번호가 실릴 자리가 없다. `keyAuthOk: false` 는 오류가 아니다 — 파일은 들어갔고 남은 것은 서버 설정이다(`message` 가 말한다) */
export interface InstallReport {
  added: boolean;
  alreadyPresent: boolean;
  /** 설치 뒤 연결을 끊고 키만으로 다시 붙어 본 결과 */
  keyAuthOk: boolean;
  message: string;
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

/** 빈 배열 = 에이전트는 살아 있고 키가 0개. 에이전트가 꺼져 있으면 던진다 */
export async function listAgentPublicKeys(): Promise<AgentKey[]> {
  try {
    const keys = await invoke<AgentKey[]>("list_agent_public_keys");
    return Array.isArray(keys) ? keys : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/** 실패를 삼킨다 — 꺼져 있음 · 키 없음 둘 다 답이 "아직 아니다" 다 */
export async function isKeyInAgent(fingerprint: string): Promise<boolean> {
  try {
    return (await invoke<boolean>("agent_has_key", { fingerprint })) === true;
  } catch {
    return false;
  }
}

/**
 * `password` 는 매 호출에 필수다 — 백엔드는 저장하지 않아 TOFU 재시도에서도 다시 실어야 한다. 모듈 상태 · 로그에 남기지 않는다.
 */
export async function installPublicKey(
  alias: string,
  password: string,
  fingerprint: string,
  acceptNewHostKey: boolean,
  tr: Tr,
): Promise<InstallReport> {
  try {
    return await invoke<InstallReport>("install_public_key", {
      alias,
      password,
      fingerprint,
      acceptNewHostKey,
    });
  } catch (e) {
    throw new SessionOpenError(parseSessionError(e, tr));
  }
}

/**
 * `~/.ssh` 키 파일용 — 에이전트에 없는 키라 지문 대신 줄 자체를 싣는다(백엔드가 파싱해 다시 조립한다).
 * 서명해 줄 에이전트가 없으면 접속 확인을 건너뛴다 — 그때 `keyAuthOk` 가 거짓이어도 실패가 아니다.
 */
export async function installPublicKeyLine(
  alias: string,
  password: string,
  publicKeyLine: string,
  acceptNewHostKey: boolean,
  tr: Tr,
): Promise<InstallReport> {
  try {
    return await invoke<InstallReport>("install_public_key_line", {
      alias,
      password,
      publicKeyLine,
      acceptNewHostKey,
    });
  } catch (e) {
    throw new SessionOpenError(parseSessionError(e, tr));
  }
}

export function agentKeyLabel(key: AgentKey): string {
  const comment = key.comment.trim();
  return comment === "" ? key.keyType : `${key.keyType} · ${comment}`;
}

/** 앞자리가 종류가 아니라 파일 이름이다 — 파일 목록에서 키를 가르는 단서는 이름이다(둘 다 ed25519 일 수 있다) */
export function keyFileLabel(key: KeyFile): string {
  const at = Math.max(key.privatePath.lastIndexOf("/"), key.privatePath.lastIndexOf("\\"));
  const name = at < 0 ? key.privatePath : key.privatePath.slice(at + 1);
  const comment = key.comment.trim();
  return comment === "" ? name : `${name} · ${comment}`;
}

export function shortFingerprint(fingerprint: string): string {
  const body = fingerprint.startsWith("SHA256:") ? fingerprint.slice(7) : fingerprint;
  return body.length <= 12 ? body : `${body.slice(0, 12)}…`;
}
