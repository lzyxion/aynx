import { sideChatCliOk, sideChatConversation, sideChatForkFrom, type SideChat } from "$lib/side-chat";
import type { SideChatTarget } from "$lib/app/side-chat-live.svelte.js";

export function targetOf(c: SideChat, cli = c.cli, model = c.model): SideChatTarget {
  return {
    id: c.id,
    cli: sideChatCliOk(cli) ? cli : "claude",
    model,
    effort: c.effort,
    conversation: sideChatConversation(c, cli),
    fork: sideChatForkFrom(c, cli),
    links: c.tiles.map((x) => x.stream),
  };
}

export type Dot = "running" | "permission" | "finished" | null;

export function mostUrgentDot(dots: readonly Dot[]): Dot {
  if (dots.includes("permission")) return "permission";
  if (dots.includes("finished")) return "finished";
  return dots.includes("running") ? "running" : null;
}
