import type { BackendPlace, DiskSpace } from "$lib/fs-backend";
import type { Key } from "$lib/i18n/keys";

export interface PlaceItem {
  id: string;
  path: string;
  icon: string;
  label?: string;
  labelKey?: Key;
  space?: DiskSpace | null;
}

export interface PlaceSection {
  id: "places" | "projects" | "devices";
  titleKey: Key;
  items: PlaceItem[];
}

const KINDS: Record<BackendPlace["kind"], { icon: string; labelKey: Key }> = {
  home: { icon: "home", labelKey: "files.places.home" },
  desktop: { icon: "monitor", labelKey: "files.places.desktop" },
  documents: { icon: "file-text", labelKey: "files.places.documents" },
  downloads: { icon: "download", labelKey: "files.places.downloads" },
  root: { icon: "server", labelKey: "files.places.root" },
};

export function resolveHome(path: string, home: string | null): string {
  if (home === null) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return home.endsWith("/") ? home + path.slice(2) : home + path.slice(1);
  return path;
}

function driveLabel(root: string): string {
  return /^[A-Za-z]:\\$/.test(root) ? root.slice(0, 2) : root;
}

/** 같은 경로가 앞 무리에 이미 섰어도 프로젝트 줄은 빼지 않는다(이름이 달라 뜻이 다르다) — 겹침 거르기는 붙박이 자리 안에서만(Rust 가 한다) */
export function placeSections(input: {
  base: readonly BackendPlace[];
  projects: readonly { id: string; name: string; path: string }[];
  drives: readonly { path: string; space: DiskSpace | null }[];
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
