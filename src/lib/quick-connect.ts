/**
 * 빠른 접속 문법: `[ssh] [-p N] [user@]host[:port]`(`-p` 는 대상 앞 · 뒤 어디든 · IPv6 은 `[::1]`). Rust `ssh/params.rs` 가 이 파일을
 * 문법 · 거절 규칙의 단일 진실로 본다.
 * 문법 밖은 전부 거절한다 — 결과가 곧 SSH 접속 대상이 되고 `known_hosts` 에 실린다. 반쯤 알아듣고 나머지를 무시하지 않는다
 * (`-J bastion` 을 조용히 버리면 점프를 거치지 않고 대상에 직접 붙는다).
 */

/** 빠른 접속 한 건 — `PaneSpec.adhoc` 과 Rust `AdhocTarget` 이 **같은 모양**으로 받는다 */
export interface QuickConnectTarget {
  /** 적지 않았으면 없다 (백엔드가 OS 사용자 이름으로 채운다) */
  user?: string;
  host: string;
  /** 적지 않았으면 없다 (백엔드가 22 로 채운다) */
  port?: number;
}

/** 사용자 이름에 허용하는 글자 — OpenSSH 가 실제로 받는 범위보다 좁게 잡는다 */
const USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;

const LABEL_RE = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

const IPV6_RE = /^[0-9A-Fa-f:.]{2,45}$/;

function parsePort(text: string): number | null {
  if (!/^[0-9]{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 65535 ? n : null;
}

function validHost(host: string, bracketed: boolean): boolean {
  if (bracketed) return IPV6_RE.test(host) && host.includes(":");
  if (host.length === 0 || host.length > 253) return false;
  // 대괄호 없는 IPv6 은 받지 않는다 — 콜론이 포트와 구분되지 않는다(`[::1]:22` 로 적는다).
  return host.split(".").every((label) => LABEL_RE.test(label));
}

/** `@` 는 마지막 것에서 자른다(OpenSSH 와 같다). 포트는 대괄호 밖의 콜론에서만 읽는다 */
function parseTargetWord(word: string): QuickConnectTarget | null {
  if (word === "") return null;

  let user: string | undefined;
  let rest = word;
  const at = word.lastIndexOf("@");
  if (at >= 0) {
    const name = word.slice(0, at);
    if (!USER_RE.test(name)) return null;
    user = name;
    rest = word.slice(at + 1);
  }

  let host: string;
  // `null` = 콜론이 없었다. `""` = 콜론은 있는데 뒤가 비었다 (= 거절).
  let portText: string | null = null;
  let bracketed = false;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close < 0) return null;
    bracketed = true;
    host = rest.slice(1, close);
    const tail = rest.slice(close + 1);
    if (tail !== "") {
      if (!tail.startsWith(":")) return null;
      portText = tail.slice(1);
    }
  } else {
    const colon = rest.indexOf(":");
    if (colon >= 0) {
      if (rest.indexOf(":", colon + 1) >= 0) return null;
      host = rest.slice(0, colon);
      portText = rest.slice(colon + 1);
    } else {
      host = rest;
    }
  }

  if (!validHost(host, bracketed)) return null;

  if (portText === null) return user === undefined ? { host } : { user, host };
  const port = parsePort(portText);
  if (port === null) return null;
  return user === undefined ? { host, port } : { user, host, port };
}

/** 남는 토큰이 정확히 하나여야 한다 — 둘 이상이면 해석하지 못한 무언가가 섞였다는 뜻이라 거절한다 */
export function parseQuickConnect(input: string): QuickConnectTarget | null {
  const raw = input.trim();
  if (raw === "") return null;

  const tokens = raw.split(/\s+/);
  if (tokens.length > 4) return null;

  let i = 0;
  if (tokens[i].toLowerCase() === "ssh" && tokens.length > 1) i += 1;

  let flagPort: number | null = null;
  const words: string[] = [];
  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "-p") {
      // 두 번 적은 것도 받지 않는다(어느 쪽이 이기는지 정하기보다 거절한다).
      if (flagPort !== null || i + 1 >= tokens.length) return null;
      const p = parsePort(tokens[i + 1]);
      if (p === null) return null;
      flagPort = p;
      i += 1;
      continue;
    }
    if (t.startsWith("-")) return null;
    words.push(t);
  }

  if (words.length !== 1) return null;
  const target = parseTargetWord(words[0]);
  if (!target) return null;

  if (flagPort === null) return target;
  // `-p` 와 `:port` 가 다르면 어느 쪽이 뜻인지 알 수 없으므로 거절한다.
  if (target.port !== undefined && target.port !== flagPort) return null;
  return { ...target, port: flagPort };
}

/**
 * 팔레트는 `web` 한 낱말을 빠른 접속으로 세우지 않는다 — `web-01` 을 찾던 Enter 한 번이 설정의 `HostName` · `ProxyJump` 를 쓰지 않는
 * 엉뚱한 곳으로 간다. 표시가 없어도 찾은 호스트가 없으면 보여 주는 판정은 부르는 쪽이 한다.
 */
export function looksLikeAddress(input: string): boolean {
  const raw = input.trim();
  if (raw === "") return false;
  if (/[@:.[]/.test(raw)) return true;
  const head = raw.split(/\s+/)[0]?.toLowerCase();
  return head === "ssh" || head === "-p";
}

/** 이 문자열이 그대로 타일의 `alias` 가 된다. 사용자를 적지 않았으면 넣지 않는다(백엔드가 채울 값을 지어내지 않는다) */
export function quickConnectLabel(target: QuickConnectTarget): string {
  const user = target.user ? `${target.user}@` : "";
  const port = target.port !== undefined && target.port !== 22 ? `:${target.port}` : "";
  return `${user}${target.host}${port}`;
}
