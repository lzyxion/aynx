import { describe, expect, it, vi } from "vitest";
import { translate } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";

vi.mock("$lib/i18n/i18n.svelte.js", async () => {
  const { translate: tr } = await import("$lib/i18n/dict");
  return { t: (key: Key, p?: Record<string, string | number>) => tr("ko", key, p) };
});

import {
  chatPermKindText,
  chatPermView,
  chatTileErrorText,
  chatTileNoticeText,
  mcpArgsText,
  rewindActionKey,
  rewindCardLines,
  rewindCliLine,
  rewindConfirmKey,
  rewindErrorText,
  rewindPinnedKey,
  rewindRetryable,
  rewindScopeKey,
  rewindTitleKey,
  rewindTraceText,
  sessionAllowLabel,
  shortDetail,
  unifiedRows,
} from "./chat-tile-text";
import type { ChatTileRewindAsk, ChatTileRewindEv } from "./chat-tile-rewind";
import { pane as koPane } from "$lib/i18n/ko/pane";

const ko = (key: Key, p?: Record<string, string | number>) => translate("ko", key, p);

describe("chatTileErrorText", () => {
  it("이유 코드 → 문구", () => {
    expect(chatTileErrorText(new Error("[conversation-busy] open in another tile"))).toBe(ko("pane.chatTile.err.busy"));
    expect(chatTileErrorText("[chat-tile-off] chat tiles are off")).toBe(ko("pane.chatTile.err.off"));
    expect(chatTileErrorText("[bad-cwd] not a folder")).toBe(ko("pane.chatTile.err.cwd"));
    expect(chatTileErrorText("[cli-not-found] claude.exe")).toBe(ko("pane.chatTile.err.notFound"));
    expect(chatTileErrorText("[start-timeout] slow")).toBe(ko("pane.chatTile.err.timeout"));
    expect(chatTileErrorText("[server-outdated] needs 38")).toBe(ko("pane.chatTile.err.outdated"));
  });

  it("대화 열기 거절 · 첨부 판정 → 문구", () => {
    const table: [string, Key][] = [
      ["conversation-in-side-chat", "pane.chatTile.err.inSideChat"],
      ["conversation-not-found", "pane.chatTile.err.convNotFound"],
      ["conversation-folder-missing", "pane.chatTile.err.folderMissing"],
      ["too-many-attachments", "app.chatDock.err.tooMany"],
      ["too-many-images", "app.chatDock.err.tooMany"],
      ["file-too-big", "app.chatDock.err.tooBig"],
      ["image-too-big", "app.chatDock.err.tooBig"],
      ["file-outside", "app.chatDock.err.attachment"],
      ["file-missing", "app.chatDock.err.attachment"],
      ["file-not-file", "app.chatDock.err.attachment"],
      ["image-outside", "app.chatDock.err.attachment"],
      ["image-missing", "app.chatDock.err.attachment"],
      ["image-not-file", "app.chatDock.err.attachment"],
      ["image-type", "app.chatDock.err.attachment"],
    ];
    for (const [reason, key] of table) expect(chatTileErrorText(`[${reason}] server text`)).toBe(ko(key));
  });

  it("권한 모드 · 결정 거절 넷 → 문구", () => {
    expect(chatTileErrorText("[bad-mode] this permission mode cannot be chosen here")).toBe(ko("pane.chatTile.err.mode"));
    expect(chatTileErrorText("[bad-answer] x")).toBe(ko("pane.chatTile.err.answer"));
    expect(chatTileErrorText(new Error("[no-session-allow] x"))).toBe(ko("pane.chatTile.err.noSessionAllow"));
    expect(chatTileErrorText("[unsupported] x")).toBe(ko("pane.chatTile.err.unsupported"));
  });

  it("모르는 이유는 표지만 떼고 서버 글 그대로", () => {
    expect(chatTileErrorText(new Error("[session-gone] chat tile is gone"))).toBe("chat tile is gone");
    expect(chatTileErrorText("plain failure")).toBe("plain failure");
  });
});

describe("chatTileNoticeText", () => {
  it("needs-terminal = 터미널 모양 안내(도구 이름을 싣는다)", () => {
    expect(chatTileNoticeText("needs-terminal", "AskUserQuestion")).toBe(ko("pane.chatTile.notice.needsTerminal", { detail: "AskUserQuestion" }));
  });

  it("아는 낱말 · 대화 바뀜은 그리지 않음 · 모르는 낱말은 그대로", () => {
    expect(chatTileNoticeText("mcp-locked", "tavily")).toBe(ko("pane.chatTile.notice.mcpLocked", { detail: "tavily" }));
    expect(chatTileNoticeText("handshake-failed", null)).toBe(ko("pane.chatTile.notice.handshake"));
    expect(chatTileNoticeText("conversation-changed", "x")).toBeNull();
    expect(chatTileNoticeText("brand-new", "d")).toBe("brand-new: d");
    expect(chatTileNoticeText("brand-new", null)).toBe("brand-new");
  });

  it("set-mode-failed = CLI 의 실패 낱말을 싣는다", () => {
    expect(chatTileNoticeText("set-mode-failed", "auto_mode_model")).toBe(ko("pane.chatTile.notice.modeFailed", { detail: "auto_mode_model" }));
  });

  it("압축 — 도는 중 · 끝(압축 전 수만 · 없음) · 실패 · 멈춤", () => {
    expect(chatTileNoticeText("compacting", "manual")).toBe(ko("pane.chatTile.compact.running"));
    expect(chatTileNoticeText("compacted", "36241>8335")).toBe(ko("pane.chatTile.compact.doneTokens", { pre: "36.2k" }));
    expect(chatTileNoticeText("compacted", "36241>8335")).toBe("맥락을 압축했습니다 — 압축 전 36.2k 토큰");
    expect(chatTileNoticeText("compacted", "39200>")).toBe("맥락을 압축했습니다 — 압축 전 39.2k 토큰");
    expect(chatTileNoticeText("compacted", "25200>27700")).not.toContain("27.7k");
    expect(chatTileNoticeText("compact-canceled", null)).toBe("압축을 중지했습니다");
    expect(chatTileNoticeText("compacted", ">8335")).toBe(ko("pane.chatTile.compact.done"));
    expect(chatTileNoticeText("compacted", "")).toBe(ko("pane.chatTile.compact.done"));
    expect(chatTileNoticeText("compacted", null)).toBe(ko("pane.chatTile.compact.done"));
    expect(chatTileNoticeText("compact-failed", "Not enough messages to compact.")).toBe(
      ko("pane.chatTile.compact.failed", { detail: "Not enough messages to compact." }),
    );
  });
});

describe("chatTileErrorText — 압축 · 스킬", () => {
  it("새 이유 → 문구", () => {
    const table: [string, Key][] = [
      ["turn-running", "pane.chatTile.err.turnRunning"],
      ["not-started", "pane.chatTile.err.notStarted"],
      ["nothing-to-compact", "pane.chatTile.err.nothingToCompact"],
      ["bad-skill", "pane.chatTile.err.skill"],
      ["bad-instructions", "pane.chatTile.err.instructions"],
    ];
    for (const [reason, key] of table) expect(chatTileErrorText(new Error(`[${reason}] server text`))).toBe(ko(key));
  });
});

describe("되감기 문구", () => {
  const A = "30b5bc5c-33b6-47d1-802c-c06d0d28a93a";
  const pv = (over: Partial<ChatTileRewindEv> = {}): ChatTileRewindEv => ({
    t: "rewind",
    phase: "preview",
    anchor: A,
    scope: "files",
    can: true,
    files: [],
    moreFiles: 0,
    insertions: null,
    deletions: null,
    turns: null,
    skippedLinks: null,
    error: null,
    ...over,
  });
  const ask = (over: Partial<ChatTileRewindAsk> = {}): ChatTileRewindAsk => ({
    anchor: A,
    scope: "files",
    quote: "고쳐 줘",
    text: "고쳐 줘",
    localTurns: null,
    localFiles: null,
    phase: "ready",
    preview: null,
    error: null,
    filesDone: false,
    compacted: false,
    ...over,
  });
  const keys = (a: ChatTileRewindAsk, cli: "claude" | "codex") => rewindCardLines(a, cli).map((l) => l.key.replace("pane.chatTile.", ""));

  it("새 이유 일곱 → 문구", () => {
    const table: [string, Key][] = [
      ["bad-anchor", "pane.chatTile.rewind.err.bad"],
      ["bad-scope", "pane.chatTile.rewind.err.bad"],
      ["nothing-to-rewind", "pane.chatTile.rewind.err.nothing"],
      ["preview-first", "pane.chatTile.rewind.err.previewFirst"],
      ["rewind-running", "pane.chatTile.rewind.err.running"],
      ["rewind-timeout", "pane.chatTile.rewind.err.timeout"],
      ["rewind-failed", "pane.chatTile.rewind.err.failed"],
    ];
    for (const [reason, key] of table) expect(chatTileErrorText(new Error(`[${reason}] server text`))).toBe(ko(key));
    expect(chatTileErrorText("[rewind-timeout]")).toBe(ko("pane.chatTile.rewind.err.timeout"));
  });

  it("loading — Claude 파일 · both 는 파일 확인 · 대화 범위와 Codex 는 대화 확인", () => {
    expect(keys(ask({ phase: "loading", scope: "files" }), "claude")).toEqual(["rewind.files.loading"]);
    expect(keys(ask({ phase: "loading", scope: "both" }), "claude")).toEqual(["rewind.files.loading"]);
    expect(keys(ask({ phase: "loading", scope: "conversation" }), "claude")).toEqual(["rewind.convo.loading"]);
    expect(keys(ask({ phase: "loading", scope: "conversation" }), "codex")).toEqual(["rewind.convo.loading"]);
  });

  it("Claude files — 파일 ≥ 1 · 0 · 줄 수 모름", () => {
    const two = ask({ preview: pv({ files: ["src/a.ts", "README.md"], insertions: 12, deletions: 3 }) });
    expect(keys(two, "claude")).toEqual(["rewind.files.count", "rewind.files.keepConvo", "rewind.files.onlyTracked"]);
    expect(rewindCardLines(two, "claude")[0].vars).toEqual({ n: 2, ins: 12, del: 3 });
    expect(keys(ask({ preview: pv({ files: ["a"], moreFiles: 4 }) }), "claude")).toEqual(["rewind.files.countNoLines", "rewind.files.keepConvo", "rewind.files.onlyTracked"]);
    expect(rewindCardLines(ask({ preview: pv({ files: ["a"], moreFiles: 4 }) }), "claude")[0].vars).toEqual({ n: 5 });
    expect(keys(ask({ preview: pv() }), "claude")).toEqual(["rewind.files.none", "rewind.files.keepConvo"]);
    expect(ko("pane.chatTile.rewind.files.onlyTracked")).toBe("Claude의 편집 도구가 건드린 파일을 그때 내용으로 되돌립니다 — 그 뒤 누가 고쳤든 사라집니다");
  });

  it("Claude both — 파일 줄 다음 대화 문장 · keepConvo 없음", () => {
    expect(keys(ask({ scope: "both", preview: pv({ scope: "both", files: ["a"], insertions: 1, deletions: 0 }) }), "claude")).toEqual([
      "rewind.files.count",
      "rewind.files.onlyTracked",
      "rewind.convo.claude",
    ]);
    expect(keys(ask({ scope: "both", preview: pv({ scope: "both" }) }), "claude")).toEqual(["rewind.files.none", "rewind.convo.claude"]);
    expect(ko("pane.chatTile.rewind.convo.claude")).toBe("이 메시지와 그 뒤의 대화를 지웁니다 — Claude는 그 부분을 잊습니다");
  });

  it("Claude conversation — 수 없음 · 대화 문장 · 파일은 그대로", () => {
    expect(keys(ask({ scope: "conversation", localTurns: 3, preview: pv({ scope: "conversation" }) }), "claude")).toEqual(["rewind.convo.claude", "rewind.convo.claudeFilesStay"]);
  });

  it("Claude !can — 체크포인트 글 둘은 noCheckpoint 하나 · 모르는 글은 cliSaid 를 뒤에 · both 는 대화만 안내", () => {
    for (const error of ["File rewinding is not enabled.", "No file checkpoint found for this message."]) {
      expect(keys(ask({ preview: pv({ can: false, error }) }), "claude")).toEqual(["rewind.files.noCheckpoint"]);
    }
    const odd = ask({ preview: pv({ can: false, error: "disk full" }) });
    expect(keys(odd, "claude")).toEqual(["rewind.files.noCheckpoint", "rewind.cliSaid"]);
    expect(rewindCardLines(odd, "claude")[1].vars).toEqual({ detail: "disk full" });
    expect(keys(ask({ scope: "both", preview: pv({ scope: "both", can: false, error: "No file checkpoint found for this message." }) }), "claude")).toEqual([
      "rewind.files.noCheckpoint",
      "rewind.both.convoOnly",
    ]);
  });

  it("Codex can — 수(미리 보기 ?? 받은 쪽 셈 · 둘 다 없으면 모름) · forget · filesStay · filesHint(목록 있을 때) · git 안내", () => {
    const c = (o: Partial<ChatTileRewindAsk>, p: Partial<ChatTileRewindEv> = {}) => ask({ scope: "conversation", ...o, preview: pv({ scope: "conversation", ...p }) });
    expect(keys(c({ localFiles: ["src/a.ts"] }, { turns: 9 }), "codex")).toEqual([
      "rewind.convo.count",
      "rewind.convo.forget",
      "rewind.convo.filesStay",
      "rewind.convo.filesHint",
      "rewind.convo.codexFiles",
    ]);
    expect(rewindCardLines(c({ localTurns: 2 }, { turns: 9 }), "codex")[0].vars).toEqual({ n: 9 });
    expect(rewindCardLines(c({ localTurns: 2 }), "codex")[0].vars).toEqual({ n: 2 });
    expect(keys(c({ localFiles: [] }), "codex")).toEqual(["rewind.convo.countUnknown", "rewind.convo.forget", "rewind.convo.filesStay", "rewind.convo.codexFiles"]);
    expect(ko("pane.chatTile.rewind.convo.codexFiles")).toBe("Codex는 파일을 되돌리지 않습니다 — 필요하면 git으로 되돌리세요");
    for (const l of rewindCardLines(c({ localFiles: ["x"] }), "codex")) expect(ko(l.key, l.vars)).not.toContain("터미널");
  });

  it("Codex !can — cannot + 이유", () => {
    const k = ask({ scope: "conversation", preview: pv({ scope: "conversation", can: false, error: "turn not found" }) });
    expect(keys(k, "codex")).toEqual(["rewind.convo.cannot", "rewind.err.turnNotFound"]);
  });

  it("미리 보기 없음(오류 뒤) → 본문 없음", () => {
    expect(rewindCardLines(ask(), "claude")).toEqual([]);
  });

  it("CLI 거절 낱말 → 문구", () => {
    const k = (e: string, compacted = false) => rewindCliLine(e, compacted).key;
    expect(k("File rewinding is not enabled.")).toBe("pane.chatTile.rewind.files.noCheckpoint");
    expect(k("No file checkpoint found for this message.")).toBe("pane.chatTile.rewind.files.noCheckpoint");
    expect(k("stale_target")).toBe("pane.chatTile.rewind.err.failed");
    expect(k("target_not_found")).toBe("pane.chatTile.rewind.err.failed");
    expect(k("stale_target", true)).toBe("pane.chatTile.rewind.err.beforeCompact");
    expect(k("target_not_found", true)).toBe("pane.chatTile.rewind.err.beforeCompact");
    expect(k("turn_running")).toBe("pane.chatTile.err.turnRunning");
    expect(k("unsupported")).toBe("pane.chatTile.rewind.err.terminal");
    expect(k("thread/revert only supports paginated threads")).toBe("pane.chatTile.rewind.err.legacy");
    expect(k("turn not found: 01a21d10-b57d-73b3-b3c6-f273fd0ffb1f")).toBe("pane.chatTile.rewind.err.turnNotFound");
    expect(k("turn not found")).toBe("pane.chatTile.rewind.err.turnNotFound");
    expect(rewindCliLine("thread rollback failed", false)).toEqual({ key: "pane.chatTile.rewind.cliSaid", vars: { detail: "thread rollback failed" } });
    expect(ko("pane.chatTile.rewind.err.terminal")).toContain("터미널 모양으로 열어 주세요");
    expect(ko("pane.chatTile.rewind.err.beforeCompact")).toBe("압축 전 메시지로는 되감을 수 없습니다");
  });

  it("rewindErrorText — 서버 글 · CLI 글 · 압축 · 반쪽 실패 · 없음", () => {
    expect(rewindErrorText(ask())).toBeNull();
    expect(rewindErrorText(ask({ error: "[preview-first] preview this rewind first" }))).toBe(ko("pane.chatTile.rewind.err.previewFirst"));
    expect(rewindErrorText(ask({ error: "[turn-running] a turn is running" }))).toBe(ko("pane.chatTile.err.turnRunning"));
    expect(rewindErrorText(ask({ error: "[unsupported] this CLI cannot rewind that here" }))).toBe(ko("pane.chatTile.rewind.err.terminal"));
    expect(rewindErrorText(ask({ error: "[exited]" }))).toBe(ko("pane.chatTile.rewind.err.exited"));
    expect(rewindErrorText(ask({ error: "target_not_found", compacted: true }))).toBe(ko("pane.chatTile.rewind.err.beforeCompact"));
    expect(rewindErrorText(ask({ error: "boom" }))).toBe(ko("pane.chatTile.rewind.cliSaid", { detail: "boom" }));
    expect(rewindErrorText(ask({ scope: "both", error: "stale_target", filesDone: true }))).toBe(
      `파일은 되돌렸지만 대화는 되감지 못했습니다 — ${ko("pane.chatTile.rewind.err.failed")} (CLI: stale_target)`,
    );
    // 서버가 압축 전 기준점으로 읽은 거절 — 이 창이 압축을 몰라도
    expect(rewindErrorText(ask({ scope: "conversation", error: "before_compact" }))).toBe("압축 전 메시지로는 되감을 수 없습니다");
    expect(rewindErrorText(ask({ scope: "conversation", error: "target_not_found" }))).toBe(`${ko("pane.chatTile.rewind.err.failed")} (CLI: target_not_found)`);
    expect(rewindErrorText(ask({ scope: "both", error: "No file checkpoint found for this message." }))).toBe(
      `${ko("pane.chatTile.rewind.files.noCheckpoint")} ${ko("pane.chatTile.rewind.both.convoOnly")}`,
    );
  });

  it("rewindPinnedKey — 파일 경고가 대화 경고보다 앞 · 경고가 없으면 null", () => {
    const k = (...keys: string[]) => rewindPinnedKey(keys.map((key) => ({ key: `pane.chatTile.rewind.${key}` as never })));
    expect(k("files.count", "files.onlyTracked", "convo.claude")).toBe("pane.chatTile.rewind.files.onlyTracked");
    expect(k("convo.claude", "convo.claudeFilesStay")).toBe("pane.chatTile.rewind.convo.claude");
    expect(k("convo.count", "convo.forget", "convo.filesStay", "convo.codexFiles")).toBe("pane.chatTile.rewind.convo.forget");
    expect(k("files.none", "files.keepConvo")).toBeNull();
  });

  it("rewindRetryable — 다시 해도 같은 실패에는 [다시 시도] 가 없다", () => {
    for (const e of ["before_compact", "unsupported", "target_not_found", "No file checkpoint found for this message.", "File rewinding is not enabled.", "[unsupported] x", "turn not found: 1", "thread/revert only supports paginated threads"]) {
      expect(rewindRetryable(e), e).toBe(false);
    }
    for (const e of ["stale_target", "boom", "[rewind-timeout]", "[preview-first] x", "[exited]"]) expect(rewindRetryable(e), e).toBe(true);
    expect(rewindRetryable(null)).toBe(false);
  });

  it("단추 · 머리 · 범위 글", () => {
    expect(rewindActionKey(["both", "conversation", "files"])).toBe("pane.chatTile.rewind.action.both");
    expect(rewindActionKey(["files"])).toBe("pane.chatTile.rewind.action.files");
    expect(rewindActionKey(["conversation"])).toBe("pane.chatTile.rewind.action.convo");
    expect(rewindTitleKey(["both", "conversation", "files"])).toBe("pane.chatTile.rewind.title");
    expect(rewindTitleKey(["files"])).toBe("pane.chatTile.rewind.files.title");
    expect(rewindTitleKey(["conversation"])).toBe("pane.chatTile.rewind.convo.title");
    expect(["both", "conversation", "files"].map((s) => ko(rewindScopeKey(s as "both")))).toEqual(["파일과 대화", "대화만", "파일만"]);
    expect(rewindConfirmKey("both")).toBe("pane.chatTile.rewind.both.confirm");
    expect(rewindConfirmKey("files")).toBe("pane.chatTile.rewind.files.confirm");
    expect(rewindConfirmKey("conversation")).toBe("pane.chatTile.rewind.convo.confirm");
  });

  it("rewindTraceText — 파일 수 있음 · 없음 · 링크 · 대화 · both · 다른 창", () => {
    const tr = { key: "rw1", at: 0, turns: null, skippedLinks: null };
    expect(rewindTraceText({ ...tr, scope: "files", quote: "고쳐 줘", files: 2 })).toBe("파일 2개를 「고쳐 줘」 전으로 되돌렸습니다 · 대화는 그대로입니다");
    expect(rewindTraceText({ ...tr, scope: "files", quote: "", files: null })).toBe("파일을 되돌렸습니다 · 대화는 그대로입니다");
    expect(rewindTraceText({ ...tr, scope: "files", quote: "고쳐 줘", files: 1, skippedLinks: 2 })).toBe(
      "파일 1개를 「고쳐 줘」 전으로 되돌렸습니다 · 대화는 그대로입니다 (연결 2개는 되돌리지 못했습니다)",
    );
    expect(rewindTraceText({ ...tr, scope: "files", quote: "x", files: 1, skippedLinks: 0 })).not.toContain("연결");
    expect(rewindTraceText({ ...tr, scope: "conversation", quote: "고쳐 줘", files: null })).toBe("「고쳐 줘」 전으로 대화를 되감았습니다 · 파일은 그대로입니다");
    expect(rewindTraceText({ ...tr, scope: "conversation", quote: "", files: null })).toBe("다른 창에서 대화를 되감았습니다 · 파일은 그대로입니다");
    expect(rewindTraceText({ ...tr, scope: "both", quote: "고쳐 줘", files: 2 })).toBe("「고쳐 줘」 전으로 파일과 대화를 되감았습니다");
    expect(rewindTraceText({ ...tr, scope: "both", quote: "", files: null })).toBe("다른 창에서 파일과 대화를 되감았습니다");
  });

  it("되감기 문구에 '패널' · '체크포인트' 가 없다", () => {
    for (const [k, v] of Object.entries(koPane)) if (k.startsWith("chatTile.rewind.")) expect(v).not.toMatch(/패널|체크포인트/);
  });
});

describe("sessionAllowLabel — 단추 글이 실제 효과를 말한다", () => {
  it("넷", () => {
    expect(sessionAllowLabel({ kind: "mode", detail: "acceptEdits" })).toBe(ko("pane.chatTile.perm.session.mode"));
    expect(sessionAllowLabel({ kind: "rules", detail: "npm test:*" })).toBe(ko("pane.chatTile.perm.session.rules", { detail: "npm test:*" }));
    expect(sessionAllowLabel({ kind: "rules", detail: "npm test:*" })).toContain("npm test:*");
    expect(sessionAllowLabel({ kind: "dirs", detail: "C:/other" })).toContain("C:/other");
    expect(sessionAllowLabel({ kind: "command", detail: "ls" })).toBe(ko("pane.chatTile.perm.session.command"));
  });
});

describe("긴 규칙 — 보이는 글만 줄이고 툴팁(full)은 그대로", () => {
  // 실측: 폴더 밖 읽기의 늘 허용 규칙(앱 첨부 자리 · 64자 16진 폴더)
  const rule = "Read(//c/Users/u/AppData/Roaming/aynx-dev/attachments/0ad9a153eab8fe73eb597ca3a5088ff88a99719acb25a0cd93c1e869616b9ac2/**)";

  it("shortDetail — 긴 16진 이름을 줄이고 넘치면 가운데를 줄인다 · 끝을 더 남긴다", () => {
    const s = shortDetail(rule);
    expect(s.length).toBeLessThanOrEqual(56);
    expect(s.endsWith("/**)")).toBe(true);
    expect(s).toContain("0ad9a153…");
    expect(s.startsWith("Read(")).toBe(true);
    expect(shortDetail("Bash(npm test:*)")).toBe("Bash(npm test:*)");
  });

  it("단추 글은 줄이고 full 은 원래 값 — 서버가 싣는 값과 상관없다", () => {
    expect(sessionAllowLabel({ kind: "rules", detail: rule })).toBe(ko("pane.chatTile.perm.session.rules", { detail: shortDetail(rule) }));
    expect(sessionAllowLabel({ kind: "rules", detail: rule }, true)).toBe(ko("pane.chatTile.perm.session.rules", { detail: rule }));
    expect(sessionAllowLabel({ kind: "dirs", detail: rule }, true)).toContain(rule);
  });
});

describe("Codex 새 파일 diff — 모든 줄이 +", () => {
  it("어댑터 꼴(@@ 머리 + `+` 줄) → 더한 줄 · 경로 줄 없음", () => {
    expect(unifiedRows("@@ -0,0 +1,2 @@\n+two\n++x\n")).toEqual([
      { op: "hunk", text: "@@ -0,0 +1,2 @@" },
      { op: "+", text: "two" },
      { op: "+", text: "+x" },
    ]);
  });
});

describe("chatPermView", () => {
  const perm = (toolName: string, permKind: "tool" | "command" | "fileChange" | "mcpTool" = "tool", detail = "", title = toolName) => ({
    toolName,
    permKind,
    detail,
    title,
  });

  it("Claude Edit 입력 → 줄 diff · 경로", () => {
    const v = chatPermView(perm("Edit"), { file_path: "C:/src/a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc" });
    expect(v.kind).toBe("edit");
    expect(v.target).toBe("C:/src/a.ts");
    expect(v.diff?.map((r) => `${r.op}${r.text}`)).toEqual([" a", "-b", "+B", " c"]);
  });

  it("MultiEdit 는 조각 사이에 gap · Write 는 모두 + 줄", () => {
    const m = chatPermView(perm("MultiEdit"), { file_path: "f", edits: [{ old_string: "x", new_string: "y" }, { old_string: "p", new_string: "q" }] });
    expect(m.diff?.map((r) => r.op)).toEqual(["-", "+", "gap", "-", "+"]);
    const w = chatPermView(perm("Write"), { file_path: "f", content: "one\ntwo\n" });
    expect(w.diff?.map((r) => `${r.op}${r.text}`)).toEqual(["+one", "+two"]);
  });

  it("입력이 없으면(16 KiB 넘음 · Codex) 서버 설명 글", () => {
    const v = chatPermView(perm("Edit", "tool", "edit a.ts"), undefined);
    expect(v).toMatchObject({ kind: "edit", diff: null, text: "edit a.ts" });
    const c = chatPermView(perm("fileChange", "fileChange", "--- a\n+++ b"), undefined);
    expect(c).toMatchObject({ kind: "patch", text: "--- a\n+++ b" });
  });

  it("Claude Write = 대상 경로 + 새 내용 전부 + 줄 · 다른 칸 없음", () => {
    const v = chatPermView(perm("Write", "tool", "Write note.txt"), { file_path: "C:/repo/note.txt", content: "hello\n" });
    expect(v).toMatchObject({ kind: "write", target: "C:/repo/note.txt", command: null, mcp: null, reason: null, text: null });
    expect(v.diff?.map((r) => `${r.op}${r.text}`)).toEqual(["+hello"]);
  });

  it("Claude Read = 경로 한 번 — 설명 글이 같은 경로(그대로 · `~` 로 줄인 꼴)면 싣지 않는다 · 다른 글이면 둔다", () => {
    const target = "C:\\Users\\me\\AppData\\Roaming\\aynx-dev\\attachments\\ab12\\memo.txt";
    const home = chatPermView(perm("Read", "tool", "~\\AppData\\Roaming\\aynx-dev\\attachments\\ab12\\memo.txt"), { file_path: target });
    expect(home).toMatchObject({ kind: "read", target, text: null });
    expect(chatPermView(perm("Read", "tool", target), { file_path: target }).text).toBeNull();
    expect(chatPermView(perm("Read", "tool", "c:/users/me/appdata/roaming/aynx-dev/attachments/ab12/memo.txt"), { file_path: target }).text).toBeNull();
    expect(chatPermView(perm("Read", "tool", "outside the working folder"), { file_path: target }).text).toBe("outside the working folder");
    expect(chatPermView(perm("WebFetch", "tool", "https://a.dev/x"), { url: "https://a.dev/x" })).toMatchObject({ kind: "fetch", target: "https://a.dev/x", text: null });
    // 입력이 없으면 설명 글 그대로
    expect(chatPermView(perm("Read", "tool", target), undefined)).toMatchObject({ target: null, text: target });
  });

  it("Claude Bash = 명령 전체 · 설명은 에이전트의 이유로 따로", () => {
    expect(chatPermView(perm("Bash"), { command: "npm test\n  && npm run build", description: "run tests" })).toMatchObject({
      kind: "command",
      command: { text: "npm test\n  && npm run build", cwd: null, truncated: false },
      reason: "run tests",
      text: null,
    });
    const cut = chatPermView(perm("Bash"), { command: "echo x", description: "", commandTruncated: true });
    expect(cut.command?.truncated).toBe(true);
    expect(cut.reason).toBeNull();
  });

  it("Codex 명령 = 입력의 명령 전체 · 폴더 · 이유(모델 글은 명령 칸에 섞이지 않는다)", () => {
    const cmd = "Set-Content -LiteralPath 'note-codex.txt' -Value 'hello'\n[IO.File]::ReadAllText('note-codex.txt')";
    const p = perm("commandExecution", "command", "쓰기를 허용하시겠어요?\nC:/repo", "Set-Content -LiteralPath 'note-codex.txt' -Val…");
    const v = chatPermView(p, { command: cmd, cwd: "C:/repo", reason: "쓰기를 허용하시겠어요?" });
    expect(v).toMatchObject({ kind: "command", command: { text: cmd, cwd: "C:/repo", truncated: false }, reason: "쓰기를 허용하시겠어요?", text: null });
    // 입력이 없으면(옛 서버) 한 줄 요약을 잘린 명령으로 · 서버 글은 따로
    const old = chatPermView(p, undefined);
    expect(old.command).toEqual({ text: p.title, cwd: null, truncated: true });
    expect(old.text).toBe(p.detail);
  });

  it("MCP = 서버 · 도구 · 인자 — 두 CLI 같은 꼴", () => {
    // Claude: 어댑터 제목 `서버 · 도구` + 도구 인자 그대로
    const c = chatPermView(perm("mcp__aynx-sessions-dev__list_sessions", "mcpTool", "", "aynx-sessions-dev · list_sessions"), {});
    expect(c.mcp).toEqual({ server: "aynx-sessions-dev", tool: "list_sessions", args: null });
    const ca = chatPermView(perm("mcp__tavily__search", "mcpTool", "", "tavily · search"), { query: "tauri", max: 3 });
    expect(ca.mcp).toEqual({ server: "tavily", tool: "search", args: JSON.stringify({ query: "tauri", max: 3 }, null, 2) });
    // Codex: 어댑터가 지은 `{server, tool, arguments}` — CLI 의 영어 물음 글은 쓰지 않는다
    const xp = perm("mcp__aynx-sessions-dev__list_sessions", "mcpTool", 'Allow the aynx-sessions-dev MCP server to run tool "list_sessions"?', "aynx-sessions-dev · list_sessions");
    const x = chatPermView(xp, { server: "aynx-sessions-dev", tool: "list_sessions", arguments: {} });
    expect(x).toMatchObject({ kind: "mcp", mcp: { server: "aynx-sessions-dev", tool: "list_sessions", args: null }, text: null });
    const xa = chatPermView(xp, { server: "aynx-sessions-dev", tool: "list_sessions", arguments: { all: true } });
    expect(xa.mcp?.args).toBe('{\n  "all": true\n}');
    // 인자가 상한을 넘어 이름만 왔으면 서버의 인자 글
    expect(chatPermView({ ...xp, detail: '{\n  "big": 1\n}' }, { server: "aynx-sessions-dev", tool: "list_sessions" }).mcp?.args).toBe('{\n  "big": 1\n}');
    expect(mcpArgsText({ s: "x".repeat(5000) })?.endsWith("\n…")).toBe(true);
  });

  it("Codex apply_patch 명령 = 패치 줄 + 실제 명령은 그대로", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch";
    const cmd = `pwsh.exe -Command '$patch = "…"\n& codex.exe --codex-run-as-apply-patch $patch'`;
    const v = chatPermView(perm("commandExecution", "command", "", "pwsh.exe …"), {
      command: cmd,
      commandTruncated: true,
      cwd: "C:/repo",
      reason: "patch",
      patch,
      patchKind: "applyPatch",
      patchTruncated: true,
      files: ["src/a.ts"],
    });
    expect(v.command).toEqual({ text: cmd, cwd: "C:/repo", truncated: true });
    expect(v.patch?.files).toEqual(["src/a.ts"]);
    expect(v.patch?.truncated).toBe(true);
    expect(v.patch?.rows.map((r) => `${r.op}${r.text}`)).toEqual(["hunk*** Update File: src/a.ts", "hunk@@", "-old", "+new"]);
    // files 가 없으면 패치 머리줄에서
    const nf = chatPermView(perm("commandExecution", "command"), { command: cmd, patch, patchKind: "applyPatch" });
    expect(nf.patch).toMatchObject({ files: ["src/a.ts"], truncated: false });
    // 패치가 없거나 모르는 꼴이면 명령 카드 그대로
    expect(chatPermView(perm("commandExecution", "command"), { command: "ls" }).patch).toBeNull();
    expect(chatPermView(perm("commandExecution", "command"), { command: "ls", patch, patchKind: "weird" }).patch).toBeNull();
  });

  it("Codex 파일 승인 · 항목 diff(unified) → 패치 줄", () => {
    const diff = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n--- x\n\\ No newline at end of file\n";
    const v = chatPermView(perm("fileChange", "fileChange", "edit a.ts"), { files: ["src/a.ts"], patch: diff, patchKind: "unified", reason: " why " });
    expect(v).toMatchObject({ kind: "patch", reason: "why", text: null });
    expect(v.patch?.files).toEqual(["src/a.ts"]);
    expect(v.patch?.rows.map((r) => `${r.op}${r.text}`)).toEqual([
      "hunk--- a/src/a.ts",
      "hunk+++ b/src/a.ts",
      "hunk@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "--- x",
    ]);
    // 입력이 패치 꼴이 아니면 서버 글
    expect(chatPermView(perm("fileChange", "fileChange", "edit a.ts"), { x: 1 })).toMatchObject({ patch: null, text: "edit a.ts" });
  });

  it("unifiedRows — diff --git 머리 · 줄끝 CRLF", () => {
    expect(unifiedRows("diff --git a/x b/x\r\nindex 1..2\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b").map((r) => r.op)).toEqual([
      "hunk",
      "hunk",
      "hunk",
      "hunk",
      "hunk",
      "-",
      "+",
    ]);
  });

  it("모르는 도구", () => {
    expect(chatPermView(perm("mcp__x__y", "mcpTool"), {}).kind).toBe("mcp");
    const o = chatPermView(perm("Strange"), {});
    expect(o.kind).toBe("other");
    expect(chatPermKindText(o, "Strange")).toBe(ko("pane.perm.title.other", { tool: "Strange" }));
    expect(chatPermKindText({ kind: "edit" }, "Edit")).toBe(ko("pane.perm.title.edit"));
  });
});

describe("검토 · 목표 · 속도 · MCP 상태 문구", () => {
  const ko2 = ko;

  it("새 이유 일곱 → 문구(서버 글은 보이지 않는다)", () => {
    const table: [string, Key][] = [
      ["bad-review-target", "pane.chatTile.review.err.target"],
      ["bad-goal", "pane.chatTile.goal.err.goal"],
      ["bad-objective", "pane.chatTile.goal.err.goal"],
      ["bad-budget", "pane.chatTile.goal.err.budget"],
      ["no-goal", "pane.chatTile.goal.err.none"],
      ["bad-tier", "pane.chatTile.tier.err"],
      ["mcp-status-busy", "pane.chatTile.mcp.busy"],
      ["turn-running", "pane.chatTile.err.turnRunning"],
      ["not-started", "pane.chatTile.err.notStarted"],
    ];
    for (const [reason, key] of table) {
      const out = chatTileErrorText(new Error(`[${reason}] server text`));
      expect([reason, out]).toEqual([reason, ko2(key)]);
      expect(out).not.toContain("server text");
    }
  });

  it("원격 창의 마스터 암호 확인 거절은 이유 코드가 없다 — 글 그대로", () => {
    expect(chatTileErrorText(new Error("마스터 암호를 다시 확인해야 합니다 — 다시 시도하세요"))).toBe("마스터 암호를 다시 확인해야 합니다 — 다시 시도하세요");
  });

  it("알림 일곱 — 검토 표지 · 실패 · 목표 실패 · 점검 · Claude 목표 안내 · MCP 실패", () => {
    expect(chatTileNoticeText("reviewing", "current changes")).toBe(ko2("pane.chatTile.review.running", { label: "current changes" }));
    expect(chatTileNoticeText("reviewed", "current changes")).toBe(ko2("pane.chatTile.review.done", { label: "current changes" }));
    expect(chatTileNoticeText("review-stopped", "current changes")).toBe(ko2("pane.chatTile.review.stopped", { label: "current changes" }));
    expect(chatTileNoticeText("review-failed", "bad target")).toBe(ko2("pane.chatTile.review.failed", { detail: "bad target" }));
    expect(chatTileNoticeText("goal-failed", "objective must not be empty")).toBe(ko2("pane.chatTile.goal.failed", { detail: "objective must not be empty" }));
    expect(chatTileNoticeText("goal-feedback", "x")).toBe(ko2("pane.chatTile.goal.feedback", { detail: "x" }));
    expect(chatTileNoticeText("goal-claude", null)).toBe("Claude가 조건을 이룰 때까지 이어서 일합니다 — [중지]로 멈추고 /goal clear로 지웁니다");
    expect(translate("en", "pane.chatTile.goal.claudeNote")).toContain("/goal clear");
    expect(chatTileNoticeText("mcp-status-failed", null)).toBe(ko2("pane.chatTile.mcp.failed"));
  });

  it("목표 카드 문구가 말해야 할 것 — 새 메시지 없이 턴 · [멈춤] 과 [중지] 의 차이 · 한도의 뜻", () => {
    for (const lang of ["ko", "en"] as const) {
      const warn = translate(lang, "pane.chatTile.goal.warn");
      const stop = translate(lang, "pane.chatTile.goal.stopHint");
      const budget = translate(lang, "pane.chatTile.goal.budgetHint");
      expect(warn).toMatch(lang === "ko" ? /새 메시지 없이/ : /without a new message/);
      expect(stop).toMatch(lang === "ko" ? /\[멈춤\].*다음 자동 턴.*\[중지\]/ : /\[Pause\].*next automatic turn.*\[Stop\]/);
      expect(budget).toMatch(lang === "ko" ? /토큰/ : /tokens/);
      expect(translate(lang, "pane.chatTile.goal.auto")).toBe(lang === "ko" ? "Aynx 밖에서 정한 목표" : "Goal set outside Aynx");
    }
  });

  it("새 문구에 \"패널\" 이 없다 · 두 사전의 키가 같다", async () => {
    const { pane: koPane } = await import("$lib/i18n/ko/pane");
    const { pane: enPane } = await import("$lib/i18n/en/pane");
    const mine = (d: Record<string, string>) => Object.keys(d).filter((k) => /^chatTile\.(mcp|review|goal|tier)\.|^chatTile\.slash\.action\.(mcpStatus|review|goal|fast)$/.test(k)).sort();
    expect(mine(koPane).length).toBeGreaterThan(60);
    expect(mine(koPane)).toEqual(mine(enPane));
    for (const k of mine(koPane)) expect(koPane[k as keyof typeof koPane]).not.toContain("패널");
  });
});
