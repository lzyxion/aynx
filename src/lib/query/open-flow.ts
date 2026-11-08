/**
 * **쿼리 타일의 연결 열기 고리**(쿼리 타일 7단계) — 순수 흐름이고 묻는 창 · 볼트 · invoke 는 부르는 쪽이 넣는다(`deps`).
 * 배선은 `app/query.svelte.ts` 의 `openDbForTile`.
 *
 * ```
 * 다시 붙기만(`reattach` — 서버가 떼어 둔 연결이 있으면 그대로 · 리로드·재시작 뒤 아무것도 묻지 않는다 — 9단계)
 *   → 없으면 ↓
 * 볼트 잠금 해제 관문(켜져 있고 잠겨 있을 때 — 터미널 SSH 열기와 같은 관문)
 *   → db_open ─┬ 경유 SSH 관문(호스트 키 · 암호구 · SSH 비밀번호) → runSshGates 가 묻고 다시 부른다
 *              ├ [db-password] · [db-auth] → DB 접속 모달(같은 비밀번호 모달 — `db` 대상) → 그 값을 실어 다시(최대 3회)
 *              ├ 성공 → 모달에서 "이 앱에 저장" 을 켠 값을 **이제** 볼트에 담는다(인증이 선 뒤 — SSH 와 같은 규칙)
 *              └ 그 밖 → 담지 않고 버린다 · 갈래(다시 열기 · 끊김 · 옛 서버 · 오류)와 문구
 * ```
 *
 * - DB 비밀번호는 지역 변수 하나로만 오가고 시도 직후 놓는다(경유 SSH 의 비밀번호 · 암호구도 `runSshGates` 안에서 같다).
 * - 비밀번호를 묻는 동안 서버는 경유 전송로를 그 타일 열쇠에 잠깐 세워 둔다(Rust `db::pg::park`) — 그래서 다시 부를 때
 *   SSH 관문이 다시 오지 않는다.
 * - 사람이 모달을 취소하면 `cancelled` — 화면은 "연결 안 됨 · [다시 연결]".
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

export interface DbOpenDeps {
  /** 서버에 있는 연결에 붙기만 — 붙었으면 그 답, 없으면 `null`(관문을 지나 평소처럼 연다). 없으면 건너뛴다 */
  reattach?: () => Promise<DbOpened | null>;
  /** 한 번의 `db_open` — DB 비밀번호(있으면) · 경유 SSH 관문의 답(SSH 경유일 때만) */
  open: (password: string | undefined, ssh: SshGateCreds | undefined) => Promise<DbOpened>;
  /** 경유 호스트 별칭(`null` = 경유 없음 — SSH 관문을 돌리지 않는다) */
  via: string | null;
  /** 경유 SSH 관문의 창들(호스트 키 · 비밀번호 · 암호구) */
  gates: SshGatePrompts;
  /** DB 접속 모달(비밀번호 모달에 `db` 를 실어 부른다) */
  askPassword: PromptPassword;
  target: DbPasswordTarget;
  /** 볼트가 켜져 있고 잠겨 있으면 먼저 열게 한다(아니면 곧바로) */
  ensureUnlocked: () => Promise<void>;
  /** 접속이 섰다 — 모달에서 저장을 켠 값을 담는다 */
  flushSaves: () => void;
  /** 접속이 서지 않았다 — 적어 둔 값을 버린다 */
  dropSaves: () => void;
  tr: Tr;
}

export type DbOpenOutcome =
  | { ok: true; opened: DbOpened }
  | { ok: false; kind: DbErrorKind; message: string };

/** 연다 — 묻고 다시 부르기를 끝까지 돌린 결과(던지지 않는다) */
export async function openDbFlow(deps: DbOpenDeps): Promise<DbOpenOutcome> {
  // 떼어 둔 연결(리로드·GUI 재시작·창 이관 뒤)이면 볼트 잠금 해제·비밀번호를 묻지 않고 그대로 붙는다.
  const again = deps.reattach ? await deps.reattach().catch(() => null) : null;
  if (again) return { ok: true, opened: again };
  await deps.ensureUnlocked();
  let password: string | undefined;
  let attempts = 0;
  for (;;) {
    try {
      const sent = password;
      password = undefined; // 이 시도에 실은 뒤 곧바로 놓는다
      const opened = await runSshGates(
        deps.via ?? "",
        deps.via ? deps.gates : {},
        (ssh) => deps.open(sent, deps.via ? ssh : undefined),
        // DB 쪽 실패(글자 — 이유 접두어)는 관문이 아니다 — 받은 그대로 여기서 가른다.
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
      if (kind === "password" && attempts < MAX_PASSWORD_ATTEMPTS) {
        attempts += 1;
        const entered = await deps.askPassword({
          alias: deps.via ?? "",
          message: stripReason(m),
          attempt: attempts,
          maxAttempts: MAX_PASSWORD_ATTEMPTS,
          // 볼트에 담아 둔 값이 거절됐다 — 모달이 갱신을 권하고 저장 체크를 미리 켠다(SSH 와 같은 뜻).
          storedRejected: hasReason(m, "db-stored-rejected"),
          db: deps.target,
        });
        if (entered === null) {
          deps.dropSaves();
          return { ok: false, kind: "cancelled", message: deps.tr("pane.query.connect.cancelled") };
        }
        password = entered;
        continue;
      }
      deps.dropSaves();
      return { ok: false, kind: kind === "password" ? "error" : kind, message: stripReason(m) };
    }
  }
}
