import { toast } from "$lib/toast.svelte.js";

export function showNotice(message: string): void {
  toast.info(message, { ms: 6000 });
}
