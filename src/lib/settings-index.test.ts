import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";
import {
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  settingPath,
  settingSearchText,
  type SettingsSectionId,
} from "$lib/settings-index";
import type { Key } from "$lib/i18n/keys";

/**
 * 설정 색인 (docs/log/2026-09-25-palette.md) — 표가 **실제 화면과 어긋나지 않는지**.
 *
 * 타입이 키 오타는 이미 막는다(`Key`). 여기서 보는 것은 타입이 못 보는 셋이다: 사전 두 벌에
 * 값이 있는가, 섹션 id 가 설정 화면의 목록에 있는가, anchor 가 **그 섹션의 컴포넌트 파일에**
 * 실제 id 로 적혀 있는가(누가 줄의 id 를 바꾸면 팔레트의 설정 줄이 조용히 섹션 맨 위에 선다).
 */

/** `"ns.rest"` → 사전 값 */
function lookup(dict: Record<string, Record<string, string>>, key: Key): string | undefined {
  const dot = key.indexOf(".");
  return dict[key.slice(0, dot)]?.[key.slice(dot + 1)];
}

/** 섹션 id → 그 섹션을 그리는 컴포넌트 파일 (`SettingsModal` 의 `<section>` 배치 그대로) */
const SECTION_FILE: Record<SettingsSectionId, string> = {
  general: "GeneralSection",
  credentials: "CredentialsSection",
  theme: "AppThemeSection",
  terminal: "TerminalSection",
  notifications: "NotificationsSection",
  keys: "KeybindingsSection",
  snippets: "SnippetsSection",
  triggers: "TriggersSection",
  ai: "McpSection",
  mcp: "McpManager",
  instructions: "InstructionsSection",
  automation: "AutomationSection",
  remote: "RemoteSection",
};

/** 섹션이 품은 하위 컴포넌트 — 그 줄들의 id 는 이 파일들에 적힌다 (알림 › 메신저) */
const SECTION_CHILDREN: Partial<Record<SettingsSectionId, string[]>> = {
  theme: ["AvatarsSection"],
  notifications: ["MessengerSettings", "MessengerChannel"],
  mcp: ["ExternalMcpServers", "McpSessionsView"],
};

function sectionSource(id: SettingsSectionId): string {
  return [SECTION_FILE[id], ...(SECTION_CHILDREN[id] ?? [])]
    .map((file) => readFileSync(fileURLToPath(new URL(`./settings/${file}.svelte`, import.meta.url)), "utf-8"))
    .join("\n");
}

describe("설정 색인", () => {
  const sectionIds = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));

  it("섹션 목록이 SettingsModal 의 <section> 과 같다", () => {
    const modal = readFileSync(
      fileURLToPath(new URL("./SettingsModal.svelte", import.meta.url)),
      "utf-8",
    );
    const drawn = [...modal.matchAll(/<section hidden=\{activeTab !== "([a-z]+)"\}>/g)].map((m) => m[1]);
    expect(drawn).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
  });

  it("내비 순서 = 네 묶음, 구분선은 묶음 경계에만 (docs/log/2026-09-30-settings-nav-order.md)", () => {
    const groups: string[][] = [];
    for (const s of SETTINGS_SECTIONS) {
      if (groups.length === 0 || ("dividerBefore" in s && s.dividerBefore)) groups.push([]);
      groups[groups.length - 1].push(s.id);
    }
    expect(groups).toEqual([
      ["theme", "general", "keys"],
      ["terminal", "snippets", "triggers"],
      ["ai", "mcp", "instructions", "automation", "notifications"],
      ["credentials", "remote"],
    ]);
    // 첫 칸 위에는 선을 긋지 않는다 · 설정을 처음 열면 첫 칸(테마)이다
    expect("dividerBefore" in SETTINGS_SECTIONS[0]).toBe(false);
    expect(SETTINGS_SECTIONS[0].id).toBe("theme");
  });

  it("색인의 섹션 줄 · 손잡이 줄이 내비 순서를 따른다 (팔레트 결과 순서)", () => {
    const order = SETTINGS_SECTIONS.map((s) => s.id as string);
    const firstSeen: string[] = [];
    for (const e of SETTINGS_INDEX.filter((x) => x.anchor)) {
      if (firstSeen[firstSeen.length - 1] !== e.section) firstSeen.push(e.section);
    }
    // 섹션마다 한 덩어리로 모여 있고, 그 덩어리들이 내비 순서다
    expect(new Set(firstSeen).size).toBe(firstSeen.length);
    expect(firstSeen).toEqual(order.filter((id) => firstSeen.includes(id)));
  });

  it("모든 항목의 섹션 id 가 목록에 있다", () => {
    for (const e of SETTINGS_INDEX) expect(sectionIds.has(e.section), e.section).toBe(true);
  });

  it("모든 문구 키가 ko·en 사전에 있다", () => {
    const keys: Key[] = [
      ...SETTINGS_SECTIONS.map((s) => s.labelKey),
      ...SETTINGS_INDEX.flatMap((e) => [e.groupKey, e.labelKey].filter((k): k is Key => !!k)),
    ];
    for (const k of keys) {
      expect(lookup(ko, k), `ko ${k}`).toBeTruthy();
      expect(lookup(en, k), `en ${k}`).toBeTruthy();
    }
  });

  it("anchor 가 그 섹션 파일에 id 로 적혀 있다", () => {
    for (const e of SETTINGS_INDEX) {
      if (!e.anchor) continue;
      const src = sectionSource(e.section);
      // 목록을 돌며 그리는 줄(AI 에이전트 블록)은 id 를 글자로 적지 않는다 — 에이전트 블록 안 줄은
      // `agentAnchor(agent.id, "<part>")` 호출이, 에이전트만의 스위치는 표에 적힌 `"<id>"` 글자가 그 자리다.
      const part = /^ai-(agent|enabled|mcp|hooks|args)-[a-z]+$/.exec(e.anchor)?.[1];
      const found =
        src.includes(`id="${e.anchor}"`) ||
        src.includes(`for="${e.anchor}"`) ||
        (part !== undefined && src.includes(`agentAnchor(agent.id, "${part}")`)) ||
        src.includes(`domId: "${e.anchor}"`);
      expect(found, `${e.section} › ${e.anchor}`).toBe(true);
    }
  });

  it("메신저 규칙 줄은 채널이 없어 숨을 때 채널 상자로 떨어진다 (data-anchor-for)", () => {
    // 규칙 줄은 `{#if}` 안이라 채널이 하나도 없으면 요소가 없다 — 색인의 그 줄들은 전부 `RULE_ANCHORS` 에 있어야 한다
    const src = readFileSync(
      fileURLToPath(new URL("./settings/MessengerSettings.svelte", import.meta.url)),
      "utf-8",
    );
    const list = /const RULE_ANCHORS = \[([\s\S]*?)\]/.exec(src)?.[1] ?? "";
    const fallback = new Set([...list.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
    expect(src).toContain("data-anchor-for={anyConnected ? undefined : RULE_ANCHORS}");
    const messengerRows = SETTINGS_INDEX.filter(
      (e) => e.section === "notifications" && e.anchor?.startsWith("messenger-") && !e.anchor.startsWith("messenger-channel-"),
    );
    expect(messengerRows.length).toBeGreaterThan(0);
    for (const e of messengerRows) expect(fallback.has(e.anchor!), e.anchor).toBe(true);
  });

  it("섹션마다 섹션 줄이 하나 · (섹션, anchor) 는 겹치지 않는다", () => {
    const seen = new Set<string>();
    for (const e of SETTINGS_INDEX) {
      const k = `${e.section}:${e.anchor ?? ""}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    for (const s of SETTINGS_SECTIONS) expect(seen.has(`${s.id}:`), s.id).toBe(true);
  });

  it("이름 줄은 anchor 를 갖고, 섹션 줄은 이름이 없다", () => {
    for (const e of SETTINGS_INDEX) expect(!!e.labelKey, `${e.section}:${e.anchor}`).toBe(!!e.anchor);
  });

  it("경로 = 섹션 · (소제목) · 이름, 검색 글자에 영문 anchor 가 풀려 들어간다", () => {
    const tr = (k: Key) => lookup(ko, k) ?? k;
    const bell = SETTINGS_INDEX.find((e) => e.anchor === "bell")!;
    expect(settingPath(bell, tr)).toEqual(["터미널", "벨"]);
    const dim = SETTINGS_INDEX.find((e) => e.anchor === "wp-dim")!;
    expect(settingPath(dim, tr)).toEqual(["테마", "월페이퍼", "어둡게"]);
    const webgl = SETTINGS_INDEX.find((e) => e.anchor === "term-webgl")!;
    expect(settingSearchText(webgl, tr)).toContain("term webgl");
    const args = SETTINGS_INDEX.find((e) => e.anchor === "ai-args-claude")!;
    expect(settingPath(args, tr)).toEqual(["AI 에이전트", "Claude Code", "추가 인자"]);
    const mcp = SETTINGS_INDEX.find((e) => e.anchor === "ai-mcp-sessions")!;
    expect(SETTINGS_INDEX.some((e) => e.anchor === "ai-mcp-claude" || e.anchor === "ai-mcp-codex")).toBe(false);
    expect(mcp.section).toBe("mcp");
    expect(args.section).toBe("ai");
    expect(settingPath(mcp, tr)[0]).toBe("MCP");
    // 아바타는 왼쪽 메뉴 칸이 아니라 테마의 하위 화면이다(docs/log/2026-10-31-avatars.md 4절)
    expect(sectionIds.has("avatars")).toBe(false);
    const claudeAvatar = SETTINGS_INDEX.find((e) => e.anchor === "avatar-claude")!;
    expect(settingPath(claudeAvatar, tr)).toEqual(["테마", "아바타", "Claude Code"]);
    const keys = SETTINGS_INDEX.find((e) => e.section === "keys" && !e.anchor)!;
    expect(settingPath(keys, tr)).toEqual(["단축키"]);
  });

  it("색인이 쓸 만한 크기다 (섹션 아홉 + 손잡이 마흔 이상)", () => {
    expect(SETTINGS_INDEX.filter((e) => !e.anchor)).toHaveLength(SETTINGS_SECTIONS.length);
    expect(SETTINGS_INDEX.filter((e) => e.anchor).length).toBeGreaterThanOrEqual(40);
  });
});
