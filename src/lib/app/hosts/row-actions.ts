// 호스트 **우클릭 메뉴의 나머지** — 복제 · 복사 붙여넣기 · 제거(+ 별칭 팬아웃) · 그룹 옮기기 · 호스트 키 잊기 · config 열기.
// "이름 변경" 은 폼을 거치므로 `form.svelte.ts` 의 `renameHost` 다.
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
 * 복제 한 번의 몸통 — 새 별칭을 정해 `Host` 블록을 덧붙이고 원본 메타를 옮긴다.
 * 새 별칭을 돌려준다. 실패는 **삼키지 않는다** (호출부가 모아서 알린다).
 *
 * `group` 이 주어지면 새 호스트를 그 폴더에 넣는다 (`undefined` 면 원본 그룹 그대로,
 * `null` 이면 홈). `claimed` 는 **이번 묶음에서 이미 집은 별칭들**이다 — `hostCache` 는
 * 파일을 다시 읽기 전까지 갱신되지 않으므로, 여러 개를 잇달아 복제할 때 이것이 없으면
 * 둘째부터 같은 `-copy` 이름을 노려 백엔드의 중복 거부에 걸린다.
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
    // `host_name` 이 비어 있으면(설정에 HostName 이 없던 호스트) 별칭을 hostname 으로 쓴다
    // — ssh 의 기본 동작과 같고, add_host 가 빈 HostName 을 거부하지 않게 한다.
    host_name: host.host_name || host.name,
    user: host.user ?? null,
    port: host.port ?? null,
    identity_file: host.identity_file ?? null,
    // 키를 좁히는 줄도 함께 간다 — **자기 블록 값**만(공용 블록에서 물려받은 것은 복제본도
    // 똑같이 물려받으므로 여기서 굳히면 상속만 끊긴다).
    identities_only: host.identities_only_own === true,
    // 경유 호스트도 함께 간다 — 복제본이 원본과 다른 길로 붙으면 복제가 아니다.
    proxy_jump: host.proxy_jump ?? null,
  });
  const patch = metaToPatch(raw);
  await setHostMeta(alias, group === undefined ? patch : { ...patch, group });
  return alias;
}

/** "복제" — 모달 없이 곧장 `<이름>-copy` 로 복제한다 */
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

/**
 * **복사 붙여넣기** — 호스트들을 복제하고 새 별칭을 각자의 폴더에 넣는다.
 *
 * 목적지 폴더는 항목마다 다를 수 있다 — 폴더를 복사하면 그 안의 하위 구조가 유지되어야
 * 하기 때문이다 (경로 계산은 세션 타일의 몫). 여기서는 계산된 결과를 **하나씩 차례로**
 * 적용한다 (`assignGroupMany` 와 같은 이유: 파일 하나에 쓴다).
 */
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
 * "제거" — 호스트 트리가 이미 확인을 받았으므로 곧장 지운다. `Host` 블록과 메타를 함께 지우고
 * 목록을 다시 읽는다.
 *
 * 여럿을 **하나씩 차례로** 지운다 (`~/.ssh/config` 와 `sessions.toml` 을 읽고 다시 쓰는
 * 조작이라 겹치면 서로를 덮어쓴다).
 *
 * 지운 뒤에는 **그 별칭을 적어 둔 앱 쪽 자리들**을 함께 치운다 — 즐겨찾기·호스트 스니펫·
 * 저장한 레이아웃([`hostsRemoved`]). 확인 대화상자가 그 수를 미리 말했으므로 여기서 다시
 * 묻지 않는다. 팬아웃에 넘기는 것은 **실제로 지워진 별칭뿐**이다: 백엔드가 거절한 호스트는
 * `~/.ssh/config` 에 그대로 남아 있고, 그 별칭의 즐겨찾기까지 치우면 화면과 파일이 어긋난다.
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
 * 호스트 하나의 `group` 한 칸만 바꾼다. `group` 이 `null` 이면 그룹에서 뺀다.
 *
 * `setHostMeta` 패치는 **완전 교체**라 `group` 만 보내면 나머지 칸이 파일에서 지워진다.
 * 그래서 **원본** 메타를 먼저 읽어 `metaToPatch` 로 펼친 뒤 `group` 만 덮어써야 색·태그·
 * 로깅 등이 보존된다. 병합값을 넣으면 상속받던 값이 이 블록에 굳어 상속이 끊긴다.
 */
async function assignGroup(name: string, group: string | null): Promise<void> {
  const raw = await getHostMeta(name);
  const current = raw.group?.trim() || null;
  const next = group?.trim() || null;
  if (current === next) return; // 이미 그 그룹 — 아무 것도 하지 않는다
  await setHostMeta(name, { ...metaToPatch(raw), group: next });
}

/**
 * 여러 호스트의 그룹을 한 번에 (재)지정한다 — 다중 드롭·잘라내기 붙여넣기가 쓰는 길.
 *
 * **하나씩 차례로** 쓴다 (병렬이 아니다): `sessions.toml` 은 파일 하나이고 각 쓰기가
 * 읽기→수정→쓰기라, 동시에 보내면 나중 것이 먼저 것을 덮어써 몇 개는 조용히 옮겨지지
 * 않는다. 재로드는 **끝나고 한 번**이라 목록이 중간 상태로 여러 번 깜빡이지도 않는다.
 */
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

/**
 * "호스트 키 잊기" — 이 호스트의 `known_hosts` 기록을 지운다 (`ssh-keygen -R` 상당 ·
 * docs/log/2026-09-16-quick-connect-and-host-keys.md).
 *
 * 되돌릴 수 없는 조작이라 **먼저 묻는다**. 다이얼로그를 못 띄웠으면 아무 일도 하지 않는다
 * ([`resolveOpenTargets`] 와 같은 규칙 — 확인 없이 신뢰 기록을 지우지 않는다).
 *
 * 지운 뒤에는 **몇 줄을 지웠는지**와 어느 서버였는지를 말한다. 0 줄도 실패가 아니다 —
 * "지울 것이 없었다" 는 사실이고, 그때 사용자가 알아야 하는 것은 자기가 지목한 별칭이
 * 실제로는 어느 `host:port` 였는가다 (그래서 그 값을 문구에 싣는다).
 */
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
