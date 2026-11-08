/** 보이는 목록만 읽고 이벤트를 구독한다. 편집 중인 폼은 갱신으로 덮지 않는다. */
import { artistList, ARTISTS_CHANGED_EVENT } from "./api";
import { listen } from "$lib/ipc";
import type { ArtistProfile } from "./artist-form";

export function createArtistLoader() {
  let list = $state<ArtistProfile[]>([]);
  let error = $state<string | null>(null);
  let version = 0;
  async function load() {
    const seq = ++version;
    try {
      const next = await artistList();
      if (seq === version) { list = next; error = null; }
    } catch (e) { if (seq === version) error = String(e); }
  }
  function subscribe() {
    let dead = false;
    let off: (() => void) | undefined;
    void listen(ARTISTS_CHANGED_EVENT, () => void load()).then((fn) => {
      if (dead) fn(); else { off = fn; void load(); }
    }).catch((e) => { if (!dead) error = String(e); });
    void load();
    return () => { dead = true; ++version; off?.(); };
  }
  return { get list() { return list; }, get error() { return error; }, load, subscribe };
}
