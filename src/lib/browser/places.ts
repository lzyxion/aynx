// 파일 타일의 **장소 패널**에 무엇을 세우나 — 순수 규칙 (docs/log/2026-10-07-file-tile-dolphin.md). 백엔드가 알려 준
// 붙박이 자리(`FsBackend.places`) · 이 백엔드의 프로젝트 · 드라이브(+ 남은 공간)를 무리 셋으로 엮는다. 그림은
// `PlacesPanel.svelte`, 읽기(언제 묻나)는 `SftpBrowser.svelte`.
import type { BackendPlace, DiskSpace } from "$lib/fs-backend";
import type { Key } from "$lib/i18n/keys";

/** 패널의 줄 하나 */
export interface PlaceItem {
  /** 같은 무리 안에서 유일한 키 */
  id: string;
  path: string;
  /** `UiIcon` 이름 */
  icon: string;
  /** 보이는 이름 — 문구 키면 `labelKey`, 사람이 지은 이름·경로 조각이면 `label` */
  label?: string;
  labelKey?: Key;
  /** 장치 줄의 남은 공간 (모르면 없다) */
  space?: DiskSpace | null;
}

/** 무리 하나 — 줄이 없으면 패널이 제목째 그리지 않는다 */
export interface PlaceSection {
  id: "places" | "projects" | "devices";
  titleKey: Key;
  items: PlaceItem[];
}

/** 붙박이 자리의 그림 · 이름 — 백엔드가 이름(`label`)을 실어 보냈으면(원격의 `~` · `/`) 그것이 이긴다 */
const KINDS: Record<BackendPlace["kind"], { icon: string; labelKey: Key }> = {
  home: { icon: "home", labelKey: "files.places.home" },
  desktop: { icon: "monitor", labelKey: "files.places.desktop" },
  documents: { icon: "file-text", labelKey: "files.places.documents" },
  downloads: { icon: "download", labelKey: "files.places.downloads" },
  root: { icon: "server", labelKey: "files.places.root" },
};

/**
 * 프로젝트 경로의 `~` 를 홈으로 푼다 — 원격 프로젝트는 `~/repo` 로 적힐 수 있는데(프로젝트 폼이 허용한다), 파일 타일의
 * 경로 칸·빵부스러기는 절대 경로를 본다. 홈을 모르면(`null`) 그대로 둔다(백엔드가 `~` 를 풀어 읽는다).
 */
export function resolveHome(path: string, home: string | null): string {
  if (home === null) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return home.endsWith("/") ? home + path.slice(2) : home + path.slice(1);
  return path;
}

/** 드라이브 뿌리의 이름 — `C:\` → `C:` (UNC·`/` 는 그대로) */
function driveLabel(root: string): string {
  return /^[A-Za-z]:\\$/.test(root) ? root.slice(0, 2) : root;
}

/**
 * 패널의 무리 셋 — **장소**(붙박이) · **프로젝트** · **장치**. 같은 경로가 앞 무리에 이미 섰으면 프로젝트 줄은 빠지지
 * 않는다(이름이 달라 뜻이 다르다) — 겹침을 거르는 것은 붙박이 자리 안에서만(Rust 가 이미 했다).
 */
export function placeSections(input: {
  base: readonly BackendPlace[];
  projects: readonly { id: string; name: string; path: string }[];
  drives: readonly { path: string; space: DiskSpace | null }[];
  /** 원격 홈 — 프로젝트 경로의 `~` 를 풀 때 (로컬은 `null`) */
  home: string | null;
}): PlaceSection[] {
  const places: PlaceItem[] = input.base.map((p) => ({
    id: `${p.kind}:${p.path}`,
    path: p.path,
    icon: KINDS[p.kind].icon,
    ...(p.label !== undefined ? { label: p.label } : { labelKey: KINDS[p.kind].labelKey }),
  }));
  const projects: PlaceItem[] = input.projects.map((p) => ({
    id: p.id,
    path: resolveHome(p.path, input.home),
    icon: "project",
    label: p.name,
  }));
  const devices: PlaceItem[] = input.drives.map((d) => ({
    id: d.path,
    path: d.path,
    icon: "hard-drive",
    label: driveLabel(d.path),
    space: d.space,
  }));
  return [
    { id: "places", titleKey: "files.places.section.places", items: places },
    { id: "projects", titleKey: "files.places.section.projects", items: projects },
    { id: "devices", titleKey: "files.places.section.devices", items: devices },
  ];
}
