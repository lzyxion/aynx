/**
 * 통째 아이콘 표(logos · lucide)를 늦게 불러 쥐는 곳 (docs/log/2026-09-29-logos-full-icons.md).
 * 표 둘은 본 번들에 넣지 않는다(`?url` 로 따로 떨어진 파일) — 주소는 앱 자신의 출처라 네트워크를 타지 않는다(오프라인 원칙).
 * lucide 도 본 번들에 박지 않는다 — raw 570KB 가 시작 때 파싱하는 청크에 얹힌다. 시작 때 미리 데우지도 않는다.
 * 표는 `$state.raw` 로 쥔다 — 2,000칸짜리 표를 깊은 반응형으로 감싸지 않는다.
 */

import logosUrl from "$lib/host-icons-logos.generated.json?url";
import lucideUrl from "$lib/host-icons-lucide.generated.json?url";
import type { IconSetData } from "$lib/host-icons";

type Status = "idle" | "loading" | "ready" | "error";

class IconSetLoader {
  set = $state.raw<IconSetData | null>(null);
  status = $state<Status>("idle");
  #pending: Promise<IconSetData | null> | null = null;
  readonly url: string;
  readonly tag: string;

  constructor(url: string, tag: string) {
    this.url = url;
    this.tag = tag;
  }

  ensure(): Promise<IconSetData | null> {
    if (this.set) return Promise.resolve(this.set);
    if (this.#pending) return this.#pending;
    this.status = "loading";
    this.#pending = fetch(this.url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<IconSetData>;
      })
      .then((data) => {
        this.set = data;
        this.status = "ready";
        return data;
      })
      .catch((err: unknown) => {
        console.warn(`[icon-sets] ${this.tag} 표를 불러오지 못했습니다`, err);
        this.status = "error";
        this.#pending = null;
        return null;
      });
    return this.#pending;
  }
}

const logos = new IconSetLoader(logosUrl, "logos");
const lucide = new IconSetLoader(lucideUrl, "lucide");

export function logosSet(): IconSetData | null {
  return logos.set;
}

export function logosStatus(): Status {
  return logos.status;
}

export function ensureLogos(): Promise<IconSetData | null> {
  return logos.ensure();
}

export function lucideSet(): IconSetData | null {
  return lucide.set;
}

export function lucideStatus(): Status {
  return lucide.status;
}

export function ensureLucide(): Promise<IconSetData | null> {
  return lucide.ensure();
}
