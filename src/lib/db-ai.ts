/**
 * DB 연결의 AI 권한 — 프런트 쪽 통로와 순수 규칙. → docs/invariants.md 전문 8
 * - 단계는 누적 다섯: `off`(AI 목록에도 안 보인다) < `schema`(행은 안 나간다) < `read`(조회 결과 행이 모델 제공자로 간다) <
 *   `approve`(쓰기 작업안 — 사람이 승인해야 실행) < `all`(전체 스위치가 켜져 있으면 쓰기 작업안이 사람 없이 승인된다).
 *   허용 목록 자동 승인은 없다 — SQL 은 허용 목록으로 범위를 말할 수 없다. `all` 은 고르면 확인 상자가 먼저 선다.
 * - 신원 스냅샷은 Rust 가 적고 프런트는 받지도 않는다(`identityOk` 만). 연결을 다른 대상으로 고치면 권한이 풀린다(끔으로 읽힌다).
 * - 헤드리스(타일 없이 AI 가 여는 위임)는 단계와 따로인 칸 — 칸이 없는 옛 블록은 Rust 가 켬으로 읽는다(이관) · 새 블록은 끔.
 *   쿼리 타일이 열려 있는 동안은 이 칸과 무관하게 그 타일의 비밀번호를 빌려 일한다.
 * - MCP 에는 이 권한을 고치는 도구가 없다. 판정은 세션 서버가 도구 호출마다 파일을 다시 읽어 한다.
 */
import { invoke } from "./ipc";
import type { Key } from "$lib/i18n/keys";
import { sameAlias, type DbConn } from "$lib/db-conn";

export type DbAiLevel = "off" | "schema" | "read" | "approve" | "all";

/** 낮은 것부터 */
export const DB_AI_LEVELS = ["off", "schema", "read", "approve", "all"] as const satisfies readonly DbAiLevel[];

export const DB_AI_NAME: Readonly<Record<DbAiLevel, Key>> = {
  off: "app.ai.stage.off",
  schema: "app.dbai.level.schema",
  read: "app.ai.stage.read",
  approve: "app.ai.stage.approve",
  all: "app.ai.stage.all",
};

export const DB_AI_DESC: Readonly<Record<DbAiLevel, Key>> = {
  off: "app.dbai.level.off.desc",
  schema: "app.dbai.level.schema.desc",
  read: "app.dbai.level.read.desc",
  approve: "app.dbai.level.approve.desc",
  all: "app.dbai.level.all.desc",
};

export function dbAiNeedsConfirm(from: DbAiLevel, to: DbAiLevel): boolean {
  return to === "all" && from !== "all";
}

export function dbAiAtLeast(a: DbAiLevel, b: DbAiLevel): boolean {
  return DB_AI_LEVELS.indexOf(a) >= DB_AI_LEVELS.indexOf(b);
}

/** 조회 결과 행이 모델 제공자로 가는 단계인가 — 폼이 경고 줄을 세운다 */
export function dbAiSendsRows(level: DbAiLevel): boolean {
  return dbAiAtLeast(level, "read");
}

/** Rust `DbAiView` — 스냅샷 값은 싣지 않는다 */
export interface DbAiView {
  id: string;
  level: DbAiLevel;
  /** 거짓 = 권한이 풀려 끔으로 동작한다 */
  identityOk: boolean;
  /** 효력은 `identityOk` 와 함께다 */
  headless: boolean;
  /** 거짓 = 고아 블록 */
  connKnown: boolean;
  name?: string;
}

/** Rust `DbAiList` — 아래 셋은 붙은 세션 서버의 판이 그 기능을 아는가 */
export interface DbAiList {
  targets: DbAiView[];
  serverReady: boolean;
  writePlans: boolean;
  /** 거짓이면 폼이 [연결 테스트] 단추를 숨긴다 */
  connTest: boolean;
}

/** 칩은 끔이어도 선다(사용자 결정). 풀림은 끔으로 동작하되 경고색으로 선다 */
export function dbAiChipOf(view: DbAiView | null | undefined): { level: DbAiLevel; broken: boolean } {
  const broken = !!view && view.connKnown && !view.identityOk;
  return { level: effectiveDbAi(view), broken };
}

export function effectiveDbAi(v: DbAiView | null | undefined): DbAiLevel {
  return v && v.identityOk && v.connKnown ? v.level : "off";
}

function norm(s: string | undefined): string {
  return (s ?? "").trim();
}

/** Rust `DbIdentity` 와 같은 칸을 본다 — 이름 · TLS 는 보지 않고, 경유 별칭만 대소문자를 무시한다 */
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

/** 새 대상에 옛 권한을 말없이 옮기지 않는다 — 다시 고르게 한다 */
export function formAiLevel(picked: DbAiLevel, touched: boolean, targetChanged: boolean): DbAiLevel {
  return targetChanged && !touched ? "off" : picked;
}

/** 같은 단계여도 대상이 바뀌었거나 풀려 있으면 다시 적는다 — 스냅샷을 새 대상으로 */
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

export function effectiveDbHeadless(v: DbAiView | null | undefined): boolean {
  return effectiveDbAi(v) !== "off" && !!v?.headless;
}

/**
 * SQLite 도 상자가 있다 — 비밀번호가 없어도 타일 없이 AI 가 여는 것은 위임이다. 볼트를 쓰지 않아 볼트가 없어도 켤 수 있다.
 * 켜진 것은 언제든 끌 수 있다(`blocked` 는 끔일 때만).
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

export function dbAiSummary(level: DbAiLevel): readonly { key: Key; on: boolean }[] {
  return [
    { key: "app.dbai.sum.schema", on: dbAiAtLeast(level, "schema") },
    { key: "app.dbai.sum.read", on: dbAiAtLeast(level, "read") },
    { key: "app.dbai.sum.plans", on: dbAiAtLeast(level, "approve") },
    { key: "app.dbai.sum.all", on: dbAiAtLeast(level, "all") },
  ];
}

/** 새 대상에 옛 위임을 옮기지 않는다 */
export function formDbHeadless(picked: boolean, touched: boolean, targetChanged: boolean): boolean {
  return targetChanged && !touched ? false : picked;
}

/** 단계를 끔으로 적으면 헤드리스는 싣지 않는다 — 블록째 지운다 */
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

/** 실패는 삼킨다 — 칸 하나 때문에 폼이 무너지면 안 된다 */
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

/** 끔 = 블록 지우기. `headless` 를 주지 않으면 그 칸은 그대로다(새 블록 · 대상이 바뀐 블록은 Rust 가 끔으로 적는다) */
export function setDbAi(id: string, level: DbAiLevel, headless?: boolean): Promise<void> {
  return invoke<void>("db_ai_set", { id, level, headless: headless ?? null });
}

/** 지운 수를 돌려준다 */
export function removeDbAi(ids: readonly string[]): Promise<number> {
  return invoke<number>("db_ai_remove", { ids: [...ids] });
}
