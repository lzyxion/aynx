import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLDER_ICON,
  HOST_ICONS,
  HOST_ICON_NAMES,
  ICON_PREFIX,
  ICON_SEARCH_CAP,
  folderIcon,
  glyphFor,
  iconNameOf,
  iconRef,
  logosGlyph,
  logosNameOf,
  logosRef,
  LUCIDE_FEATURED,
  lucideNameOf,
  lucideRef,
  matchIcons,
  monoBody,
  searchLucide,
  setGlyph,
  isWordmark,
  searchIcons,
  uniquifyIds,
  type IconSetData,
  type LogosSet,
} from "$lib/host-icons";

/** 호스트 아이콘 참조·폴더 아이콘 규칙 (docs/log/2026-09-02-host-tree-icons.md) */

describe("iconRef · iconNameOf", () => {
  const sample = HOST_ICON_NAMES[0];

  it("이름 ↔ 저장 형식 왕복", () => {
    expect(iconRef(sample)).toBe(`${ICON_PREFIX}${sample}`);
    expect(iconNameOf(iconRef(sample))).toBe(sample);
  });

  it("내장 아이콘 전부가 왕복한다", () => {
    for (const name of HOST_ICON_NAMES) expect(iconNameOf(iconRef(name)), name).toBe(name);
  });

  it("접두사가 없으면 내장 아이콘이 아니다 (이모지는 그대로 이모지다)", () => {
    expect(iconNameOf("🐧")).toBeNull();
    expect(iconNameOf("ubuntu")).toBeNull();
  });

  it("모르는 이름은 null — 이모지 자리로 떨어져 글자 그대로 보인다", () => {
    expect(iconNameOf(`${ICON_PREFIX}없는아이콘`)).toBeNull();
  });

  it("빈 값·공백은 null", () => {
    expect(iconNameOf(null)).toBeNull();
    expect(iconNameOf(undefined)).toBeNull();
    expect(iconNameOf("")).toBeNull();
    expect(iconNameOf("   ")).toBeNull();
  });

  it("앞뒤 공백은 다듬어 읽는다", () => {
    expect(iconNameOf(`  ${ICON_PREFIX}${sample}  `)).toBe(sample);
  });
});

describe("glyphFor", () => {
  it("아는 이름이면 로고 하나", () => {
    expect(glyphFor(HOST_ICON_NAMES[0])).toBe(HOST_ICONS[HOST_ICON_NAMES[0]]);
  });

  it("모르는 이름이면 null", () => {
    expect(glyphFor("없는아이콘")).toBeNull();
  });

  it("목록과 표가 같은 것을 가리킨다", () => {
    expect(HOST_ICON_NAMES).toEqual(Object.keys(HOST_ICONS));
    expect(HOST_ICON_NAMES.length).toBeGreaterThan(0);
  });
});

describe("uniquifyIds", () => {
  it("id 가 없는 마크업은 손대지 않는다 (대부분의 아이콘)", () => {
    const body = '<path d="M0 0h24v24H0z"/>';
    expect(uniquifyIds(body, "x1")).toBe(body);
  });

  it("정의와 참조를 함께 갈아 끼운다 — 그라디언트가 풀리지 않게", () => {
    const body = '<linearGradient id="g1"/><path fill="url(#g1)"/>';
    expect(uniquifyIds(body, "u7")).toBe('<linearGradient id="g1-u7"/><path fill="url(#g1-u7)"/>');
  });

  it("여러 id 를 전부 바꾼다", () => {
    const body = '<stop id="a"/><stop id="b"/><path fill="url(#a)" stroke="url(#b)"/>';
    const out = uniquifyIds(body, "z");
    expect(out).toContain('id="a-z"');
    expect(out).toContain('id="b-z"');
    expect(out).toContain("url(#a-z)");
    expect(out).toContain("url(#b-z)");
  });

  it("꼬리표가 다르면 결과도 다르다 — 같은 아이콘이 여럿 떠도 id 가 안 겹친다", () => {
    const body = '<linearGradient id="g"/><path fill="url(#g)"/>';
    expect(uniquifyIds(body, "1")).not.toBe(uniquifyIds(body, "2"));
  });

  it("실제 내장 아이콘 중 id 를 쓰는 것들도 참조가 남지 않는다", () => {
    for (const [name, icon] of Object.entries(HOST_ICONS)) {
      const out = uniquifyIds(icon.body, "uid");
      // 바뀐 뒤에는 꼬리표 없는 `url(#…)` 참조가 남아 있으면 안 된다
      for (const m of out.matchAll(/url\(#([^)]+)\)/g)) {
        expect(m[1].endsWith("-uid"), `${name}: ${m[1]}`).toBe(true);
      }
    }
  });
});

describe("folderIcon", () => {
  it("기본 표식(📁)은 '고른 것' 이 아니다 — 테마 색 SVG 폴더로 떨어진다", () => {
    expect(folderIcon(DEFAULT_FOLDER_ICON)).toBeNull();
  });

  it("사람이 직접 고른 값은 그대로 쓴다", () => {
    expect(folderIcon("🚀")).toBe("🚀");
    expect(folderIcon("svg:docker")).toBe("svg:docker");
  });

  it("빈 값·공백은 null", () => {
    expect(folderIcon(null)).toBeNull();
    expect(folderIcon(undefined)).toBeNull();
    expect(folderIcon("")).toBeNull();
    expect(folderIcon("  ")).toBeNull();
  });

  it("앞뒤 공백을 다듬은 값으로 판정한다", () => {
    expect(folderIcon(` ${DEFAULT_FOLDER_ICON} `)).toBeNull();
    expect(folderIcon("  🚀 ")).toBe("🚀");
  });
});
/**
 * 고르개의 **검색** (docs/log/2026-09-20-host-form-tabs.md 의 "아이콘 칸 = 검색").
 *
 * 표는 생성물이라 여기서 만들지 않는다 — 별칭(`KEYWORDS`)이 빠지면 그 자리가 이 테스트에서
 * 걸려야 한다. 손으로 만든 표를 쓰는 것은 **순위 규칙**을 볼 때뿐이다.
 */
describe("matchIcons — 사람이 치는 글자로 로고 찾기", () => {
  it("이름의 접두사", () => {
    expect(matchIcons("deb")).toEqual(["debian"]);
    expect(matchIcons("ubu")).toEqual(["ubuntu"]);
  });

  it("라벨과 이름이 함께 걸린다 — 둘 다 접두사면 표의 차례대로", () => {
    // `Red Hat`(라벨) · `redis`(이름) — 격자에서 rhel 이 먼저 선다
    expect(matchIcons("red")).toEqual(["rhel", "redis"]);
  });

  it("별칭으로도 걸린다 (생성기의 `KEYWORDS`)", () => {
    expect(matchIcons("k8s")).toEqual(["kubernetes"]);
    expect(matchIcons("rpi")).toEqual(["raspberry-pi"]);
    expect(matchIcons("pg")).toEqual(["postgres"]);
  });

  it("앞의 `svg:` 는 떼고 본다 — 예전 칸의 손버릇", () => {
    expect(matchIcons("SVG:ubu")).toEqual(["ubuntu"]);
    expect(matchIcons(`${ICON_PREFIX}debian`)).toEqual(["debian"]);
  });

  it("대소문자·앞뒤 공백을 무시한다", () => {
    expect(matchIcons("  DeBiAn  ")).toEqual(["debian"]);
  });

  it("걸리는 것이 없으면 빈 배열 — 그때가 이모지를 친 것이다", () => {
    expect(matchIcons("🐧")).toEqual([]);
    expect(matchIcons("zzzz")).toEqual([]);
  });

  it("빈 글자는 전부 (격자의 평소 모습)", () => {
    expect(matchIcons("")).toEqual([...HOST_ICON_NAMES]);
    expect(matchIcons("   ")).toHaveLength(36);
  });

  it("접두사가 포함보다 앞에 선다 — 같은 등급 안은 표의 차례", () => {
    const table = {
      alpha: { label: "Alpha", keywords: [], source: "", viewBox: "", body: "" },
      beta: { label: "Beta", keywords: ["xalx"], source: "", viewBox: "", body: "" },
      gamma: { label: "Gamma", keywords: ["al"], source: "", viewBox: "", body: "" },
      delta: { label: "Xal", keywords: [], source: "", viewBox: "", body: "" },
    };
    // `al` 로 시작하는 것(alpha · gamma 의 별칭)이 먼저, 중간에 든 것(beta · delta)이 나중
    expect(matchIcons("al", table)).toEqual(["alpha", "gamma", "beta", "delta"]);
  });

  it("표를 넘기면 그 표만 본다 (순수 함수)", () => {
    expect(matchIcons("deb", {})).toEqual([]);
  });

  it("모든 로고가 제 이름으로 자기를 찾는다", () => {
    for (const name of HOST_ICON_NAMES) expect(matchIcons(name), name).toContain(name);
  });
});

/**
 * **logos 전체** (docs/log/2026-09-29-logos-full-icons.md). 표는 앱에서는 늦게 fetch 하지만,
 * 테스트는 파일을 그대로 읽는다 — 생성물의 모양이 여기서 걸린다.
 */
const FULL: LogosSet = JSON.parse(
  readFileSync(fileURLToPath(new URL("./host-icons-logos.generated.json", import.meta.url)), "utf8"),
);

describe("host-icons-logos.generated.json — 생성기 산출물의 모양", () => {
  it("출처·라이선스를 머리 필드에 싣는다 (JSON 이라 주석이 없다)", () => {
    expect(FULL.source).toBe("@iconify-json/logos");
    expect(FULL.license).toBe("CC0-1.0");
    expect(FULL.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(FULL.viewBox).toBe("0 0 256 256");
  });

  it("logos 전부를 싣는다 (숨김 포함)", () => {
    const names = Object.keys(FULL.icons);
    expect(names.length).toBeGreaterThan(2000);
    expect(names.filter((n) => FULL.icons[n].x === 1).length).toBeGreaterThan(0);
  });

  it("칸마다 body 가 있고, viewBox 는 기본과 다를 때만 네 수로 적힌다", () => {
    for (const [name, e] of Object.entries(FULL.icons)) {
      expect(typeof e.b, name).toBe("string");
      expect(e.b.length, name).toBeGreaterThan(0);
      if (e.v !== undefined) {
        expect(e.v, name).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
        expect(e.v, name).not.toBe(FULL.viewBox);
      }
      if (e.x !== undefined) expect(e.x, name).toBe(1);
    }
  });

  it("별칭은 전부 실제 아이콘을 가리킨다", () => {
    for (const [alias, target] of Object.entries(FULL.aliases)) {
      expect(FULL.icons[target], `${alias} → ${target}`).toBeDefined();
    }
  });

  it("큐레이션의 logos 출처는 전부 전체 표에도 있다", () => {
    for (const icon of Object.values(HOST_ICONS)) {
      if (!icon.source.startsWith("logos:")) continue;
      expect(FULL.icons[icon.source.slice("logos:".length)], icon.source).toBeDefined();
    }
  });
});

describe("logosRef · logosNameOf · logosGlyph", () => {
  it("저장 형식은 svg:logos:<이름> — 큐레이션 이름과 겹치지 않는다", () => {
    expect(logosRef("mongodb-icon")).toBe("svg:logos:mongodb-icon");
    expect(logosNameOf("svg:logos:mongodb-icon")).toBe("mongodb-icon");
    // 큐레이션 풀이는 logos 이름을 제 것으로 읽지 않는다 (그래서 HostIcon 이 둘을 가른다)
    expect(iconNameOf("svg:logos:ubuntu")).toBeNull();
    for (const name of HOST_ICON_NAMES) expect(name).not.toContain(":");
  });

  it("큐레이션 값·이모지·빈 값은 logos 가 아니다", () => {
    expect(logosNameOf("svg:ubuntu")).toBeNull();
    expect(logosNameOf("🐧")).toBeNull();
    expect(logosNameOf("svg:logos:")).toBeNull();
    expect(logosNameOf(null)).toBeNull();
    expect(logosNameOf("  svg:logos:redis  ")).toBe("redis");
  });

  it("이름을 풀면 viewBox·body — 기본 viewBox 는 표의 것", () => {
    const g = logosGlyph(FULL, "mongodb-icon");
    expect(g?.body).toBe(FULL.icons["mongodb-icon"].b);
    expect(g?.viewBox).toBe(FULL.icons["mongodb-icon"].v ?? FULL.viewBox);
  });

  it("별칭(옛 이름)도 풀린다 · 모르는 이름은 null", () => {
    const [alias, target] = Object.entries(FULL.aliases)[0];
    expect(logosGlyph(FULL, alias)?.body).toBe(FULL.icons[target].b);
    expect(logosGlyph(FULL, "없는-아이콘")).toBeNull();
    expect(logosGlyph(FULL, "constructor")).toBeNull();
  });
});

describe("searchIcons — 큐레이션 + logos 전체", () => {
  const e = (b = "<path/>") => ({ b });
  const tiny: LogosSet = {
    source: "t",
    version: "0",
    license: "CC0-1.0",
    viewBox: "0 0 256 256",
    icons: {
      "linux-tux": e(), // 큐레이션 linux 의 출처 — 빠져야 한다
      mongodb: e(),
      "mongodb-icon": e(),
      postgresql: e(), // 큐레이션 postgres 의 출처
      "google-cloud-run": e(),
      "old-thing": { b: "<path/>", x: 1 }, // 숨김
      "xmongox": e(),
    },
    aliases: {},
  };

  it("빈 글자는 큐레이션 전부 (logos 는 안 붙는다)", () => {
    const r = searchIcons("", tiny);
    expect(r.hits.map((h) => h.ref)).toEqual(HOST_ICON_NAMES.map(iconRef));
    expect(r.total).toBe(HOST_ICON_NAMES.length);
  });

  it("큐레이션이 먼저, 그 뒤에 logos — 접두사 먼저, 중간에 든 것 나중", () => {
    const r = searchIcons("mongo", tiny);
    expect(r.hits.map((h) => h.ref)).toEqual([
      "svg:logos:mongodb",
      "svg:logos:mongodb-icon",
      "svg:logos:xmongox",
    ]);
    expect(r.hits[0].label).toBe("mongodb");
  });

  it("'-' 로 가른 조각도 접두사로 본다 · 공백은 '-' 로 읽는다", () => {
    expect(searchIcons("run", tiny).hits.map((h) => h.ref)).toContain("svg:logos:google-cloud-run");
    expect(searchIcons("cloud run", tiny).hits.map((h) => h.ref)).toContain(
      "svg:logos:google-cloud-run",
    );
  });

  it("큐레이션이 이미 가진 로고는 logos 쪽에서 빠진다 — postgres 는 한 칸", () => {
    const refs = searchIcons("postgres", tiny).hits.map((h) => h.ref);
    expect(refs).toEqual(["svg:postgres"]);
    expect(searchIcons("tux", tiny).hits.map((h) => h.ref)).toEqual(["svg:linux"]);
  });

  it("숨김 아이콘은 검색에 안 뜬다", () => {
    expect(searchIcons("old", tiny).total).toBe(0);
  });

  it("표가 아직이면(null) 큐레이션만", () => {
    expect(searchIcons("mongo", null).total).toBe(0);
    expect(searchIcons("deb", null).hits.map((h) => h.ref)).toEqual(["svg:debian"]);
  });

  it("상한에서 자르고 total 은 자르기 전의 개수", () => {
    const r = searchIcons("mongo", tiny, 2);
    expect(r.hits).toHaveLength(2);
    expect(r.total).toBe(3);
  });

  it("같은 등급 안에서 정사각 표장이 가로 글씨 로고보다 먼저", () => {
    const set: LogosSet = {
      ...tiny,
      icons: { mongodb: { b: "<path/>", v: "0 0 512 135" }, "mongodb-icon": e(), mongolab: e() },
    };
    expect(searchIcons("mongo", set).hits.map((h) => h.label)).toEqual([
      "mongodb-icon",
      "mongolab",
      "mongodb",
    ]);
    expect(isWordmark("0 0 512 135")).toBe(true);
    expect(isWordmark("0 0 256 256")).toBe(false);
    expect(isWordmark("0 0 256 170")).toBe(false);
  });

  it("svg:logos: 를 친 손버릇도 먹힌다", () => {
    expect(searchIcons("svg:logos:mongodb-i", tiny).hits.map((h) => h.ref)).toEqual([
      "svg:logos:mongodb-icon",
    ]);
  });

  it("진짜 표: mongodb 가 걸리고, postgres 는 큐레이션 한 칸이 먼저이며 postgresql 은 겹쳐 뜨지 않는다", () => {
    const mongo = searchIcons("mongodb", FULL);
    expect(mongo.hits[0].ref).toBe("svg:logos:mongodb-icon");
    const pg = searchIcons("postgres", FULL).hits.map((h) => h.ref);
    expect(pg[0]).toBe("svg:postgres");
    expect(pg).not.toContain("svg:logos:postgresql");
  });

  it("진짜 표: 한 글자는 상한에 걸린다", () => {
    const r = searchIcons("a", FULL);
    expect(r.hits).toHaveLength(ICON_SEARCH_CAP);
    expect(r.total).toBeGreaterThan(ICON_SEARCH_CAP);
  });
});

// ---------------------------------------------------------------------------
// lucide 전체 — 고르개의 "기본" 칸 (docs/log/2026-09-29-logos-full-icons.md 의 Lucide 절)
// ---------------------------------------------------------------------------

const LUCIDE: IconSetData = JSON.parse(
  readFileSync(fileURLToPath(new URL("./host-icons-lucide.generated.json", import.meta.url)), "utf8"),
);

describe("host-icons-lucide.generated.json — 생성기 산출물의 모양", () => {
  it("출처·라이선스·개수·viewBox", () => {
    expect(LUCIDE.source).toBe("@iconify-json/lucide");
    expect(LUCIDE.license).toBe("ISC");
    expect(LUCIDE.viewBox).toBe("0 0 24 24");
    expect(Object.keys(LUCIDE.icons).length).toBeGreaterThan(1500);
  });

  it("획은 currentColor 다 (색은 그리는 쪽이 입힌다)", () => {
    expect(LUCIDE.icons.database.b).toContain('stroke="currentColor"');
  });

  it("별칭은 실제 아이콘을 가리킨다", () => {
    for (const [alias, target] of Object.entries(LUCIDE.aliases)) {
      expect(target in LUCIDE.icons, `${alias} → ${target}`).toBe(true);
    }
  });
});

describe("lucideRef · lucideNameOf · setGlyph", () => {
  it("이름 ↔ 저장 형식 왕복", () => {
    expect(lucideRef("database")).toBe("svg:lucide:database");
    expect(lucideNameOf("svg:lucide:database")).toBe("database");
    expect(lucideNameOf("  svg:lucide:hard-drive  ")).toBe("hard-drive");
  });

  it("다른 형식은 lucide 가 아니다 — 큐레이션·logos·이모지와 겹치지 않는다", () => {
    expect(lucideNameOf("svg:ubuntu")).toBeNull();
    expect(lucideNameOf("svg:logos:mongodb-icon")).toBeNull();
    expect(lucideNameOf("svg:lucide:")).toBeNull();
    expect(lucideNameOf("🐧")).toBeNull();
    expect(lucideNameOf(null)).toBeNull();
    expect(logosNameOf("svg:lucide:database")).toBeNull();
    expect(iconNameOf("svg:lucide:database")).toBeNull();
  });

  it("진짜 표에서 이름·별칭을 푼다", () => {
    const g = setGlyph(LUCIDE, "database");
    expect(g?.viewBox).toBe("0 0 24 24");
    expect(g?.body.length).toBeGreaterThan(20);
    const [alias, target] = Object.entries(LUCIDE.aliases)[0];
    expect(setGlyph(LUCIDE, alias)?.body).toBe(LUCIDE.icons[target].b);
    expect(setGlyph(LUCIDE, "없는-아이콘")).toBeNull();
  });
});

describe("LUCIDE_FEATURED — 기본 칸의 빈 격자", () => {
  it("스물네 개, 겹침 없음", () => {
    expect(LUCIDE_FEATURED.length).toBe(24);
    expect(new Set(LUCIDE_FEATURED).size).toBe(24);
  });

  it("전부 진짜 표에 **실제 아이콘**으로 있다 (별칭·숨김이 아니다)", () => {
    for (const name of LUCIDE_FEATURED) {
      expect(Object.hasOwn(LUCIDE.icons, name), name).toBe(true);
      expect(LUCIDE.icons[name].x, name).toBeUndefined();
    }
  });
});

describe("searchLucide — 기본 칸의 검색", () => {
  const tiny: IconSetData = {
    source: "t",
    version: "0",
    license: "ISC",
    viewBox: "0 0 24 24",
    icons: {
      "hard-drive": { b: "<path/>" },
      database: { b: "<path/>" },
      "database-backup": { b: "<path/>" },
      "cloud-database": { b: "<path/>" },
      "old-db": { b: "<path/>", x: 1 },
    },
    aliases: {},
  };

  it("빈 글자 = 고른 스물네 개 (표가 없어도)", () => {
    const r = searchLucide("", null);
    expect(r.total).toBe(24);
    expect(r.hits.map((h) => h.ref)).toEqual(LUCIDE_FEATURED.map(lucideRef));
    expect(r.hits[0].label).toBe(LUCIDE_FEATURED[0]);
  });

  it("표가 없으면 검색은 빈 결과", () => {
    expect(searchLucide("data", null)).toEqual({ hits: [], total: 0 });
  });

  it("이름·조각 접두사가 먼저, 중간에 든 것이 나중 · 숨김 제외", () => {
    expect(searchLucide("data", tiny).hits.map((h) => h.label)).toEqual([
      "database",
      "database-backup",
      "cloud-database",
    ]);
    expect(searchLucide("tab", tiny).hits.map((h) => h.label)).toEqual([
      "database",
      "database-backup",
      "cloud-database",
    ]);
    expect(searchLucide("old", tiny).total).toBe(0);
  });

  it("공백은 `-`, 접두사 손버릇(`svg:lucide:`)도 먹는다", () => {
    expect(searchLucide("hard drive", tiny).hits.map((h) => h.ref)).toEqual(["svg:lucide:hard-drive"]);
    expect(searchLucide("svg:lucide:hard", tiny).hits.map((h) => h.label)).toEqual(["hard-drive"]);
  });

  it("상한과 total", () => {
    const r = searchLucide("a", LUCIDE, 10);
    expect(r.hits.length).toBe(10);
    expect(r.total).toBeGreaterThan(10);
  });

  it("진짜 표에서 `database` 의 첫 칸은 database 그 자체", () => {
    const r = searchLucide("database", LUCIDE);
    expect(r.hits[0].ref).toBe("svg:lucide:database");
    expect(r.total).toBeGreaterThan(1);
  });

  it("logos 검색에는 lucide 가 섞이지 않는다", () => {
    expect(searchIcons("database", null).hits.every((h) => !h.ref.startsWith("svg:lucide:"))).toBe(true);
  });
});

describe("monoBody — 단색 실루엣 (독 실행 단추)", () => {
  it("색 칠은 잉크, 흰색 · 반전 칠은 구멍, none 은 그대로", () => {
    const out = monoBody('<path fill="#d97757"/><path fill="#FFF"/><path fill="var(--logo-mono-inverse)"/><path fill="none" stroke="#000"/>');
    expect(out).toBe(
      '<path fill="currentColor"/><path fill="var(--mono-cut, transparent)"/><path fill="var(--mono-cut, transparent)"/><path fill="none" stroke="currentColor"/>',
    );
  });

  it("그라디언트 칠도 잉크다", () => {
    expect(monoBody('<path fill="url(#g1)"/>')).toBe('<path fill="currentColor"/>');
  });

  it("여러 톤 로고는 이름별 구멍을 더한다 — PowerShell 의 _ · Bash 의 초록 막대", () => {
    for (const name of ["powershell", "bash"]) {
      const body = glyphFor(name)!.body;
      const out = monoBody(body, name);
      expect(out).toContain('fill="var(--mono-cut, transparent)"');
      expect(out).toContain('fill="currentColor"');
      expect(out).not.toMatch(/fill="#/);
    }
    // 이름이 없으면 더하지 않는다
    expect(monoBody('<path fill="#2c5591"/>')).toBe('<path fill="currentColor"/>');
  });
});
