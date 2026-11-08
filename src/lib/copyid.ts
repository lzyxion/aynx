/**
 * **공개키 설치**(`ssh-copy-id` 상당)의 invoke 얇은 껍데기 — docs/log/2026-09-03-copy-id.md.
 *
 * `~/.ssh/authorized_keys` 에 우리 키가 아직 없는 서버는 접속할 때마다 비밀번호를 받는다.
 * 이 두 명령이 그 "매번" 을 **딱 한 번**으로 끝낸다: 비밀번호로 한 번 붙어 공개키 한 줄을
 * 심고, 그 다음부터는 키(에이전트 또는 `~/.ssh` 키 파일 — 2026-09-19 부터)로 붙는다.
 *
 * ## 오류 계약이 로그인과 **같다**
 *
 * `install_public_key` 의 거부 페이로드는 `open_ssh_session` 과 **완전히 같은 태그 유니온**
 * (`host_key_unknown`·`host_key_changed`·`password_required`·`auth`·`other`)이다. 그래서 이
 * 모듈은 파서를 새로 만들지 않고 [`parseSessionError`] 를 그대로 쓰고, 던지는 것도
 * [`SessionOpenError`] 하나다 — 호출부(`+page` 의 `installKeyFor`)가 로그인 흐름과 **똑같이**
 * `kind` 로 분기해 **같은 TOFU 모달·같은 비밀번호 모달**을 재사용할 수 있게 하려는 것이다.
 * 여기서 자체 오류 타입을 만들면 그 재사용이 곧바로 끊긴다.
 */
import { invoke } from "./ipc";
import { SessionOpenError, parseSessionError, type Tr } from "$lib/session";
import type { KeyFile } from "$lib/keygen";

/**
 * ssh-agent 가 들고 있는 공개키 하나 (Rust 계약 — **camelCase**).
 *
 * OpenSSH 인증서 항목은 백엔드가 목록에서 빼고 내려준다 (접속 경로가 아직 인증서를 쓰지
 * 않으므로, 보여 주면 "설치했는데 왜 안 되지" 를 겪는다).
 */
export interface AgentKey {
  /** `SHA256:…` — **설치할 때 되돌려 줄 열쇠**가 이 값이다 (공개키 본문이 아니다) */
  fingerprint: string;
  /** `"ssh-ed25519"`, `"ssh-rsa"` … */
  keyType: string;
  /** 키 주석 (`you@box`). 비어 있을 수 있다 */
  comment: string;
  /** 서버의 `authorized_keys` 에 그대로 들어갈 한 줄 — 미리보기로 보여 줄 수 있다 */
  publicLine: string;
}

/**
 * 설치 결과 (Rust 계약 — **camelCase**). 키가 정확히 넷뿐이다 (비밀번호가 실릴 자리가 없다).
 *
 * `added` 와 `alreadyPresent` 는 **서로 배타적**이다. `keyAuthOk: false` 는 **오류가 아니다** —
 * 파일은 정말로 들어갔고 (`added` 는 참이다) 남은 것은 서버 설정(`PubkeyAuthentication no`
 * 등)이며, 그 힌트가 이미 [`message`] 에 한국어로 실려 있다.
 */
export interface InstallReport {
  added: boolean;
  alreadyPresent: boolean;
  /** 설치 뒤 **연결을 끊고 에이전트 키만으로** 다시 붙어 본 결과 */
  keyAuthOk: boolean;
  /** 그대로 띄우면 되는 한국어 한 줄 */
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

/**
 * ssh-agent 의 공개키 목록.
 *
 * **빈 배열은 오류가 아니다** — 에이전트는 살아 있는데 키가 0개라는 뜻이다. 실패(에이전트가 꺼져 있다)는 던진다 —
 * 지금 유일한 호출부(공개키 설치)는 둘을 같이 "에이전트 무리 없음" 으로 다룬다(에이전트는 선택이다 — 2026-11-03).
 */
export async function listAgentPublicKeys(): Promise<AgentKey[]> {
  try {
    const keys = await invoke<AgentKey[]>("list_agent_public_keys");
    return Array.isArray(keys) ? keys : [];
  } catch (e) {
    throw new Error(describeError(e));
  }
}

/**
 * **이 지문의 키가 지금 ssh-agent 에 들어 있는가** — "에이전트에 넣기" 가 끝났는지 지켜보는
 * 눈 (docs/log/2026-09-17-keygen.md).
 *
 * [`listAgentPublicKeys`] 와 달리 **실패를 삼킨다.** 저쪽은 "꺼져 있다" 와 "키가 0개" 의
 * 처방이 달라 구분해야 하지만, 이 물음의 답은 둘 다 **"아직 아니다"** 이고 화면이 할 일도
 * 같다(계속 기다린다). 백엔드도 같은 근거로 `bool` 하나만 돌려준다.
 */
export async function isKeyInAgent(fingerprint: string): Promise<boolean> {
  try {
    return (await invoke<boolean>("agent_has_key", { fingerprint })) === true;
  } catch {
    return false;
  }
}

/**
 * 공개키 한 줄을 서버의 `~/.ssh/authorized_keys` 에 **멱등하게** 심는다.
 *
 * `password` 는 **매 호출에 필수**다 — 백엔드는 아무것도 저장하지 않으므로 TOFU 재시도
 * (`acceptNewHostKey: true`)에서도 같은 값을 다시 실어 보내야 한다. 이 함수는 인자를 받아
 * invoke 에 그대로 넘길 뿐 **모듈 상태에 남기지 않고 로그에도 찍지 않는다** (오류 문구는
 * 전부 Rust 가 만든 것이라 비밀번호가 실릴 자리가 없다).
 *
 * 실패는 언제나 [`SessionOpenError`] 다 — 로그인과 같은 `kind` 로 분기하라는 뜻이다
 * (이 파일 머리말 참고).
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
 * 공개키 **한 줄**을 그대로 실어 설치한다 — `~/.ssh` 의 키 파일용
 * (docs/log/2026-09-17-keygen.md).
 *
 * [`installPublicKey`] 와 **오류 계약이 같다** (백엔드도 같은 몸통을 지난다) — 호출부는
 * 같은 `kind` 분기로 같은 TOFU·비밀번호 모달을 쓴다. 다른 점은 둘뿐이다.
 *
 * 1. 열쇠가 지문이 아니라 **줄 자체**다. 에이전트에 없는 키라 "지문으로 다시 찾아 달라" 고
 *    할 상대가 없다. (백엔드가 그 줄을 파싱해 다시 조립하므로, 파일의 이상한 글자가 서버로
 *    그대로 건너가지 않는다.)
 * 2. 설치 뒤 **접속 확인을 건너뛸 수 있다.** 서명은 ssh-agent 가 하는데 파일에만 있는 키는
 *    서명해 줄 상대가 없다. 그때 `keyAuthOk` 는 거짓이지만 실패가 아니고, `message` 가
 *    "ssh-add 로 넣으세요" 라고 말한다 (서버 설정을 의심하는 문구가 뜨지 않는다).
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

/**
 * 키 선택 모달의 한 줄 라벨 — **순수 함수**. `"ssh-ed25519 · you@box"` 처럼 잇는다.
 * 주석이 비어 있으면 타입만 남긴다 (뒤에 구분자만 덩그러니 남지 않게).
 */
export function agentKeyLabel(key: AgentKey): string {
  const comment = key.comment.trim();
  return comment === "" ? key.keyType : `${key.keyType} · ${comment}`;
}

/**
 * 파일 키의 한 줄 라벨 — **순수 함수**. `"id_ed25519 · you@box"`.
 *
 * 앞자리가 종류가 아니라 **파일 이름**인 것이 [`agentKeyLabel`] 과 다른 유일한 점이고,
 * 그것이 이 함수가 따로 있는 이유다 — 파일 목록에서 사람이 키를 가르는 단서는 알고리즘이
 * 아니라 이름이다 (`id_ed25519_web01` 과 `id_ed25519_home` 은 둘 다 ed25519 다).
 * 종류는 지문 옆의 곁말로 빠진다.
 */
export function keyFileLabel(key: KeyFile): string {
  const at = Math.max(key.privatePath.lastIndexOf("/"), key.privatePath.lastIndexOf("\\"));
  const name = at < 0 ? key.privatePath : key.privatePath.slice(at + 1);
  const comment = key.comment.trim();
  return comment === "" ? name : `${name} · ${comment}`;
}

/** 지문 앞부분만 (`SHA256:` 접두사를 떼고 12자) — 목록에서 키를 눈으로 가르는 용도 */
export function shortFingerprint(fingerprint: string): string {
  const body = fingerprint.startsWith("SHA256:") ? fingerprint.slice(7) : fingerprint;
  return body.length <= 12 ? body : `${body.slice(0, 12)}…`;
}
