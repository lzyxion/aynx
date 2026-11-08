<script lang="ts">
  // 앨범 멤버 행 묶음 — [새 앨범] 2절과 [앨범 권한] 패널이 함께 쓴다(목업 V3NewAlbum 2절 · V3Album 오른쪽 패널). 행 하나 = 아바타 · 이름과
  // "CLI · 모델 · 종류" · 허용 명령 칩 · 등급 세그먼트(판정형은 수락 규칙) · 빼기. 넓으면 한 줄, 좁으면(패널) 세그먼트가 아래로 내려간다.
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ArtistProfile } from "../artist-form";
  import type { AlbumAccept, AlbumMemberInput } from "../album-draft";
  import type { AlbumConfigView } from "../album-permissions";
  import ArtistAvatar from "./ArtistAvatar.svelte";

  let { members = $bindable(), accept = $bindable(), adding = $bindable(false), artists, original = null, tag = "new", rework = true, onchange = () => {}, status = () => "" }: {
    members: AlbumMemberInput[]; accept: AlbumAccept; adding?: boolean; artists: ArtistProfile[];
    original?: AlbumConfigView | null; tag?: string;
    /** 되돌림 한도 칸을 여기서 그린다(새 앨범은 4절 '한도 · 기타' 로 옮긴다). */
    rework?: boolean; onchange?: () => void; status?: (id: string) => string;
  } = $props();
  let commandDrafts = $state<Record<string, string>>({});
  let editing = $state<string | null>(null);
  const GRADES = ["read", "edit", "full"] as const;
  const gradeKey = (grade: string) => grade === "read" ? "orch.new.grade.read" : grade === "edit" ? "orch.config.perm.edit" : "orch.config.perm.full";
  const cliName = (cli: string) => cli === "claude" ? "Claude" : cli === "codex" ? "Codex" : cli;
  const meta = (a: ArtistProfile | undefined) => a ? [cliName(a.cli), a.model, t(a.kind === "judge" ? "orch.kind.judge" : "orch.kind.write")].filter(Boolean).join(" · ") : "";
  const data = (name: string, value: string | boolean = "") => ({ [`data-${tag}-${name}`]: value });
  function toggle(id: string) {
    if (members.some((m) => m.artist === id)) {
      members = members.filter((m) => m.artist !== id);
      accept.require = accept.require.filter((r) => r.role !== id);
    } else {
      const judge = artists.find((a) => a.id === id)?.kind === "judge";
      members = [...members, { artist: id, grade: judge ? "read" : "edit", allowedCommands: [] }];
      if (judge) accept.require = [...accept.require, { role: id, passes: 1 }];
      adding = false;
    }
    onchange();
  }
  function addCommand(id: string) {
    const member = members.find((m) => m.artist === id);
    const text = commandDrafts[id]?.trim();
    commandDrafts[id] = "";
    if (member && text && !member.allowedCommands.includes(text)) { member.allowedCommands = [...member.allowedCommands, text]; onchange(); }
  }
  function focusOnMount(node: HTMLInputElement) { node.focus(); }
</script>

<div class="members" {...data("members")}>
  {#each members as m (m.artist)}
    {@const a = artists.find((a) => a.id === m.artist)}
    {@const name = a?.name ?? original?.members.find((o) => o.artist === m.artist)?.name ?? m.artist}
    {@const before = original?.members.find((o) => o.artist === m.artist)}
    {@const passes = accept.require.find((r) => r.role === m.artist)?.passes ?? 0}
    {@const changed = !!original && (JSON.stringify(before && { artist: before.artist, grade: before.grade, allowedCommands: before.allowedCommands }) !== JSON.stringify(m) || original.accept.require.find((r) => r.role === m.artist)?.passes !== accept.require.find((r) => r.role === m.artist)?.passes)}
    {@const judge = a?.kind === "judge"}
    <div class="member" class:changed class:judge {...data("member", m.artist)} data-perm-changed={changed ? "" : undefined}>
      <span class="av"><ArtistAvatar cli={a?.cli ?? ""} profile={a} size={40} /></span>
      <div class="main">
        <div class="line"><b>{name}</b><span class="meta">{meta(a)}</span>
          {#if changed}<span class="state change">{before ? before.grade !== m.grade ? `${t(gradeKey(before.grade))} → ${t(gradeKey(m.grade))}` : t("orch.perm.modified") : t("orch.perm.added")}</span>
          {:else if status(m.artist)}<span class="state">{status(m.artist)}</span>{/if}
        </div>
        {#if judge}
          <span class="sub">{t("orch.new.judge")}</span>
        {:else if a?.cli === "codex" && !m.allowedCommands.length}
          <span class="sub" title={t("orch.new.codexCommands")}>{t("orch.new.noCommands")}</span>
        {:else}
          <div class="cmds">
            {#each m.allowedCommands as cmd}<button type="button" class="cmd" title={t("orch.new.removeCommand")} aria-label={`${t("orch.new.removeCommand")}: ${cmd}`} onclick={() => { m.allowedCommands = m.allowedCommands.filter((s) => s !== cmd); onchange(); }}>{cmd}<span class="x" aria-hidden="true">×</span></button>{/each}
            {#if editing === m.artist}
              <input class="cmd-input" aria-label={t("orch.new.commands")} placeholder={t("orch.new.commands")} {...data("command", m.artist)} bind:value={commandDrafts[m.artist]} use:focusOnMount
                onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCommand(m.artist); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); commandDrafts[m.artist] = ""; editing = null; } }}
                onblur={() => { addCommand(m.artist); editing = null; }} />
            {:else}
              <button type="button" class="cmd add" {...data("command-add", m.artist)} onclick={() => (editing = m.artist)}>{t("orch.new.addCommand")}</button>
            {/if}
            {#if a?.cli === "codex"}<span class="sub">{t("orch.new.codexCommands")}</span>{/if}
          </div>
        {/if}
      </div>
      <div class="ctl">
        {#if judge}
          <label class="passes"><span>{t("orch.new.passes.before")}</span><input type="number" min="0" max="3" title={t("orch.new.passes")} aria-label={t("orch.new.passes")} {...data("passes", m.artist)} value={passes}
            oninput={(e) => { const n = Number(e.currentTarget.value); accept.require = [...accept.require.filter((r) => r.role !== m.artist), ...(n ? [{ role: m.artist, passes: n }] : [])]; onchange(); }} /><span>{t("orch.new.passes.after")}</span></label>
        {:else}
          <div class="seg" role="group" aria-label={t("orch.new.permission")}>
            {#each GRADES as grade}<button type="button" aria-pressed={m.grade === grade} {...data("grade", grade)} onclick={() => { m.grade = grade; onchange(); }}>{t(gradeKey(grade))}</button>{/each}
          </div>
        {/if}
      </div>
      <button type="button" class="remove" aria-label={t("orch.new.removeArtist", { name })} title={t("orch.new.removeArtist", { name })} onclick={() => toggle(m.artist)}>✕</button>
    </div>
  {/each}
  {#each original?.members.filter((o) => !members.some((m) => m.artist === o.artist)) ?? [] as removed (removed.artist)}<p class="removed" data-perm-removed={removed.artist}>{removed.name} · {t("orch.perm.removed")}</p>{/each}
  {#if tag !== "new"}
    <button type="button" class="add-row" data-perm-add aria-expanded={adding} onclick={() => (adding = !adding)}><span class="plus" aria-hidden="true">+</span>{t("orch.perm.addArtist")}</button>
  {/if}
  {#if adding}
    <div class="pick">
      {#each artists.filter((a) => !members.some((m) => m.artist === a.id)) as a (a.id)}<button type="button" class="pick-chip" disabled={members.length >= 8} {...data("artist", a.id)} onclick={() => toggle(a.id)}><ArtistAvatar cli={a.cli} profile={a} size={22} />{a.name}</button>{:else}<span class="sub">{t("orch.artists.empty")}</span>{/each}
    </div>
  {/if}
  {#if !artists.length && !adding}<p class="sub">{t("orch.artists.empty")}</p>{/if}
  {#if rework}<label class="rework" class:changed={!!original && JSON.stringify(original.accept) !== JSON.stringify(accept)}><span>{t("orch.new.rework")}</span><input type="number" min="0" max="10" {...data("rework")} bind:value={accept.maxRework} oninput={onchange} /></label>{/if}
</div>

<style>
  .members { container-type: inline-size; display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: var(--t-sm); }
  /* 넓을 때 = 목업 V3NewAlbum 2절: 아바타 | 이름·명령 | 세그먼트 | ✕ 한 줄 */
  .member { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto 28px; grid-template-areas: "av main ctl x"; align-items: center; gap: 12px; padding: 10px; border-radius: var(--radius-surface-inner); background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface-hover)); }
  .av { grid-area: av; display: flex; }
  .judge .av :global(.avatar) { box-shadow: 0 0 0 2px var(--tertiary); }
  .main { grid-area: main; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .ctl { grid-area: ctl; }
  .remove { grid-area: x; justify-self: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: var(--fg-3); font: inherit; cursor: pointer; }
  .remove:hover { background: var(--control-ghost-hover); color: var(--fg-1); }
  .line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
  .line b { color: var(--fg-1); }
  .meta, .sub { font-size: var(--t-xs); color: var(--fg-3); overflow-wrap: anywhere; }
  .state { margin-left: auto; font-size: var(--t-xs); color: var(--fg-3); }
  .state.change { color: var(--warn); font-weight: 600; }
  .cmds { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .cmd { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid transparent; border-radius: 999px; background: var(--control-bg); color: var(--fg-1); font-family: var(--font-mono); font-size: 11px; cursor: pointer; }
  .cmd .x { color: var(--fg-3); }
  .cmd:hover { background: var(--control-bg-hover); }
  .cmd.add { background: transparent; border: 1px dashed var(--line-strong); color: var(--fg-2); font-family: var(--font-ui); }
  .cmd-input { width: 180px; max-width: 100%; height: 22px; padding: 0 10px; border: 1px solid var(--focus-border); border-radius: 999px; background: var(--surface-field); color: var(--fg-1); font-family: var(--font-mono); font-size: 11px; outline: none; }
  /* 등급 = 한 알약 묶음 세그먼트, 고른 칸만 채운다 */
  .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface-field); }
  .seg button { padding: 4px 10px; border: 0; border-radius: 999px; background: transparent; color: var(--fg-2); font: inherit; font-size: var(--t-xs); white-space: nowrap; cursor: pointer; }
  .seg button:hover { background: var(--control-ghost-hover); }
  .seg button[aria-pressed="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); }
  .seg button:disabled { cursor: default; opacity: .5; }
  .passes { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--fg-2); white-space: nowrap; }
  .passes input, .rework input { width: 46px; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-field); color: var(--fg-1); font: inherit; font-weight: 700; text-align: center; outline: none; }
  .passes input:focus, .rework input:focus, .cmd-input:focus { border-color: var(--focus-border); }
  /* 바뀐 행(앨범 권한) — 따뜻한 판 · 고른 칸도 따뜻한 색 */
  .changed { background: var(--warn-soft); box-shadow: inset 0 0 0 1px var(--warn); }
  .member.changed .seg button[aria-pressed="true"] { background: var(--warn); color: var(--bg-base); font-weight: 700; }
  .removed { margin: 0; padding: 8px 12px; border-radius: var(--radius-md); font-size: var(--t-xs); color: var(--fg-2); }
  .add-row { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px dashed var(--line-strong); border-radius: var(--radius-surface-inner); background: transparent; color: var(--fg-2); font: inherit; text-align: left; cursor: pointer; }
  .add-row:hover { background: var(--control-ghost-hover); }
  .plus { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--control-bg); color: var(--fg-1); font-size: 16px; }
  .pick { display: flex; flex-wrap: wrap; gap: 6px; }
  .pick-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 4px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--fg-1); font: inherit; font-size: var(--t-xs); cursor: pointer; }
  .pick-chip:hover:not(:disabled) { background: var(--control-ghost-hover); }
  .pick-chip:disabled { opacity: .5; cursor: default; }
  .rework { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; padding: 4px 8px; border-radius: var(--radius-md); font-size: var(--t-xs); color: var(--fg-2); }
  /* 좁을 때(앨범 권한 패널 · 폰) = 목업 V3Album 패널: 이름 줄 위, 세그먼트 아래 */
  @container (max-width: 520px) {
    .member { grid-template-columns: 32px minmax(0, 1fr) 28px; grid-template-areas: "av main x" "ctl ctl ctl"; gap: 8px 10px; }
    .av :global(.avatar) { width: 32px !important; height: 32px !important; }
    .ctl { justify-self: start; }
  }
</style>
