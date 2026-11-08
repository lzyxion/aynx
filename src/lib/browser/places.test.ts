import { describe, expect, it } from "vitest";
import { placeSections, resolveHome } from "$lib/browser/places";

describe("resolveHome — 원격 프로젝트 경로의 ~", () => {
  it("~ 와 ~/ 만 푼다 · 홈을 모르면 그대로", () => {
    expect(resolveHome("~", "/home/me")).toBe("/home/me");
    expect(resolveHome("~/app", "/home/me")).toBe("/home/me/app");
    expect(resolveHome("~/app", "/home/me/")).toBe("/home/me/app");
    expect(resolveHome("/srv/app", "/home/me")).toBe("/srv/app");
    expect(resolveHome("~other/app", "/home/me")).toBe("~other/app");
    expect(resolveHome("~/app", null)).toBe("~/app");
  });
});

describe("placeSections — 장소 · 프로젝트 · 장치", () => {
  it("로컬 — 붙박이는 문구 키, 드라이브는 C: 이름과 남은 공간", () => {
    const [places, projects, devices] = placeSections({
      base: [
        { kind: "home", path: "C:\\Users\\me" },
        { kind: "downloads", path: "C:\\Users\\me\\Downloads" },
      ],
      projects: [{ id: "p1", name: "aynx", path: "C:\\w\\aynx" }],
      drives: [
        { path: "C:\\", space: { free: 10, total: 100 } },
        { path: "D:\\", space: null },
      ],
      home: null,
    });
    expect(places.items.map((i) => [i.icon, i.labelKey])).toEqual([
      ["home", "files.places.home"],
      ["download", "files.places.downloads"],
    ]);
    expect(projects.items[0]).toMatchObject({ label: "aynx", path: "C:\\w\\aynx", icon: "project" });
    expect(devices.items.map((i) => [i.label, i.space])).toEqual([
      ["C:", { free: 10, total: 100 }],
      ["D:", null],
    ]);
  });

  it("원격 — 백엔드가 실어 보낸 이름(~ · /)이 이기고, 프로젝트의 ~ 를 푼다 · 장치는 없다", () => {
    const [places, projects, devices] = placeSections({
      base: [
        { kind: "home", path: "/home/deploy", label: "~" },
        { kind: "root", path: "/", label: "/" },
      ],
      projects: [{ id: "p2", name: "app", path: "~/app" }],
      drives: [],
      home: "/home/deploy",
    });
    expect(places.items.map((i) => [i.label, i.labelKey])).toEqual([
      ["~", undefined],
      ["/", undefined],
    ]);
    expect(projects.items[0].path).toBe("/home/deploy/app");
    expect(devices.items).toEqual([]);
  });
});
