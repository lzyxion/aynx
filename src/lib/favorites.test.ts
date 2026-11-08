import { describe, expect, it } from "vitest";
import {
  MAX_FAVORITES,
  favoriteKey,
  favoriteName,
  favoriteTitle,
  hasFavorite,
  parseFavorites,
  reorderFavorites,
  resolveFavorites,
  sameFavorite,
  serializeFavorites,
  withFavorite,
  withFavorites,
  withRenamedHost,
  withoutFavorite,
  type Favorite,
} from "$lib/favorites";
import type { HostEntry } from "$lib/hosts";
import type { Project } from "$lib/projects";
import { dbDockConn } from "$lib/db-dock";

/**
 * 즐겨찾기의 규칙 (docs/log/2026-09-15-start-page-favorites.md — 지금 그리는 곳은 하단 독).
 *
 * 여기서 지키려는 것은 넷이다:
 *  · **종류가 섞이지 않는다** — 별칭과 프로젝트 id 는 같은 글자일 수 있다.
 *  · **열 칸이 상한이고, 넘치면 더하지 않는다** (밀어내지 않는다 — 손으로 고정한 칸이다).
 *  · **저장값을 믿지 않는다** — 손으로 고친 localStorage 가 화면을 깨뜨리면 안 된다.
 *  · **가리키는 것이 사라진 칸은 안 그린다** (지우지도 않는다 — 돌아올 수 있다).
 */

const host = (name: string): HostEntry => ({ name });

const db = (id: string, name = id, via?: string) =>
  dbDockConn({ id, name, engine: "postgres", host: "10.0.0.5", port: 5432, user: "app", database: "shop", via });

const project = (id: string, name = id): Project => ({ id, name, path: "/project", host: null, shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null });

describe("favoriteKey · sameFavorite", () => {
  it("종류를 접두사로 붙여 별칭과 프로젝트 id 를 가른다", () => {
    expect(favoriteKey({ kind: "host", alias: "L1" })).toBe("host:L1");
    expect(favoriteKey({ kind: "project", id: "L1" })).toBe("project:L1");
    expect(favoriteKey({ kind: "db", id: "L1" })).toBe("db:L1");
    expect(sameFavorite({ kind: "host", alias: "L1" }, { kind: "project", id: "L1" })).toBe(false);
    expect(sameFavorite({ kind: "host", alias: "L1" }, { kind: "host", alias: "L1" })).toBe(true);
  });
});

describe("withFavorite", () => {
  it("맨 뒤에 붙인다 — 이미 외운 칸의 자리가 밀리지 않게", () => {
    const list: Favorite[] = [{ kind: "host", alias: "a" }];
    expect(withFavorite(list, { kind: "project", id: "L1" })).toEqual([
      { kind: "host", alias: "a" },
      { kind: "project", id: "L1" },
    ]);
  });

  it("이미 있으면 **같은 배열** 그대로 (화면을 공연히 다시 그리지 않는다)", () => {
    const list: Favorite[] = [{ kind: "host", alias: "a" }];
    expect(withFavorite(list, { kind: "host", alias: "a" })).toBe(list);
  });

  it("열 칸이 차면 더하지 않는다 — 오래된 것을 밀어내지 않는다", () => {
    const full: Favorite[] = Array.from({ length: MAX_FAVORITES }, (_, i) => ({
      kind: "host" as const,
      alias: `h${i}`,
    }));
    expect(withFavorite(full, { kind: "host", alias: "new" })).toBe(full);
    expect(full).toHaveLength(MAX_FAVORITES);
  });

  it("빈 별칭·빈 id 는 가리키는 것이 없어 받지 않는다", () => {
    const list: Favorite[] = [];
    expect(withFavorite(list, { kind: "host", alias: "  " })).toBe(list);
    expect(withFavorite(list, { kind: "project", id: "" })).toBe(list);
  });

  it("자리를 말하면 그 칸 **앞**에 끼운다 — 모르는 키 · null 이면 맨 뒤", () => {
    const list: Favorite[] = [{ kind: "host", alias: "a" }, { kind: "host", alias: "b" }];
    const fav: Favorite = { kind: "project", id: "P" };
    expect(withFavorite(list, fav, "host:a").map(favoriteKey)).toEqual(["project:P", "host:a", "host:b"]);
    expect(withFavorite(list, fav, "host:b").map(favoriteKey)).toEqual(["host:a", "project:P", "host:b"]);
    expect(withFavorite(list, fav, null).map(favoriteKey)).toEqual(["host:a", "host:b", "project:P"]);
    expect(withFavorite(list, fav, "host:zz").map(favoriteKey)).toEqual(["host:a", "host:b", "project:P"]);
  });
});

describe("withFavorites", () => {
  const list: Favorite[] = [{ kind: "host", alias: "a" }, { kind: "host", alias: "b" }];

  it("짐의 순서대로 그 자리 앞에 끼운다", () => {
    const r = withFavorites(list, [{ kind: "host", alias: "x" }, { kind: "host", alias: "y" }], "host:b");
    expect(r.list.map(favoriteKey)).toEqual(["host:a", "host:x", "host:y", "host:b"]);
    expect(r.added.map(favoriteKey)).toEqual(["host:x", "host:y"]);
    expect(r.existing).toEqual([]);
    expect(r.full).toBe(false);
  });

  it("이미 있는 칸은 조용히 넘기고 따로 알려 준다 — 더한 것이 없으면 같은 배열", () => {
    const r = withFavorites(list, [{ kind: "host", alias: "a" }], null);
    expect(r.list).toBe(list);
    expect(r.existing.map(favoriteKey)).toEqual(["host:a"]);
    expect(r.added).toEqual([]);
  });

  it("열 칸이 차면 거기서 멈추고 full 을 세운다", () => {
    const nine: Favorite[] = Array.from({ length: MAX_FAVORITES - 1 }, (_, i) => ({ kind: "host" as const, alias: `h${i}` }));
    const r = withFavorites(nine, [{ kind: "host", alias: "x" }, { kind: "host", alias: "y" }, { kind: "host", alias: "z" }]);
    expect(r.list).toHaveLength(MAX_FAVORITES);
    expect(r.added.map(favoriteKey)).toEqual(["host:x"]);
    expect(r.full).toBe(true);
  });
});

describe("withoutFavorite · hasFavorite", () => {
  it("그 칸만 뺀다", () => {
    const list: Favorite[] = [
      { kind: "host", alias: "a" },
      { kind: "project", id: "L1" },
    ];
    expect(withoutFavorite(list, { kind: "host", alias: "a" })).toEqual([
      { kind: "project", id: "L1" },
    ]);
  });

  it("없는 칸을 빼면 같은 배열 그대로", () => {
    const list: Favorite[] = [{ kind: "host", alias: "a" }];
    expect(withoutFavorite(list, { kind: "host", alias: "b" })).toBe(list);
    expect(hasFavorite(list, { kind: "host", alias: "b" })).toBe(false);
    expect(hasFavorite(list, { kind: "host", alias: "a" })).toBe(true);
  });
});

describe("withRenamedHost — 호스트 이름 변경을 따라간다", () => {
  it("그 별칭의 칸만 새 이름이 되고 자리는 그대로다", () => {
    const list: Favorite[] = [
      { kind: "project", id: "L1" },
      { kind: "host", alias: "web-01" },
      { kind: "host", alias: "db-01" },
    ];
    expect(withRenamedHost(list, "web-01", "web-02")).toEqual([
      { kind: "project", id: "L1" },
      { kind: "host", alias: "web-02" },
      { kind: "host", alias: "db-01" },
    ]);
  });

  it("찾는 것은 대소문자·앞뒤 공백을 무시하고, 적히는 글자는 사람이 친 그대로다", () => {
    const list: Favorite[] = [{ kind: "host", alias: " Web-01 " }];
    expect(withRenamedHost(list, "web-01", "  SSH  ")).toEqual([{ kind: "host", alias: "SSH" }]);
  });

  it("새 이름의 칸이 이미 있으면 중복을 만들지 않는다 — 먼저 있던 칸이 자리를 지킨다", () => {
    const list: Favorite[] = [
      { kind: "host", alias: "web-02" },
      { kind: "project", id: "L1" },
      { kind: "host", alias: "web-01" },
    ];
    expect(withRenamedHost(list, "web-01", "web-02")).toEqual([
      { kind: "host", alias: "web-02" },
      { kind: "project", id: "L1" },
    ]);
  });

  it("같은 별칭의 프로젝트은 건드리지 않는다 (종류가 다르다)", () => {
    const list: Favorite[] = [{ kind: "project", id: "web-01" }];
    expect(withRenamedHost(list, "web-01", "web-02")).toBe(list);
  });

  it("바뀔 칸이 없거나 이름이 비면 **같은 배열** 그대로", () => {
    const list: Favorite[] = [{ kind: "host", alias: "web-01" }];
    expect(withRenamedHost(list, "db-01", "db-02")).toBe(list);
    expect(withRenamedHost(list, "web-01", "   ")).toBe(list);
    expect(withRenamedHost(list, "", "web-02")).toBe(list);
  });
});

describe("parseFavorites", () => {
  it("성한 항목만 남긴다 — 깨진 한 줄 때문에 나머지를 버리지 않는다", () => {
    const raw = JSON.stringify([
      { kind: "host", alias: "web-01" },
      { kind: "host" }, // 별칭 없음
      { kind: "cheese", alias: "x" }, // 모르는 종류
      null,
      { kind: "project", id: "L1" },
    ]);
    expect(parseFavorites(raw)).toEqual([
      { kind: "host", alias: "web-01" },
      { kind: "project", id: "L1" },
    ]);
  });

  it("중복은 앞의 것이 이긴다 (순서가 곧 자리다)", () => {
    const raw = JSON.stringify([
      { kind: "host", alias: "a" },
      { kind: "project", id: "L1" },
      { kind: "host", alias: "a" },
    ]);
    expect(parseFavorites(raw)).toEqual([
      { kind: "host", alias: "a" },
      { kind: "project", id: "L1" },
    ]);
  });

  it("열 칸에서 끊는다", () => {
    const raw = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ kind: "host", alias: `h${i}` })),
    );
    expect(parseFavorites(raw)).toHaveLength(MAX_FAVORITES);
  });

  it("빈 값·깨진 JSON·배열이 아닌 것은 빈 목록 (절대 throw 하지 않는다)", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites(undefined)).toEqual([]);
    expect(parseFavorites("")).toEqual([]);
    expect(parseFavorites("{")).toEqual([]);
    expect(parseFavorites('{"kind":"host"}')).toEqual([]);
  });

  it("직렬화 → 파싱이 같은 목록을 돌려준다", () => {
    const list: Favorite[] = [
      { kind: "host", alias: "web-01" },
      { kind: "project", id: "L1" },
    ];
    expect(parseFavorites(serializeFavorites(list))).toEqual(list);
  });

  it("DB 연결은 id 만 담고 id 만 읽는다 — 다른 칸이 끼어 있어도 버린다(비밀 · 주소를 저장하지 않는다)", () => {
    const raw = JSON.stringify([
      { kind: "db", id: " D1 ", name: "운영", host: "10.0.0.5", password: "x" },
      { kind: "db" }, // id 없음
      { kind: "db", id: "  " },
    ]);
    expect(parseFavorites(raw)).toEqual([{ kind: "db", id: "D1" }]);
    expect(serializeFavorites([{ kind: "db", id: "D1" }])).toBe('[{"kind":"db","id":"D1"}]');
    const mixed: Favorite[] = [
      { kind: "db", id: "D1" },
      { kind: "project", id: "D1" },
    ];
    expect(parseFavorites(serializeFavorites(mixed))).toEqual(mixed);
  });

  it("같은 목록이면 같은 글자 (저장 전 비교가 이 결과를 쓴다)", () => {
    const a: Favorite[] = [{ kind: "host", alias: "a" }];
    const b: Favorite[] = [{ kind: "host", alias: "a" }];
    expect(serializeFavorites(a)).toBe(serializeFavorites(b));
  });
});

describe("resolveFavorites", () => {
  const hosts = [host("web-01"), host("db")];
  const projects = [project("L1", "배포")];

  it("고정한 순서 그대로 실물을 찾아 준다", () => {
    const got = resolveFavorites(
      [
        { kind: "project", id: "L1" },
        { kind: "host", alias: "db" },
      ],
      hosts,
      projects,
    );
    expect(got.map((r) => r.key)).toEqual(["project:L1", "host:db"]);
    expect(got[0].kind === "project" && got[0].project.name).toBe("배포");
    expect(got[1].kind === "host" && got[1].host.name).toBe("db");
  });

  it("없는 호스트·지워진 프로젝트은 **그리지 않는다** (목록에서 지우지도 않는다)", () => {
    const favs: Favorite[] = [
      { kind: "host", alias: "사라진서버" },
      { kind: "host", alias: "web-01" },
      { kind: "project", id: "없는id" },
    ];
    const got = resolveFavorites(favs, hosts, projects);
    expect(got.map((r) => r.key)).toEqual(["host:web-01"]);
    expect(favs).toHaveLength(3); // 원본은 그대로다
  });

  it("DB 연결은 지금 연결 목록에서 id 로 찾고, 지운 연결은 빠진다", () => {
    const favs: Favorite[] = [
      { kind: "db", id: "gone" },
      { kind: "db", id: "D1" },
      { kind: "host", alias: "db" },
    ];
    const got = resolveFavorites(favs, hosts, projects, [db("D1", "운영 DB")]);
    expect(got.map((r) => r.key)).toEqual(["db:D1", "host:db"]);
    expect(got[0].kind === "db" && got[0].conn.name).toBe("운영 DB");
    expect(resolveFavorites(favs, hosts, projects).map((r) => r.key)).toEqual(["host:db"]);
  });

  it("빈 목록·빈 호스트 목록에서도 성립한다", () => {
    expect(resolveFavorites([], hosts, projects)).toEqual([]);
    expect(resolveFavorites([{ kind: "host", alias: "web-01" }], [], [])).toEqual([]);
  });
});

describe("reorderFavorites", () => {
  const list: Favorite[] = [
    { kind: "host", alias: "a" },
    { kind: "host", alias: "b" },
    { kind: "project", id: "L1" },
  ];
  const keys = (l: readonly Favorite[]) => l.map(favoriteKey);

  it("고른 칸을 대상 칸 **앞**으로 옮긴다", () => {
    expect(keys(reorderFavorites(list, "project:L1", "host:b"))).toEqual([
      "host:a",
      "project:L1",
      "host:b",
    ]);
  });

  it("대상이 `null` 이면 맨 뒤로", () => {
    expect(keys(reorderFavorites(list, "host:a", null))).toEqual([
      "host:b",
      "project:L1",
      "host:a",
    ]);
  });

  it("달라지는 것이 없으면 **같은 배열 그대로** (화면이 공연히 다시 그려지지 않게)", () => {
    expect(reorderFavorites(list, "host:a", "host:a")).toBe(list); // 자기 자신
    expect(reorderFavorites(list, "host:a", "host:b")).toBe(list); // 이미 그 앞이다
    expect(reorderFavorites(list, "project:L1", null)).toBe(list); // 이미 맨 뒤다
    expect(reorderFavorites(list, "host:없음", "host:b")).toBe(list); // 모르는 출발
    expect(reorderFavorites(list, "host:a", "host:없음")).toBe(list); // 모르는 대상
  });

  it("종류가 다르면 키도 다르다 — 별칭과 프로젝트 id 가 같아도 섞이지 않는다", () => {
    const same: Favorite[] = [
      { kind: "host", alias: "L1" },
      { kind: "project", id: "L1" },
    ];
    expect(keys(reorderFavorites(same, "project:L1", "host:L1"))).toEqual(["project:L1", "host:L1"]);
  });
});

it("구형 layout 즐겨찾기는 버리고 호스트/프로젝트는 정상 복원한다", () => {
  expect(parseFavorites(JSON.stringify([
    { kind: "layout", id: "old" },
    { kind: "host", alias: "web" },
    { kind: "project", id: "p" },
  ]))).toEqual([{ kind: "host", alias: "web" }, { kind: "project", id: "p" }]);
});

describe("favoriteName · favoriteTitle — 하단 독 칸의 이름 · 말풍선", () => {
  const tr = (key: string, params?: Record<string, string>) =>
    key === "app.projects.badge.local" ? "로컬" : `${params?.name} — ${params?.where}`;
  const [web] = resolveFavorites([{ kind: "host", alias: "web-01" }], [host("web-01")]);
  const [local] = resolveFavorites([{ kind: "project", id: "L1" }], [], [project("L1", "배포")]);
  const [remote] = resolveFavorites([{ kind: "project", id: "R1" }], [], [{ ...project("R1", "원격"), host: "dev-01" }]);
  const [direct] = resolveFavorites([{ kind: "db", id: "D1" }], [], [], [db("D1", "운영 DB")]);
  const [tunneled] = resolveFavorites([{ kind: "db", id: "D2" }], [], [], [db("D2", "분석", "bastion")]);

  it("이름은 호스트 별칭 · 프로젝트 이름", () => {
    expect(favoriteName(web)).toBe("web-01");
    expect(favoriteName(local)).toBe("배포");
    expect(favoriteName(direct)).toBe("운영 DB");
  });

  it("말풍선은 호스트면 이름만, 프로젝트면 어디의 것인지를 붙인다", () => {
    expect(favoriteTitle(web, tr)).toBe("web-01");
    expect(favoriteTitle(local, tr)).toBe("배포 — 로컬");
    expect(favoriteTitle(remote, tr)).toBe("원격 — dev-01");
  });

  it("DB 연결의 말풍선은 쿼리 타일 머리줄과 같은 이름(경유면 호스트를 붙인다)", () => {
    expect(favoriteTitle(direct, tr)).toBe("운영 DB");
    expect(favoriteTitle(tunneled, tr)).toBe("분석 · bastion");
  });
});
