/**
 * 쿼리 타일의 연결 열기 고리 — 묻는 창 · 볼트 · invoke 는 부르는 쪽이 넣는다(`deps`). [연결 테스트] 도 이 고리를 돈다(`open` = `db_test`).
 *
 * - DB 비밀번호는 지역 변수 하나로만 오가고 시도 직후 놓는다.
 * - 모달에서 "이 앱에 저장" 을 켠 값은 인증이 선 뒤에야 볼트에 담는다(SSH 와 같은 규칙) — 연결 테스트는 볼트에 담지 않는다.
 * - 비밀번호를 묻는 동안 서버가 경유 전송로를 그 타일 열쇠에 세워 둔다(Rust `db::pg::park`) — 다시 부를 때 SSH 관문이 다시 오지 않는다.
 */
import { hasReason, stripReason } from "$lib/error-reason";
import {
  MAX_PASSWORD_ATTEMPTS,
  SessionOpenError,
  describeOpenError,
  runSshGates,
  type DbPasswordTarget,
  type PromptPassword,
  type SshGateCreds,
  type SshGatePrompts,
  type Tr,
} from "$lib/session";
import { classifyDbError, errorMessage, type DbErrorKind, type DbOpened } from "./query-backend";

export interface DbOpenDeps<T = DbOpened> {
  /** 서버가 떼어 둔 연결에 붙기만 — 없으면 `null`(평소처럼 연다) */
  reattach?: () => Promise<T | null>;
  open: (password: string | undefined, ssh: SshGateCreds | undefined) => Promise<T>;
  /** `null` = 경유 없음(SSH 관문을 돌리지 않는다) */
  via: string | null;
  gates: SshGatePrompts;
  askPassword: PromptPassword;
  target: DbPasswordTarget;
  noSave?: boolean;
  /** 폼에 친 비밀번호 — DB 가 거절하면 모달로 묻지 않고 그 실패로 끝낸다 */
  formPassword?: string;
  ensureUnlocked: () => Promise<void>;
  flushSaves: () => void;
  dropSaves: () => void;
  tr: Tr;
}

export type DbOpenOutcome<T = DbOpened> =
  | { ok: true; opened: T }
  /** `raw` = 이유 접두어를 떼기 전 서버 문구(연결 테스트 칩이 갈래를 가른다) */
  | { ok: false; kind: DbErrorKind; message: string; raw?: string };

/** 던지지 않는다 */
export async function openDbFlow<T = DbOpened>(deps: DbOpenDeps<T>): Promise<DbOpenOutcome<T>> {
  // 떼어 둔 연결(리로드 · GUI 재시작 · 창 이관 뒤)이면 볼트 잠금 해제 · 비밀번호를 묻지 않고 그대로 붙는다
  let carry = false;
  const again = deps.reattach
    ? await deps.reattach().catch((e: unknown) => {
        carry = hasReason(errorMessage(e), "db-carry");
        return null;
      })
    : null;
  if (again) return { ok: true, opened: again };
  // `[db-carry]` = 끊긴 연결이 빌린 비밀번호를 서버가 쥐고 있다 — 볼트를 묻지 않고 한 번 열어 본다. 실패하면 서버가 그 항목을
  // 이미 거뒀으므로 평소 관문(볼트 → 묻기)으로 간다.
  if (carry) {
    try {
      return { ok: true, opened: await deps.open(undefined, undefined) };
    } catch {
      // 평소 관문으로
    }
  }
  await deps.ensureUnlocked();
  let password: string | undefined = deps.formPassword;
  let attempts = 0;
  for (;;) {
    try {
      const sent = password;
      password = undefined; // 이 시도에 실은 뒤 곧바로 놓는다
      const opened = await runSshGates(
        deps.via ?? "",
        deps.via ? deps.gates : {},
        (ssh) => deps.open(sent, deps.via ? ssh : undefined),
        // DB 쪽 실패(글자 — 이유 접두어)는 관문이 아니다 — 받은 그대로 여기서 가른다
        { passthrough: (e) => typeof e === "string" },
      );
      deps.flushSaves();
      return { ok: true, opened };
    } catch (e) {
      if (e instanceof SessionOpenError) {
        deps.dropSaves();
        const k = e.detail.kind;
        if (k === "cancelled" || k === "password_cancelled") {
          return { ok: false, kind: "cancelled", message: deps.tr("pane.query.connect.cancelled") };
        }
        return { ok: false, kind: "error", message: describeOpenError(e, deps.tr) };
      }
      const m = errorMessage(e);
      const kind = classifyDbError(m);
      if (kind === "password" && deps.formPassword !== undefined) {
        deps.dropSaves();
        return { ok: false, kind: "error", message: stripReason(m), raw: m };
      }
      if (kind === "password" && attempts < MAX_PASSWORD_ATTEMPTS) {
        attempts += 1;
        const entered = await deps.askPassword({
          alias: deps.via ?? "",
          message: stripReason(m),
          attempt: attempts,
          maxAttempts: MAX_PASSWORD_ATTEMPTS,
          storedRejected: hasReason(m, "db-stored-rejected"),
          db: deps.target,
          ...(deps.noSave ? { noSave: true } : {}),
        });
        if (entered === null) {
          deps.dropSaves();
          return { ok: false, kind: "cancelled", message: deps.tr("pane.query.connect.cancelled") };
        }
        password = entered;
        continue;
      }
      deps.dropSaves();
      return { ok: false, kind: kind === "password" ? "error" : kind, message: stripReason(m), raw: m };
    }
  }
}
