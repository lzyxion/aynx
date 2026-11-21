import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { hostsRemoved } from "$lib/app/host-remove";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  addHost,
  forgetHostKey,
  getHostMeta,
  metaToPatch,
  nextCopyAlias,
  openSshConfig,
  removeHost,
  setHostMeta,
  type HostEntry,
} from "$lib/hosts";
import { hostCache, lookupHost, refreshHosts } from "./list.svelte.js";

// ---------------------------------------------------------------------------
// 우클릭 메뉴의 나머지 (docs/log/2026-09-02-host-row-menu.md)
// ---------------------------------------------------------------------------

/**
 * `group`: `undefined` = 원본 그룹, `null` = 홈. 실패는 삼키지 않는다.
 * `claimed` 가 없으면 `hostCache` 가 다시 읽히기 전이라 둘째부터 같은 `-copy` 이름을 노려 중복 거부에 걸린다.
 */
async function duplicateOne(
  host: HostEntry,
  group: string | null | undefined,
  claimed: Set<string>,
): Promise<string> {
  const raw = await getHostMeta(host.name); // 병합 아님 — 원본 블록의 메타만
  const alias = nextCopyAlias(host.name, [...hostCache().map((h) => h.name), ...claimed]);
  claimed.add(alias);
  await addHost({
    name: alias,
    // HostName 이 없던 호스트는 별칭을 쓴다 — ssh 기본 동작과 같고 add_host 가 빈 HostName 을 거부하지 않게
    host_name: host.host_name || host.name,
    user: host.user ?? null,
    port: host.port ?? null,
    identity_file: host.identity_file ?? null,
    // 자기 블록 값만 — 공용 블록의 것을 굳히면 상속만 끊긴다
    identities_only: host.identities_only_own === true,
    proxy_jump: host.proxy_jump ?? null,
  });
  const patch = metaToPatch(raw);
  await setHostMeta(alias, group === undefined ? patch : { ...patch, group });
  return alias;
}

export async function duplicateHost(host: HostEntry): Promise<void> {
  try {
    const alias = await duplicateOne(host, undefined, new Set());
    refreshHosts();
    showNotice(t("files.host.duplicate.done", { name: host.name, alias }));
  } catch (e) {
    showNotice(
      t("files.host.duplicate.fail", { message: e instanceof Error ? e.message : String(e) }),
    );
  }
}

/** 하나씩 차례로 — 파일 하나에 쓴다 */
export async function duplicateHostsInto(
  items: { name: string; group: string | null }[],
): Promise<void> {
  const claimed = new Set<string>();
  const failed: string[] = [];
  let made = 0;
  for (const item of items) {
    const host = lookupHost(item.name);
    if (!host) {
      failed.push(t("files.host.duplicate.missing", { name: item.name }));
      continue;
    }
    try {
      await duplicateOne(host, item.group, claimed);
      made += 1;
    } catch (e) {
      failed.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refreshHosts();
  if (failed.length > 0)
    showNotice(t("files.host.duplicate.failed", { names: failed.join(" / ") }));
  else if (made > 0) showNotice(t("files.host.duplicate.many", { count: made }));
}

/**
 * 확인은 호스트 트리가 이미 받았다. 하나씩 차례로 지운다 — 겹치면 파일을 서로 덮어쓴다.
 * 팬아웃에는 실제로 지워진 별칭만 넘긴다 — 거절된 호스트의 즐겨찾기까지 치우면 화면과 파일이 어긋난다.
 */
export async function removeHostsAction(names: string[]): Promise<void> {
  const notes: string[] = [];
  const removed: string[] = [];
  for (const name of names) {
    try {
      notes.push(...(await removeHost(name)));
      removed.push(name);
    } catch (e) {
      notes.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refreshHosts();
  await hostsRemoved(removed);
  if (notes.length > 0) showNotice(notes.join(" / "));
}

/**
 * `setHostMeta` 는 완전 교체라 원본 메타를 펼친 뒤 `group` 만 덮어쓴다.
 * 병합값을 넣으면 상속받던 값이 이 블록에 굳는다.
 */
async function assignGroup(name: string, group: string | null): Promise<void> {
  const raw = await getHostMeta(name);
  const current = raw.group?.trim() || null;
  const next = group?.trim() || null;
  if (current === next) return;
  await setHostMeta(name, { ...metaToPatch(raw), group: next });
}

/** 하나씩 차례로 — `sessions.toml` 쓰기는 읽기→수정→쓰기라 동시에 보내면 몇 개가 조용히 안 옮겨진다 */
export async function assignGroupMany(names: string[], group: string | null): Promise<void> {
  const failed: string[] = [];
  for (const name of names) {
    try {
      await assignGroup(name, group);
    } catch (e) {
      failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refreshHosts();
  if (failed.length > 0) showNotice(t("files.host.move.failed", { names: failed.join(" / ") }));
}

/** 확인 다이얼로그를 못 띄웠으면 신뢰 기록을 지우지 않는다 (docs/log/2026-09-16-quick-connect-and-host-keys.md) */
export async function forgetHostKeyFor(host: HostEntry): Promise<void> {
  let go: boolean;
  try {
    go = await askConfirm(t("files.host.forgetkey.confirm", { name: host.name }), {
      title: t("files.host.forgetkey.title"),
      kind: "warning",
      danger: true,
    });
  } catch {
    showNotice(t("files.host.forgetkey.askfail"));
    return;
  }
  if (!go) return;

  try {
    const report = await forgetHostKey(host.name);
    const where = report.port === 22 ? report.host : `${report.host}:${report.port}`;
    showNotice(
      report.removed === 0
        ? t("files.host.forgetkey.none", { where })
        : t("files.host.forgetkey.done", { where, count: report.removed }),
    );
  } catch (e) {
    showNotice(
      t("files.host.forgetkey.fail", { message: e instanceof Error ? e.message : String(e) }),
    );
  }
}

export async function openConfig(): Promise<void> {
  try {
    await openSshConfig();
  } catch (e) {
    showNotice(e instanceof Error ? e.message : String(e));
  }
}
