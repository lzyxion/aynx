/**
 * **DB 연결의 AI 권한**(쿼리 타일 3단계 3a — docs/log/2026-10-13-db-write-mcp-design.md B-2 · D4) — 프런트 쪽 얇은 통로와 순수 규칙.
 *
 * - 단계는 **누적 넷**: `off`(기본 — 연결이 AI 목록에도 안 보인다) < `schema`(구조만 — 스키마 · 구조 · DDL, 행은 안 나간다) <
 *   `read`(읽기 전용 — 조회 결과 행이 AI 모델 제공자로 간다) < `approve`(승인 후 실행 — + 쓰기 작업안 제안, 사람이 승인해야 실행 · 3b) <
 *   `all`(모두 승인 — 2026-10-23: 쓰기 작업안이 사람 없이 승인된다 · 전체 스위치가 켜져 있을 때).
 *   **허용 목록으로 고르는 '자동 승인 실행' 은 없다**(호스트 권한과 다른 점 — SQL 은 허용 목록으로 범위를 말할 수 없다). 모두 승인은 범위를
 *   "이 연결 전부" 로 명시하는 단계라 고르면 확인 상자가 먼저 선다.
 * - 저장은 Rust(`delegation::database` — `delegation.toml` `[[database]]`)가 **신원 스냅샷**(엔진 · 경유 · 주소 · 포트 · DB · 사용자 · 파일)과
 *   함께 적는다. 프런트는 단계 하나만 보낸다 — 스냅샷 값은 받지도 않는다(`identityOk` 만). 연결을 다른 서버로 고쳐 가리키면 권한이
 *   풀린다(Rust 가 끔으로 읽는다) — 폼은 대상이 바뀌면 AI 칸을 끔으로 되돌려 보인다([`formAiLevel`]).
 * - **헤드리스**(2026-11-09 — `[[database]] headless`): 타일 없이 AI 가 이 연결을 여는 위임(볼트의 비밀번호 · SQLite 는 파일 — 같은 날 SQLite 도). 단계와 따로인 칸이고 같은
 *   명령(`db_ai_set` 의 `headless`)으로 적는다. 칸이 없는 옛 블록은 Rust 가 켬으로 읽는다(이관) · 새 블록은 끔. 쿼리 타일이 열려 있는 동안은
 *   이 칸과 무관하게 그 타일의 비밀번호로 일한다(빌린 값).
 * - **MCP 에는 이 권한을 고치는 도구가 없다**(호스트 위임과 같은 규칙). 판정은 세션 서버가 도구 호출마다 파일을 다시 읽어 한다.
 *
 * 이 모듈은 **순수 모듈**이다(룬 없음) — 앱이 들고 있는 사본은 `app/db-ai.svelte.ts`.
 */
import { invoke } from "./ipc";
import type { Key } from "$lib/i18n/keys";
import { sameAlias, type DbConn } from "$lib/db-conn";

export type DbAiLevel = "off" | "schema" | "read" | "approve" | "all";

/** 낮은 것부터 — 폼의 세그먼트 버튼 순서 */
export const DB_AI_LEVELS = ["off", "schema", "read", "approve", "all"] as const satisfies readonly DbAiLevel[];

/**
 * 단계 → 이름 키(Off · Read · Ask · YOLO 는 호스트 단계 이름과 같은 글자 + Schema). 이름은 모든 언어에서 같은 영어 낱말이라(2026-10-23)
 * 넓은 자리 · 좁은 자리(칩 · 게이지 눈금)가 이 표 하나를 쓴다.
 */
export const DB_AI_NAME: Readonly<Record<DbAiLevel, Key>> = {
  off: "app.ai.stage.off",
  schema: "app.dbai.level.schema",
  read: "app.ai.stage.read",
  approve: "app.ai.stage.approve",
  all: "app.ai.stage.all",
};

/** 단계 → 설명 줄 키(DB 뜻으로 — 행이 어디로 가는지 밝힌다) */
export const DB_AI_DESC: Readonly<Record<DbAiLevel, Key>> = {
  off: "app.dbai.level.off.desc",
  schema: "app.dbai.level.schema.desc",
  read: "app.dbai.level.read.desc",
  approve: "app.dbai.level.approve.desc",
  all: "app.dbai.level.all.desc",
};

/** 이 단계로 **올릴 때** 확인 상자가 먼저 서야 하는가 — 모두 승인으로 새로 올라갈 때만. **순수** */
export function dbAiNeedsConfirm(from: DbAiLevel, to: DbAiLevel): boolean {
  return to === "all" && from !== "all";
}

/** `a` 가 `b` 이상인가 */
export function dbAiAtLeast(a: DbAiLevel, b: DbAiLevel): boolean {
  return DB_AI_LEVELS.indexOf(a) >= DB_AI_LEVELS.indexOf(b);
}

/** 조회 결과 행이 AI(모델 제공자)로 가는 단계인가 — 폼이 경고 줄을 세운다 */
export function dbAiSendsRows(level: DbAiLevel): boolean {
  return dbAiAtLeast(level, "read");
}

/** Rust `DbAiView` — 블록 하나(스냅샷 값 없음) */
export interface DbAiView {
  id: string;
  level: DbAiLevel;
  /** 지금 연결과 스냅샷이 같다(거짓 = 권한이 풀려 끔으로 동작한다) */
  identityOk: boolean;
  /** 타일 없이 AI 접속(볼트의 비밀번호) — 파일의 칸(칸이 없는 옛 블록은 켬). 효력은 `identityOk` 와 함께 */
  headless: boolean;
  /** 그 id 의 연결이 목록에 있다(거짓 = 고아 블록) */
  connKnown: boolean;
  name?: string;
}

/** Rust `DbAiList` */
export interface DbAiList {
  targets: DbAiView[];
  /** 붙은 세션 서버가 DB MCP 도구를 아는 판(11 이상)인가 */
  serverReady: boolean;
  /** 붙은 세션 서버가 AI 의 DB 쓰기 작업안을 아는 판(12 이상 — 3b)인가 */
  writePlans: boolean;
  /** 붙은 세션 서버가 DB 연결 폼의 [연결 테스트](op `db_test`)를 아는 판(28 이상)인가 — 아니면 폼이 단추를 숨긴다 */
  connTest: boolean;
}

/**
 * **쿼리 타일 머리줄의 AI 권한 칩**(10-14) — 지금 걸린 단계와 "풀림"(대상이 바뀜). 칩은 **끔이어도 선다**(10-23 사용자 결정 — 빈 게이지 +
 * Off, 원격 · 로컬 타일 칩과 같다. 보기 싫으면 설정 › 터미널 › 타일 머리줄 칩의 AI 권한을 끈다). 풀림은 끔으로 동작하되 경고색으로 선다. **순수.**
 */
export function dbAiChipOf(view: DbAiView | null | undefined): { level: DbAiLevel; broken: boolean } {
  const broken = !!view && view.connKnown && !view.identityOk;
  return { level: effectiveDbAi(view), broken };
}

/** 블록 → 실제로 걸린 단계(없거나 스냅샷이 어긋나면 `off`) */
export function effectiveDbAi(v: DbAiView | null | undefined): DbAiLevel {
  return v && v.identityOk && v.connKnown ? v.level : "off";
}

function norm(s: string | undefined): string {
  return (s ?? "").trim();
}

/**
 * 두 연결이 **같은 DB 를 가리키는가** — Rust `DbIdentity` 와 같은 칸(엔진 · 경유 · 주소 · 포트 · DB · 사용자 · 파일). 이름 · TLS 는 보지 않는다.
 * 경유 별칭만 대소문자를 무시한다.
 */
export function sameDbTarget(a: DbConn, b: DbConn): boolean {
  const via = (x: DbConn) => norm(x.via);
  const viaSame = via(a) === "" ? via(b) === "" : via(b) !== "" && sameAlias(via(a), via(b));
  return (
    viaSame &&
    a.engine === b.engine &&
    norm(a.host) === norm(b.host) &&
    (a.port ?? null) === (b.port ?? null) &&
    norm(a.database) === norm(b.database) &&
    norm(a.user) === norm(b.user) &&
    norm(a.path) === norm(b.path)
  );
}

/**
 * 폼에 보일 단계 — 편집 중 **대상이 바뀌었고**(`targetChanged`) 사람이 AI 칸을 아직 만지지 않았으면 끔으로 되돌린다(새 대상에 옛 권한을
 * 말없이 옮기지 않는다 — 다시 고르게 한다).
 */
export function formAiLevel(picked: DbAiLevel, touched: boolean, targetChanged: boolean): DbAiLevel {
  return targetChanged && !touched ? "off" : picked;
}

/**
 * 저장 때 Rust 에 적을 단계 — 적을 것이 없으면 `null`.
 * - 고른 단계가 지금 걸린 단계와 다르면 적는다(끔 = 블록 지우기).
 * - 같아도 대상이 바뀌었거나(스냅샷을 새 대상으로) 블록이 풀려 있으면(`broken`) 다시 적는다 — 끔이면 풀린 블록을 지운다.
 */
export function dbAiToWrite(o: {
  level: DbAiLevel;
  stored: DbAiLevel;
  blockExists: boolean;
  broken: boolean;
  targetChanged: boolean;
}): DbAiLevel | null {
  if (o.level !== o.stored) return o.level === "off" && !o.blockExists ? null : o.level;
  if (o.level === "off") return o.blockExists ? "off" : null;
  return o.targetChanged || o.broken ? o.level : null;
}

/** 블록 → 실제로 걸린 헤드리스(블록이 없거나 스냅샷이 어긋나면 `false`) */
export function effectiveDbHeadless(v: DbAiView | null | undefined): boolean {
  return effectiveDbAi(v) !== "off" && !!v?.headless;
}

/**
 * 연결 폼의 헤드리스 상자 — 이름은 호스트 폼과 같은 "헤드리스 접속"(`app.ai.headless`) · 늘 보이는 설명 한 줄(`desc`) · 나머지는 ⓘ 안
 * (`note` — 2026-11-10 사용자 결정: 설명이 길다). SQLite 도 상자가 있다(2026-11-09 — 비밀번호가 없어도 타일 없이 AI 가 여는 것은 위임) ·
 * SQLite 는 볼트를 쓰지 않아 볼트가 없어도 켤 수 있다. 켜진 것은 언제든 끌 수 있다(`blocked` 는 끔일 때만). **순수**
 */
export function dbHeadlessBox(
  engine: DbConn["engine"],
  vaultAbsent: boolean,
  on: boolean,
): { label: Key; desc: Key; note: readonly Key[]; blocked: boolean } {
  if (engine === "sqlite") {
    return {
      label: "app.ai.headless",
      desc: "app.dbai.headless.desc.sqlite",
      note: ["app.dbai.headless.tile.sqlite"],
      blocked: false,
    };
  }
  return {
    label: "app.ai.headless",
    desc: vaultAbsent ? "app.hostform.delegation.vault.absent" : "app.dbai.headless.desc",
    note: ["app.dbai.headless.locked", "app.dbai.headless.tile"],
    blocked: vaultAbsent && !on,
  };
}

/**
 * AI 권한 탭의 "할 수 있는 일" 줄 — 호스트 폼의 요약(`aiSummary`)과 같은 모양 · 단계가 누적이라 그 단계 이상이면 켬. **순수**
 */
export function dbAiSummary(level: DbAiLevel): readonly { key: Key; on: boolean }[] {
  return [
    { key: "app.dbai.sum.schema", on: dbAiAtLeast(level, "schema") },
    { key: "app.dbai.sum.read", on: dbAiAtLeast(level, "read") },
    { key: "app.dbai.sum.plans", on: dbAiAtLeast(level, "approve") },
    { key: "app.dbai.sum.all", on: dbAiAtLeast(level, "all") },
  ];
}

/**
 * 폼에 보일 헤드리스 — 대상이 바뀌었고 만지지 않았으면 끔(단계와 같은 규칙 — 새 대상에 옛 위임을 옮기지 않는다). **순수**
 */
export function formDbHeadless(picked: boolean, touched: boolean, targetChanged: boolean): boolean {
  return targetChanged && !touched ? false : picked;
}

/**
 * 저장 때 Rust 에 적을 것 — 단계([`dbAiToWrite`]) + 헤드리스. 적을 것이 없으면 `null`.
 * - 단계를 끔으로 적으면 헤드리스는 싣지 않는다(블록째 지운다).
 * - 단계를 적으면 폼의 헤드리스를 함께 싣는다(대상이 바뀐 다시 적기도 폼이 보인 값 그대로).
 * - 단계가 그대로면 헤드리스가 지금 걸린 값과 다를 때만 지금 단계 + 헤드리스.
 */
export function dbAiFormWrite(o: {
  level: DbAiLevel;
  stored: DbAiLevel;
  blockExists: boolean;
  broken: boolean;
  targetChanged: boolean;
  headless: boolean;
  storedHeadless: boolean;
}): { level: DbAiLevel; headless?: boolean } | null {
  const level = dbAiToWrite(o);
  if (o.level === "off") return level === null ? null : { level };
  if (level !== null) return { level, headless: o.headless };
  return o.headless !== o.storedHeadless ? { level: o.level, headless: o.headless } : null;
}

/** 지금 블록 전부 · 서버 판. **실패는 삼킨다**(빈 목록 · 서버 준비됨으로 — 칸 하나 때문에 폼이 무너지면 안 된다) */
export async function listDbAi(): Promise<DbAiList> {
  try {
    const r = await invoke<DbAiList>("db_ai_list");
    return {
      targets: r?.targets ?? [],
      serverReady: r?.serverReady ?? true,
      writePlans: r?.writePlans ?? true,
      connTest: r?.connTest ?? true,
    };
  } catch {
    return { targets: [], serverReady: true, writePlans: true, connTest: true };
  }
}

/**
 * 연결 하나의 단계를 저장한다(끔 = 블록 지우기) — 사람이 시킨 일이라 오류를 던진다. `headless` 를 주지 않으면 그 칸은 그대로(새 블록 ·
 * 대상이 바뀐 블록은 Rust 가 끔으로 적는다)
 */
export function setDbAi(id: string, level: DbAiLevel, headless?: boolean): Promise<void> {
  return invoke<void>("db_ai_set", { id, level, headless: headless ?? null });
}

/** 블록들을 지운다(설정 › 보안 표의 [제거]) — 지운 수 */
export function removeDbAi(ids: readonly string[]): Promise<number> {
  return invoke<number>("db_ai_remove", { ids: [...ids] });
}
