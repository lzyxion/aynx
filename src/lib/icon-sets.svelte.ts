/**
 * **통째 아이콘 표(logos · lucide)를 늦게 불러 쥐는 곳** (docs/log/2026-09-29-logos-full-icons.md).
 *
 * 표 둘은 본 번들에 들지 않는다:
 *
 * | 표 | 무엇 | 크기 |
 * | --- | --- | --- |
 * | `host-icons-logos.generated.json` | 컬러 로고 2,110개 (`svg:logos:`) | 7.4MB |
 * | `host-icons-lucide.generated.json` | 단색 선 아이콘 1,909개 — 고르개의 "기본" (`svg:lucide:`) | 570KB |
 *
 * Vite 가 각각을 **따로 떨어진 파일**로 내보내고(`?url` — 가져오는 것은 해시 붙은 주소 한 줄뿐이다),
 * 필요한 순간에 그 주소를 `fetch` 한다. 주소는 **앱 자신의 출처**(개발은 vite, 릴리스는 Tauri 가 exe
 * 안에서 내주는 파일)라 네트워크를 타지 않는다 — 오프라인 원칙은 그대로다.
 *
 * lucide 는 작아서(brotli 70KB 남짓) 본 번들에 박을 수도 있었지만, 그러면 **raw 570KB** 가 시작 때
 * 파싱하는 청크에 얹힌다 — 쓰는 호스트가 하나도 없는 사람까지. logos 와 같은 길을 타면 코드도 한
 * 벌이다 (아래 `IconSetLoader`).
 *
 * 부르는 곳은 둘이다:
 *
 * - **고르개**(`IconPicker`)가 열릴 때 — 둘 다 (검색과 "다른 칸에서 N개" 가 둘을 본다).
 * - **`HostIcon`** 이 `svg:logos:` · `svg:lucide:` 를 그려야 할 때 — 그 표 하나만. 그래서
 *   "쓰는 호스트가 있으면 시작 때 미리 데운다" 는 따로 두지 않았다: 그 호스트의 줄이 처음
 *   그려지는 때가 곧 그 시점이고, 쓰는 사람이 없으면 영영 받지 않는다.
 *
 * 한 번 받으면 창이 사는 동안 쥔다 (`$state.raw` — 2,000칸짜리 표를 깊은 반응형으로 감쌀
 * 까닭이 없다). 실패하면 `"error"` 로 남기고 다음 요청 때 다시 시도한다.
 */

import logosUrl from "$lib/host-icons-logos.generated.json?url";
import lucideUrl from "$lib/host-icons-lucide.generated.json?url";
import type { IconSetData } from "$lib/host-icons";

type Status = "idle" | "loading" | "ready" | "error";

/** 표 하나의 받기 — 주소 하나에 약속 하나 */
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

  /** 표를 받아 온다 (이미 받았거나 받는 중이면 그 약속을 그대로 돌려준다) */
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
        this.#pending = null; // 다음 요청 때 다시 시도한다
        return null;
      });
    return this.#pending;
  }
}

const logos = new IconSetLoader(logosUrl, "logos");
const lucide = new IconSetLoader(lucideUrl, "lucide");

/** 받아 둔 logos 표 (아직이면 `null`) — 반응형이라 읽는 쪽은 도착하면 다시 그려진다 */
export function logosSet(): IconSetData | null {
  return logos.set;
}

/** logos 표가 어디쯤인가 — `HostIcon` 이 자리 표시를 그릴지, 글자로 떨어질지를 가른다 */
export function logosStatus(): Status {
  return logos.status;
}

/** logos 표를 받아 온다 */
export function ensureLogos(): Promise<IconSetData | null> {
  return logos.ensure();
}

/** 받아 둔 lucide 표 (아직이면 `null`) */
export function lucideSet(): IconSetData | null {
  return lucide.set;
}

/** lucide 표가 어디쯤인가 */
export function lucideStatus(): Status {
  return lucide.status;
}

/** lucide 표를 받아 온다 */
export function ensureLucide(): Promise<IconSetData | null> {
  return lucide.ensure();
}
