// 공개키 설치(`ssh-copy-id` 상당 — docs/log/2026-09-03-copy-id-ui.md).
// 비밀번호는 `runInstall` 의 지역 변수 하나에만 산다 — 상태 · 큐 · 모듈 변수 · 로그 · 문구로 새지 않는다.
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

/** `keyAuthOk` 가 거짓이어도 오류가 아니다 — 파일은 들어갔고 사정은 `message` 에 실려 있다 */
export async function installKeyFor(host: HostEntry): Promise<void> {
  const alias = host.name;
  rememberTarget(host);

  const target = await chooseKeyToInstall(alias);
  if (target === null) return;
  await runInstall(alias, target);
}

export type InstallTarget =
  | { kind: "agent"; fingerprint: string }
  | { kind: "line"; line: string };

/** ssh-agent 는 선택이다 — 에이전트 목록의 실패는 빈 목록과 같이 다룬다(키 없는 PC 도 새 키 만들기에 닿는다) */
async function chooseKeyToInstall(alias: string): Promise<InstallTarget | null> {
  const agentKeys = await listAgentPublicKeys().catch(() => [] as AgentKey[]);
  const fileKeys = await listSshKeyFiles().catch(() => [] as KeyFile[]);

  if (agentKeys.length === 0 && fileKeys.length === 0) {
    return resolvePickedKey(alias, { kind: "new" });
  }

  // "새 키 만들기…" 줄은 비상구라 이 셈에 넣지 않는다
  if (agentKeys.length + fileKeys.length === 1) {
    const agent = agentKeys[0];
    const file = fileKeys[0];
    return agent
      ? { kind: "agent", fingerprint: agent.fingerprint }
      : { kind: "line", line: file.publicLine };
  }

  const picked = await pickInstallKey(alias, agentKeys, fileKeys);
  if (picked === null) return null;
  return resolvePickedKey(alias, picked);
}

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

/** 목록을 다시 읽어 이미 있는 이름을 제안하지 않는다 — 백엔드가 덮어쓰기를 거절한다 */
export async function newKey(alias: string | null) {
  const existing = (await listSshKeyFiles().catch(() => [] as KeyFile[])).map((k) =>
    keyFileName(k.privatePath),
  );
  return promptKeygen({
    alias,
    suggestedName: defaultKeyName(existing, alias),
    // 비워 보내면 `ssh-keygen` 이 `user@hostname` 을 채운다
    suggestedComment: alias ?? "",
  });
}

export async function runInstall(alias: string, target: InstallTarget): Promise<void> {
  let acceptNewHostKey = false;
  let hostKeyAsked = false;
  let passwordAttempts = 0;
  /** `finally` 에서 반드시 놓는다 */
  let password: string | undefined;

  try {
    passwordAttempts += 1;
    password =
      (await promptPassword({
        alias,
        message: t("files.host.installkey.password", { alias }),
        attempt: passwordAttempts,
        maxAttempts: MAX_PASSWORD_ATTEMPTS,
        // 이 흐름은 금고를 보지 않는다 — 사람이 그 자리에서 치는 비밀번호로만 붙는다
        storedRejected: false,
      })) ?? undefined;
    if (password === undefined) return;

    for (;;) {
      if (password === undefined) return;
      try {
        // 에이전트 키는 지문으로만 — 본문을 프런트가 왕복시키면 에이전트가 서명할 것과 어긋날 수 있다(`copy_id.rs` 의 `AgentKey`)
        const report =
          target.kind === "agent"
            ? await installPublicKey(alias, password, target.fingerprint, acceptNewHostKey, t)
            : await installPublicKeyLine(alias, password, target.line, acceptNewHostKey, t);
        toast.success(report.message);
        void flushVaultSaves();
        return;
      } catch (e) {
        const err = sessionErrorOf(e, t);

        if (err.kind === "host_key_unknown" && !hostKeyAsked) {
          hostKeyAsked = true;
          // 백엔드 `install_public_key` 는 수락/거부 두 갈래만 받는다
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
          continue; // 백엔드가 비밀번호를 들고 있지 않아 다시 실어 보낸다
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
          if (again === null) return;
          password = again;
          continue;
        }

        showNotice(describeSessionError(err, t));
        return;
      }
    }
  } finally {
    password = undefined;
    // 남은 저장은 실패 · 취소다 — 틀린 값을 금고에 담으면 다음 접속이 한 번 더 거부당한다
    dropVaultSaves();
  }
}
