// **공개키 설치**(`ssh-copy-id` 상당) — 심을 키 고르기(에이전트·파일·새 키) → 비밀번호·TOFU 관문 루프(`runInstall`).
// 비밀번호는 `runInstall` 의 지역 변수 하나에만 산다. `newKey` · `runInstall` · `InstallTarget` 은 내부 전용(폼의 새 키 토스트가 쓴다).
import { toast } from "$lib/toast.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  confirmHostKey,
  dropVaultSaves,
  flushVaultSaves,
  pickInstallKey,
  promptPassword,
  rememberTarget,
  type PickedKey,
} from "$lib/app/prompts.svelte.js";
import { promptKeygen } from "$lib/app/keygen.svelte.js";
import type { HostEntry } from "$lib/hosts";
import {
  installPublicKey,
  installPublicKeyLine,
  listAgentPublicKeys,
  type AgentKey,
} from "$lib/copyid";
import { defaultKeyName, keyFileName, listSshKeyFiles, type KeyFile } from "$lib/keygen";
import { describeSessionError, sessionErrorOf, MAX_PASSWORD_ATTEMPTS } from "$lib/session";

// ---------------------------------------------------------------------------
// 공개키 설치 (`ssh-copy-id` 상당 — docs/log/2026-09-03-copy-id-ui.md)
// ---------------------------------------------------------------------------

/**
 * 호스트 하나에 공개키를 설치한다 — 세션 타일 우클릭 "공개키 설치…" 의 실체.
 *
 * ```
 * 심을 키 고르기 ([`chooseKeyToInstall`] — 에이전트 키 · `~/.ssh` 키 파일 · 새 키)
 *   ├ 하나도 없음 → 곧바로 새 키 만들기 모달
 *   └ [키…]       → 1개면 그것, 여럿이면 키 선택 모달
 *         ↓ 비밀번호 모달 (1회, 저장하지 않음)
 * install_public_key(alias, password, fingerprint, false)
 *   ├ host_key_unknown  → TOFU 모달 → 수락이면 acceptNewHostKey:true 로 **같은 비밀번호를
 *   │                      다시 실어** 재시도 (백엔드가 저장해 두지 않는다)
 *   ├ host_key_changed  → 중단 (로그인과 같은 문구)
 *   ├ password_required → 비밀번호 재입력 (최대 MAX_PASSWORD_ATTEMPTS 회) 후 재시도
 *   ├ auth / other      → 문구 그대로 안내
 *   └ Ok(report)        → report.message 를 그대로 띄운다
 * ```
 *
 * `keyAuthOk` 가 거짓이어도 **오류가 아니다** — 파일은 들어갔고 남은 것은 서버 설정이며,
 * 그 사정이 이미 `message` 에 실려 있다.
 *
 * ## 비밀번호가 사는 곳
 *
 * **이 함수의 지역 변수 하나뿐**이다. 컴포넌트 상태로도, 큐 항목으로도, 모듈 변수로도 새지
 * 않는다. TOFU 재시도에서만 같은 값을 다시 쓰고 (백엔드가 매 호출에 요구한다), 어떤 경로로
 * 끝나든 `finally` 에서 놓는다. 로그·안내 문구에는 실리지 않는다.
 */
export async function installKeyFor(host: HostEntry): Promise<void> {
  const alias = host.name;
  rememberTarget(host); // 비밀번호 모달의 "대상" 줄에 user@host:port 를 보여 주기 위해

  const target = await chooseKeyToInstall(alias);
  if (target === null) return; // 고를 것이 없거나(안내는 이미 떴다) 취소했다
  await runInstall(alias, target);
}

/**
 * 서버에 심을 것 하나 — **열쇠가 둘 중 하나**다.
 *
 * 에이전트 키는 지문만 보내고(백엔드가 에이전트에서 다시 찾는다), 파일 키·방금 만든 키는
 * 줄 자체를 보낸다. 그 갈림이 [`runInstall`] 의 invoke 한 줄에 그대로 나타난다.
 *
 * (2026-09-19 ② 에 `key` 칸이 없어졌다 — 설치를 마친 토스트의 [에이전트에 넣기] 가
 * 사라지면서 "개인키가 어디 있는지" 를 이 자리에서 알 이유도 함께 사라졌다.
 * docs/log/2026-09-19-vault.md)
 */
export type InstallTarget =
  | { kind: "agent"; fingerprint: string }
  | { kind: "line"; line: string };

/**
 * **심을 것 하나를 정한다** — 목록 둘을 모으고, 고르개를 띄우고, "새 키" 를 만든다.
 *
 * ```
 * list_agent_public_keys() ┐
 * list_ssh_key_files()     ┘ 둘 다 실패·빈 목록  → 곧바로 생성 모달 (고를 것이 "새 키" 하나뿐이다)
 *   ├ 통틀어 1개            → 물어보지 않는다
 *   └ 여럿                  → 고르개 (에이전트 무리 · 파일 무리 · "새 키 만들기…")
 *         └ "새 키"         → 생성 모달 → 만든 키를 그대로 고른 것으로 친다
 * ```
 *
 * **ssh-agent 는 선택이다**(2026-11-03) — 접속은 에이전트 → 키 파일 → 비밀번호 순이라 에이전트가 꺼져 있거나
 * 비어 있어도 키 파일로 된다. 그래서 에이전트 목록의 실패는 "에이전트 무리가 빈 것" 과 같이 다룬다. 예전에는 둘 다
 * 비면 "ssh-agent 가 꺼져 있다" 안내만 띄우고 끝나, 깨끗한 PC(키 없음 · 서비스 Disabled)는 새 키 만들기에 닿지 못했다.
 */
async function chooseKeyToInstall(alias: string): Promise<InstallTarget | null> {
  const agentKeys = await listAgentPublicKeys().catch(() => [] as AgentKey[]);
  const fileKeys = await listSshKeyFiles().catch(() => [] as KeyFile[]);

  if (agentKeys.length === 0 && fileKeys.length === 0) {
    return resolvePickedKey(alias, { kind: "new" });
  }

  // 통틀어 하나뿐이면 물어볼 것이 없다 — "새 키 만들기…" 줄은 답이 아니라 **비상구**라
  // 이 셈에 넣지 않는다 (2026-09-03 부터의 규칙을 그대로 지킨다).
  if (agentKeys.length + fileKeys.length === 1) {
    const agent = agentKeys[0];
    const file = fileKeys[0];
    return agent
      ? { kind: "agent", fingerprint: agent.fingerprint }
      : { kind: "line", line: file.publicLine };
  }

  const picked = await pickInstallKey(alias, agentKeys, fileKeys);
  if (picked === null) return null; // 취소 — 아무 일도 하지 않았으므로 안내도 없다
  return resolvePickedKey(alias, picked);
}

/** 고른 줄 하나로 편다. `"new"` 면 생성 모달을 거친다 (취소면 `null`) */
async function resolvePickedKey(alias: string, picked: PickedKey): Promise<InstallTarget | null> {
  if (picked.kind === "agent") return { kind: "agent", fingerprint: picked.key.fingerprint };
  if (picked.kind === "file") {
    return { kind: "line", line: picked.key.publicLine };
  }

  const made = await newKey(alias);
  if (made === null) return null;
  toast.success(t("files.host.keygen.done", { path: made.privatePath }));
  return { kind: "line", line: made.publicKeyLine };
}

/**
 * 생성 모달을 연다 — 이름 기본값을 고르는 자리.
 *
 * 목록을 한 번 더 읽는 이유는 [`defaultKeyName`] 이 **이미 있는 이름을 제안하지 않기**
 * 위해서다 (백엔드가 덮어쓰기를 거절하므로, 그러지 않으면 모달을 열자마자 빨간 줄을 본다).
 * 이 읽기의 실패는 삼킨다 — 제안이 한 칸 나빠질 뿐 사용자가 할 일은 그대로다.
 */
export async function newKey(alias: string | null) {
  const existing = (await listSshKeyFiles().catch(() => [] as KeyFile[])).map((k) =>
    keyFileName(k.privatePath),
  );
  return promptKeygen({
    alias,
    suggestedName: defaultKeyName(existing, alias),
    // 주석을 비워 보내면 `ssh-keygen` 이 `user@hostname` 을 채운다 — 호스트를 알 때만
    // 별칭을 넣는다 ("이 키가 어디에 쓰이는 것인지" 가 주석의 쓸모다).
    suggestedComment: alias ?? "",
  });
}

/**
 * 고른 한 줄을 서버에 심는다 — TOFU·비밀번호 관문을 지나는 루프.
 *
 * `installKeyFor` 에서 통째로 떼어 낸 몸통이다. 떼어 낸 이유는 **부르는 자리가 둘**이 됐기
 * 때문이다: 공개키 설치 메뉴와, 호스트 폼에서 키를 만든 뒤 뜨는 토스트의 [설치] 버튼.
 */
export async function runInstall(alias: string, target: InstallTarget): Promise<void> {
  let acceptNewHostKey = false;
  let hostKeyAsked = false;
  let passwordAttempts = 0;
  /** 이 흐름 안에서만 사는 값. `finally` 에서 반드시 놓는다 */
  let password: string | undefined;

  try {
    passwordAttempts += 1;
    password =
      (await promptPassword({
        alias,
        message: t("files.host.installkey.password", { alias }),
        attempt: passwordAttempts,
        maxAttempts: MAX_PASSWORD_ATTEMPTS,
        // 이 흐름은 금고를 보지 않는다 — 설치는 **사람이 그 자리에서 치는** 비밀번호로
        // 한 번 붙는 일이고, "담아 둔 것이 거부됐다" 는 사정이 생길 자리가 없다.
        storedRejected: false,
      })) ?? undefined;
    if (password === undefined) return; // 취소

    // 관문마다 한 걸음씩 나아가는 루프 — `openSshInteractive` 와 같은 모양이다.
    for (;;) {
      if (password === undefined) return; // 도달하지 않는다 (모든 갈래가 값을 채우거나 끝낸다)
      try {
        // 에이전트 키는 **지문**으로, 파일 키는 **줄**로 보낸다. 백엔드는 같은 몸통을
        // 지나지만 열쇠가 다른 이유가 있다 — 에이전트 키의 본문을 프런트가 왕복시키면
        // 우리가 보낸 것과 에이전트가 서명할 것이 어긋날 수 있다 (`copy_id.rs` 의
        // `AgentKey` 주석). 파일 키에는 그 위험이 없고, 대신 지문으로 되찾아 줄 상대가 없다.
        const report =
          target.kind === "agent"
            ? await installPublicKey(alias, password, target.fingerprint, acceptNewHostKey, t)
            : await installPublicKeyLine(alias, password, target.line, acceptNewHostKey, t);
        // 공개키 설치는 **되돌리기 어려운 성공**이라 결을 분명히 한다 (문구는 Rust 것 그대로).
        //
        // 2026-09-19 ② 에 버튼이 없어졌다: `keyAuthOk` 가 거짓일 때 Rust 문구가 가리키던
        // 다음 걸음이 `ssh-add` 에서 **"접속할 때 저장을 켜세요"** 로 바뀌었고, 그 걸음은
        // 버튼이 아니라 다음 접속의 모달에 있다 (docs/log/2026-09-19-vault.md).
        toast.success(report.message);
        // 이 흐름에서 "이 앱에 저장" 을 켰다면 **여기가 성공한 자리**다.
        void flushVaultSaves();
        return;
      } catch (e) {
        const err = sessionErrorOf(e, t);

        if (err.kind === "host_key_unknown" && !hostKeyAsked) {
          hostKeyAsked = true;
          // **`allowOnce: false`** — 이 연결은 한 번 붙었다 사라지는 것이라 "기록하지 않고
          // 통과" 에 뜻이 없다 (다음 접속에서 같은 창이 또 뜬다). 백엔드
          // `install_public_key` 도 결정을 두 갈래(수락/거부)로만 받는다.
          const decision = await confirmHostKey({
            alias,
            fingerprint: err.fingerprint,
            key_type: err.key_type,
            changed: false,
            oldFingerprint: null,
            host: err.host,
            port: err.port,
            canRecord: !err.noStore,
            allowOnce: false,
          });
          if (decision === "reject") {
            showNotice(t("files.host.hostkey.rejected"));
            return;
          }
          acceptNewHostKey = true;
          continue; // 비밀번호는 그대로 다시 실어 보낸다 (백엔드가 들고 있지 않다)
        }

        if (err.kind === "password_required") {
          if (passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
            showNotice(describeSessionError(err, t));
            return;
          }
          passwordAttempts += 1;
          const again = await promptPassword({
            alias,
            message: err.message,
            attempt: passwordAttempts,
            maxAttempts: MAX_PASSWORD_ATTEMPTS,
            storedRejected: err.storedRejected === true,
          });
          if (again === null) return; // 취소 = 중단
          password = again;
          continue;
        }

        // host_key_changed · auth · other — 재시도 경로가 없다. 로그인과 같은 문구를 쓴다.
        showNotice(describeSessionError(err, t));
        return;
      }
    }
  } finally {
    password = undefined;
    // 성공한 갈래가 이미 담았다 — 남아 있다면 실패·취소로 끝난 것이므로 버린다
    // (틀린 값을 금고에 담으면 다음 접속이 그 값으로 한 번 더 거부당한다).
    dropVaultSaves();
  }
}
