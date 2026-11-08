/**
 * **빠른 접속** — 한 줄로 친 것을 접속 대상으로 읽는다
 * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
 *
 * `~/.ssh/config` 에 항목을 만들지 않고 그 자리에서 붙고 싶은 순간이 있다: 방금 뜬 VM,
 * 남이 알려준 주소, 한 번만 들여다볼 서버. 그때까지는 파일을 열어 `Host` 블록을 적고
 * 목록이 갱신되기를 기다려야 했다 — **한 번 쓰고 버릴 이름에 영구 기록을 요구하는 것**이
 * 이 기능이 없앤 마찰이다.
 *
 * ## 문법 (받아들이는 것 전부)
 *
 * ```text
 * host                      example.com · 10.0.0.7 · [::1]
 * user@host                 deploy@example.com
 * user@host:port            deploy@example.com:2222
 * ssh user@host             앞의 `ssh` 는 있어도 되고 없어도 된다
 * ssh -p 2222 user@host     `-p` 는 대상 앞·뒤 어디든
 * ssh user@host -p 2222
 * ```
 *
 * ## 무엇을 거절하는가 — **의심스러우면 거절한다**
 *
 * 이 함수가 내놓는 값은 곧바로 SSH 접속 대상이 되고, 그 문자열은 (호스트 이름으로서)
 * 네트워크와 `known_hosts` 파일에 실린다. 그래서 위 문법 **밖의 글자는 전부 거절**한다:
 * 공백이 섞인 호스트, `;` `|` `&` `$` `` ` `` 같은 셸 메타문자, 따옴표, 슬래시, 경로,
 * URL(`ssh://`), 우리가 해석하지 않는 다른 플래그(`-i` · `-J` …). 반쯤 알아듣고 나머지를
 * 무시하는 것이 가장 나쁘다 — 사용자가 적은 `-J bastion` 을 조용히 버리면 **점프를 거치지
 * 않은 채** 대상에 직접 붙는다.
 *
 * `null` 은 "빠른 접속으로 읽을 수 없다" 는 뜻일 뿐 오류가 아니다. 부르는 쪽(명령 팔레트 ·
 * 호스트 독의 검색 칸)은 그때 그냥 줄을 그리지 않는다.
 *
 * ## 순수 모듈이다
 *
 * import 가 하나도 없다 — vitest 가 그대로 돌고(`quick-connect.test.ts`), 이 문법을 읽는
 * 자리(팔레트·독·`session.ts`)가 규칙을 각자 베껴 적지 않는다.
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

/**
 * 호스트 이름 한 조각(label) — 영숫자로 시작·끝나고 가운데에만 `-` 가 온다.
 * 점으로 이어 붙인 것이 도메인이고, IPv4 도 이 규칙을 그대로 통과한다.
 */
const LABEL_RE = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** 대괄호 IPv6 의 속 — 16진수·콜론·(IPv4 매핑용) 점만. 콜론이 하나는 있어야 한다 */
const IPV6_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/** 포트는 1–65535 정수 하나 */
function parsePort(text: string): number | null {
  if (!/^[0-9]{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 65535 ? n : null;
}

/** 호스트 이름이 위 문법 안에 있는가 (대괄호는 이미 벗겨진 상태로 들어온다) */
function validHost(host: string, bracketed: boolean): boolean {
  if (bracketed) return IPV6_RE.test(host) && host.includes(":");
  if (host.length === 0 || host.length > 253) return false;
  // 대괄호 없는 IPv6 은 받지 않는다 — 콜론이 포트와 구분되지 않는다 (`[::1]:22` 로 적는다).
  return host.split(".").every((label) => LABEL_RE.test(label));
}

/**
 * `[user@]host[:port]` 한 덩어리를 읽는다. 문법 밖이면 `null`.
 *
 * `@` 는 **마지막 것에서** 자른다 (OpenSSH 와 같다 — 사용자 이름에는 `@` 가 없다).
 * 포트는 대괄호 밖의 콜론에서만 읽는다: `[::1]` 은 콜론이 여럿이라 그러지 않으면 통째로
 * 어긋난다.
 */
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
      // 콜론이 둘 이상이면 대괄호 없는 IPv6 이다 — 포트와 구분할 수 없으므로 거절한다.
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

/**
 * 한 줄을 접속 대상으로 읽는다 — 읽을 수 없으면 `null` (순수 함수).
 *
 * 토큰은 공백으로만 갈린다. `ssh` 는 맨 앞에서 한 번만 버리고, `-p <포트>` 는 어디에 있어도
 * 좋다. 남는 토큰이 **정확히 하나**여야 하고 그것이 대상이다 — 둘 이상이면 우리가 해석하지
 * 못한 무언가가 섞여 있다는 뜻이라 거절한다.
 */
export function parseQuickConnect(input: string): QuickConnectTarget | null {
  const raw = input.trim();
  if (raw === "") return null;

  const tokens = raw.split(/\s+/);
  if (tokens.length > 4) return null; // `ssh -p N target` 이 최대다

  let i = 0;
  if (tokens[i].toLowerCase() === "ssh" && tokens.length > 1) i += 1;

  let flagPort: number | null = null;
  const words: string[] = [];
  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "-p") {
      // 값이 붙어 오지 않으면 문법이 아니다. 두 번 적은 것도 받지 않는다 (어느 쪽이 이기는지
      // 정해 주기보다 거절하는 편이 놀랄 자리가 없다).
      if (flagPort !== null || i + 1 >= tokens.length) return null;
      const p = parsePort(tokens[i + 1]);
      if (p === null) return null;
      flagPort = p;
      i += 1;
      continue;
    }
    // `-p2222` 같은 붙여 쓰기도, 다른 어떤 플래그도 받지 않는다.
    if (t.startsWith("-")) return null;
    words.push(t);
  }

  if (words.length !== 1) return null;
  const target = parseTargetWord(words[0]);
  if (!target) return null;

  if (flagPort === null) return target;
  // `-p` 와 `:port` 를 함께 적었으면 서로 달라야 할 이유가 없다 — 다르면 어느 쪽이 뜻인지
  // 알 수 없으므로 거절한다 (같으면 그대로 쓴다).
  if (target.port !== undefined && target.port !== flagPort) return null;
  return { ...target, port: flagPort };
}

/**
 * 친 글자가 **주소처럼 보이는가** — 순수 함수.
 *
 * [`parseQuickConnect`] 는 `web` 한 낱말도 (호스트 이름으로) 받아들인다. 문법으로는 맞다 —
 * `ssh web` 은 실제로 되는 명령이다. 그런데 **명령 팔레트에서는 그 관대함이 해롭다**:
 * `web-01` 을 찾으려고 `web` 까지 쳤을 때 "빠른 접속: web" 이 목록 맨 위에 서면 Enter 한 번이
 * 엉뚱한 곳으로 간다 (그쪽은 설정의 `HostName`·`User`·`ProxyJump` 를 전혀 쓰지 않는다).
 *
 * 그래서 팔레트는 이 한 겹을 더 본다: **사용자가 주소를 쳤다는 표시**가 있는가.
 * `@`(사용자) · `:`(포트) · `.`(도메인·IPv4) · `[`(IPv6) · 앞의 `ssh`/`-p` 중 하나면 그렇다.
 * 표시가 없어도 **찾은 호스트가 하나도 없으면** 그때는 보여 준다 — 그 상태에서 사용자가 친
 * 낱말은 목록의 무엇도 아니므로 접속 대상으로 읽는 편이 맞다 (그 판정은 부르는 쪽이 한다).
 */
export function looksLikeAddress(input: string): boolean {
  const raw = input.trim();
  if (raw === "") return false;
  if (/[@:.[]/.test(raw)) return true;
  const head = raw.split(/\s+/)[0]?.toLowerCase();
  return head === "ssh" || head === "-p";
}

/**
 * 대상을 **화면에 보이는 이름**으로 — `user@host[:port]` (포트가 22 면 생략).
 *
 * 이 문자열이 그대로 타일의 `alias` 가 된다 ([`PaneSpec.adhoc`]) — 탭 제목·타일 머리줄·
 * 상태바가 전부 그 한 칸을 읽으므로, 사람이 방금 친 것과 같은 모양이어야 알아본다.
 * 사용자를 적지 않았으면 이름에도 넣지 않는다 (백엔드가 채울 값을 여기서 지어내지 않는다).
 */
export function quickConnectLabel(target: QuickConnectTarget): string {
  const user = target.user ? `${target.user}@` : "";
  const port = target.port !== undefined && target.port !== 22 ? `:${target.port}` : "";
  return `${user}${target.host}${port}`;
}
