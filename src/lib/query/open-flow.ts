/**
 * **쿼리 타일의 연결 열기 고리**(쿼리 타일 7단계) — 순수 흐름이고 묻는 창 · 볼트 · invoke 는 부르는 쪽이 넣는다(`deps`).
 * 배선은 `app/query.svelte.ts` 의 `openDbForTile`.
 *
 * ```
 * 다시 붙기만(`reattach` — 서버가 떼어 둔 연결이 있으면 그대로 · 리로드·재시작 뒤 아무것도 묻지 않는다 — 9단계)
 *   → 없는데 `[db-carry]`(끊긴 연결이 빌린 비밀번호를 쥐었다 — 서버가 그 값으로 다시 붙는다) → 묻지 않고 한 번 연다 · 실패하면 ↓
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
 * - **DB 연결 폼의 [연결 테스트]**(`app/query.svelte.ts` 의 `startConnTest`)도 이 고리를 그대로 돈다 — `open` 이 `db_test` 이고(답의 꼴이
 *   달라 고리는 답 꼴 `T` 를 모른다) `noSave` 로 모달의 "이 앱에 저장" 을 숨기며 저장 콜백은 버리기뿐이다(테스트는 볼트에 담지 않는다).
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
  /** 서버에 있는 연결에 붙기만 — 붙었으면 그 답, 없으면 `null`(관문을 지나 평소처럼 연다). 없으면 건너뛴다 */
  reattach?: () => Promise<T | null>;
  /** 한 번의 `db_open`(또는 `db_test`) — DB 비밀번호(있으면) · 경유 SSH 관문의 답(SSH 경유일 때만) */
  open: (password: string | undefined, ssh: SshGateCreds | undefined) => Promise<T>;
  /** 경유 호스트 별칭(`null` = 경유 없음 — SSH 관문을 돌리지 않는다) */
  via: string | null;
  /** 경유 SSH 관문의 창들(호스트 키 · 비밀번호 · 암호구) */
  gates: SshGatePrompts;
  /** DB 접속 모달(비밀번호 모달에 `db` 를 실어 부른다) */
  askPassword: PromptPassword;
  target: DbPasswordTarget;
  /** DB 접속 모달의 "이 앱에 저장" 을 숨긴다(연결 테스트 — 없으면 보인다) */
  noSave?: boolean;
  /** 볼트가 켜져 있고 잠겨 있으면 먼저 열게 한다(아니면 곧바로) */
  ensureUnlocked: () => Promise<void>;
  /** 접속이 섰다 — 모달에서 저장을 켠 값을 담는다 */
  flushSaves: () => void;
  /** 접속이 서지 않았다 — 적어 둔 값을 버린다 */
  dropSaves: () => void;
  tr: Tr;
}

export type DbOpenOutcome<T = DbOpened> =
  | { ok: true; opened: T }
  /** `raw` = 이유 접두어를 떼기 전 서버 문구(DB 쪽 실패만 — 연결 테스트 칩이 갈래를 가른다 · 화면에는 `message`) */
  | { ok: false; kind: DbErrorKind; message: string; raw?: string };

/** 연다 — 묻고 다시 부르기를 끝까지 돌린 결과(던지지 않는다) */
export async function openDbFlow<T = DbOpened>(deps: DbOpenDeps<T>): Promise<DbOpenOutcome<T>> {
  // 떼어 둔 연결(리로드·GUI 재시작·창 이관 뒤)이면 볼트 잠금 해제·비밀번호를 묻지 않고 그대로 붙는다.
  let carry = false;
  const again = deps.reattach
    ? await deps.reattach().catch((e: unknown) => {
        carry = hasReason(errorMessage(e), "db-carry");
        return null;
      })
    : null;
  if (again) return { ok: true, opened: again };
  // 붙기만은 못 했지만 DB 쪽이 끊은 그 연결이 빌린 비밀번호를 쥐고 있다(떨어진 세션 — 2026-11-10 실기) — 서버의 새 열기가 볼트보다 먼저
  // 그 값을 쓰므로 볼트 잠금 해제를 묻지 않고 한 번 열어 본다(붙은 접근은 볼트와 무관). 무엇이든 실패하면(DB 거절 · 경유 SSH 관문 · 신원
  // 바뀜) 그 시도는 버리고 평소 관문(볼트 → 묻기)으로 간다 — 서버가 그 항목을 이미 거둬 다음 열기는 볼트 차례다.
  if (carry) {
    try {
      return { ok: true, opened: await deps.open(undefined, undefined) };
    } catch {
      // 평소 관문으로
    }
  }
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
