import { describe, expect, it } from "vitest";
import {
  MAX_RICH_CHARS,
  columnsTable,
  csvTable,
  detectFormat,
  isShortOutput,
  jsonTable,
  jsonTableRows,
  headCommand,
  sortRows,
  splitCsvLine,
  unionColumns,
  viewsFor,
} from "$lib/block-view";

describe("detectFormat — 형식 알아보기", () => {
  it("전체가 JSON 값이면 json (객체 · 배열), 일부만이면 아니다", () => {
    expect(detectFormat('{"a":1}').format).toBe("json");
    expect(detectFormat('  [1,2,3]\n').format).toBe("json");
    expect(detectFormat('{"a":1} trailing').format).not.toBe("json");
    expect(detectFormat("42").format).toBe("raw");
  });
  it("같은 수의 쉼표로 나뉜 두 줄 이상이면 csv(따옴표 안 쉼표는 세지 않는다)", () => {
    expect(detectFormat('name,note\nx,"a, b"\ny,c').format).toBe("csv");
    expect(detectFormat("a,b\n1,2,3").format).not.toBe("csv");
    expect(detectFormat("one line, with comma").format).toBe("raw");
  });
  it("제목 · 코드 펜스 · 목록 셋이면 markdown", () => {
    expect(detectFormat("# Title\nbody").format).toBe("markdown");
    expect(detectFormat("text\n```js\nx()\n```\n").format).toBe("markdown");
    expect(detectFormat("- a\n- b\n- c").format).toBe("markdown");
    expect(detectFormat("- a\n- b").format).toBe("raw");
    expect(detectFormat("total 8\ndrwxr-xr-x 2 u u 4096 a").format).toBe("raw");
  });
  it("1MB 를 넘으면 원문만", () => {
    expect(detectFormat("[" + "1,".repeat(MAX_RICH_CHARS / 2) + "1]").format).toBe("raw");
  });
  it("보기 탭 — JSON 은 표가 될 때만 표", () => {
    expect(viewsFor(detectFormat('[{"a":1}]'))).toEqual(["tree", "table", "raw"]);
    expect(viewsFor(detectFormat('{"a":1}'))).toEqual(["tree", "raw"]);
    expect(viewsFor(detectFormat("a,b\n1,2"))).toEqual(["table", "raw"]);
    expect(viewsFor(detectFormat("# t"))).toEqual(["rendered", "raw"]);
    expect(viewsFor(detectFormat("plain"))).toEqual(["raw"]);
  });
});

describe("JSON 표", () => {
  it("최상위 객체 배열, 아니면 첫 객체 배열 값", () => {
    expect(jsonTableRows([{ a: 1 }])?.path).toBeNull();
    expect(jsonTableRows({ status: "ok", checks: [{ n: 1 }] })?.path).toBe("checks");
    expect(jsonTableRows({ a: [1, 2] })).toBeNull();
    expect(jsonTableRows([])).toBeNull();
  });
  it("열 = 키 합집합(처음 나온 차례) · 없는 칸은 null · 객체는 한 줄 JSON", () => {
    expect(unionColumns([{ a: 1, b: 2 }, { c: 3, a: 4 }])).toEqual(["a", "b", "c"]);
    expect(jsonTable([{ name: "pg", ok: true }, { name: "s3", ok: false, error: { code: 1 } }])).toEqual({
      columns: ["name", "ok", "error"],
      rows: [
        ["pg", "true", null],
        ["s3", "false", '{"code":1}'],
      ],
    });
  });
});

describe("정렬 · CSV", () => {
  const rows = [
    ["b", "10"],
    ["a", "9"],
    ["c", null],
    ["d", "100"],
  ];
  it("숫자는 수로 · 글자는 자연 순서 · 빈 칸은 늘 뒤", () => {
    expect(sortRows(rows, 1, 1).map((r) => r[0])).toEqual(["a", "b", "d", "c"]);
    expect(sortRows(rows, 1, -1).map((r) => r[0])).toEqual(["d", "b", "a", "c"]);
    expect(sortRows(rows, 0, -1).map((r) => r[0])).toEqual(["d", "c", "b", "a"]);
    expect(sortRows([["file10"], ["file9"]], 0, 1).map((r) => r[0])).toEqual(["file9", "file10"]);
  });
  it("CSV 나누기 · 표", () => {
    expect(splitCsvLine('x,"a, ""b""",z')).toEqual(["x", 'a, "b"', "z"]);
    expect(csvTable("h1,h2\n1,2\n")).toEqual({ columns: ["h1", "h2"], rows: [["1", "2"]] });
  });
});

// 실제 명령 출력의 모양 그대로(블록 출력은 화면 버퍼에서 읽은 글 — 줄 끝 공백 · 탭은 없다)
const DOCKER_PS = [
  "CONTAINER ID   IMAGE                        COMMAND                  CREATED          STATUS                     PORTS           NAMES",
  '4c01db0b339c   ubuntu:22.04                 "bash"                   17 seconds ago   Up 16 seconds              3300-3310/tcp   webapp',
  'd7886598dbe2   crosbymichael/redis:latest   "/redis-server --dir…"   33 minutes ago   Up 33 minutes              6379/tcp        redis,webapp/db',
  'f2c1a3b6e7d9   postgres:16                  "docker-entrypoint.s…"   2 hours ago      Exited (0) 5 minutes ago                   pg-old',
].join("\n");
const DF_GNU = [
  "Filesystem      Size  Used Avail Use% Mounted on",
  "udev            7.8G     0  7.8G   0% /dev",
  "tmpfs           1.6G  2.1M  1.6G   1% /run",
  "/dev/nvme0n1p2  468G  187G  258G  43% /",
  "tmpfs           7.8G     0  7.8G   0% /dev/shm",
  "tmpfs           5.0M  4.0K  5.0M   1% /run/lock",
  "/dev/nvme0n1p1  511M  6.1M  505M   2% /boot/efi",
].join("\n");
// busybox(docker-desktop WSL) — 숫자 열이 머리보다 왼쪽으로 나온다(`931.4G`)
const DF_BUSYBOX = [
  "Filesystem                Size      Used Available Use% Mounted on",
  "none                      7.7G         0      7.7G   0% /lib/modules/5.15.167.4-microsoft-standard-WSL2",
  "none                      7.7G      4.0K      7.7G   0% /mnt/host/wsl",
  "drivers                 931.4G    446.8G    484.7G  48% /usr/lib/wsl/drivers",
  "/dev/sdc                125.7M     62.3M     53.6M  54% /",
].join("\n");
const PS_AUX = [
  "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND",
  "root           1  0.0  0.1 167780 11452 ?        Ss   Oct17   0:03 /sbin/init splash",
  "root           2  0.0  0.0      0     0 ?        S    Oct17   0:00 [kthreadd]",
  "root         612  0.0  0.2  48444 17288 ?        Ss   Oct17   0:01 /lib/systemd/systemd-journald",
].join("\n");
// PowerShell `Get-Process | Select -First 5 Name,Id,WS` — 앞 빈 줄 · 구분 줄 · 오른쪽 맞춤 숫자
const PS_PROCESS = [
  "",
  "Name               Id       WS",
  "----               --       --",
  "AggregatorHost   7920 13316096",
  "aihost          26472 34357248",
  "AISelectService  4880  8081408",
  "AIXHost         19464 84418560",
  "AppActions      25432 45568000",
  "",
].join("\n");
// `Get-ChildItem` — 머리 위 머리말 · 값 안의 공백(날짜 시각) · 빈 Length
const PS_DIR = [
  "",
  "    디렉터리: C:\\Users\\me\\projects\\proj-wt\\feat-design",
  "",
  "Mode                 LastWriteTime         Length Name",
  "----                 -------------         ------ ----",
  "d----          10/18/2026    02:43                .svelte-kit",
  "d----          10/17/2026    22:56                docs",
  "-a---          10/17/2026    22:56           1081 LICENSE",
].join("\n");
// `Get-Service | Select DisplayName,Status,Name` — 첫 열의 한글이 2칸
const PS_SERVICE_KO = [
  "DisplayName                                     Status Name",
  "-----------                                     ------ ----",
  "통합 데이터 플랫폼 서비스                      Stopped ADPSvc",
  "Windows 가상 오디오 장치 프록시 서비스         Stopped ApxSvc",
  "셀룰러 시간                                    Stopped autotimesvc",
  "GameDVR 및 브로드캐스트 사용자 서비스_11ad18d8 Stopped BcastDVRUserService_11ad18d8",
].join("\n");
const KUBECTL = [
  "NAME                     READY   STATUS             RESTARTS        AGE",
  "web-7d4b9c6f5d-2xkqp     1/1     Running            0               3d4h",
  "web-7d4b9c6f5d-9mzrt     1/1     Running            2 (5h ago)      3d4h",
  "worker-5f8c7b9d4-ljx8w   0/1     CrashLoopBackOff   14 (2m3s ago)   47m",
].join("\n");

describe("줄 맞춘 표 — 표가 되는 것", () => {
  it("docker ps — CONTAINER ID 는 한 열 · 값 안의 공백은 그대로 · 빈 PORTS", () => {
    const t = columnsTable(DOCKER_PS);
    expect(t?.columns).toEqual(["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"]);
    expect(t?.rows[0]).toEqual(["4c01db0b339c", "ubuntu:22.04", '"bash"', "17 seconds ago", "Up 16 seconds", "3300-3310/tcp", "webapp"]);
    expect(t?.rows[2]).toEqual(["f2c1a3b6e7d9", "postgres:16", '"docker-entrypoint.s…"', "2 hours ago", "Exited (0) 5 minutes ago", "", "pg-old"]);
    expect(detectFormat(DOCKER_PS).format).toBe("columns");
    expect(viewsFor(detectFormat(DOCKER_PS))).toEqual(["table", "raw"]);
  });
  it("df -h — 오른쪽 맞춤 숫자 열 · Mounted on 한 열(GNU · busybox)", () => {
    const g = columnsTable(DF_GNU);
    expect(g?.columns).toEqual(["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"]);
    expect(g?.rows[2]).toEqual(["/dev/nvme0n1p2", "468G", "187G", "258G", "43%", "/"]);
    expect(g?.rows[4]).toEqual(["tmpfs", "5.0M", "4.0K", "5.0M", "1%", "/run/lock"]);
    const b = columnsTable(DF_BUSYBOX);
    expect(b?.columns).toEqual(["Filesystem", "Size", "Used", "Available", "Use%", "Mounted on"]);
    expect(b?.rows[2]).toEqual(["drivers", "931.4G", "446.8G", "484.7G", "48%", "/usr/lib/wsl/drivers"]);
    // 경로가 모두 짧아도 Mounted on 은 한 열(빈 열을 앞으로 합친다)
    expect(columnsTable(DF_GNU.split("\n").slice(0, 4).join("\n"))?.columns.at(-1)).toBe("Mounted on");
  });
  it("ps aux — 마지막 COMMAND 는 줄 끝까지(공백 포함)", () => {
    const t = columnsTable(PS_AUX);
    expect(t?.columns).toEqual(["USER", "PID", "%CPU", "%MEM", "VSZ", "RSS", "TTY", "STAT", "START", "TIME", "COMMAND"]);
    expect(t?.rows[0]).toEqual(["root", "1", "0.0", "0.1", "167780", "11452", "?", "Ss", "Oct17", "0:03", "/sbin/init splash"]);
    expect(t?.rows.length).toBe(3);
  });
  it("PowerShell 표 — 구분 줄은 행이 아니다 · 머리 위 머리말은 뺀다 · 한글은 2칸", () => {
    const p = columnsTable(PS_PROCESS);
    expect(p?.columns).toEqual(["Name", "Id", "WS"]);
    expect(p?.rows.length).toBe(5);
    expect(p?.rows[1]).toEqual(["aihost", "26472", "34357248"]);
    const d = columnsTable(PS_DIR);
    expect(d?.columns).toEqual(["Mode", "LastWriteTime", "Length", "Name"]);
    expect(d?.rows).toEqual([
      ["d----", "10/18/2026    02:43", "", ".svelte-kit"],
      ["d----", "10/17/2026    22:56", "", "docs"],
      ["-a---", "10/17/2026    22:56", "1081", "LICENSE"],
    ]);
    const s = columnsTable(PS_SERVICE_KO);
    expect(s?.columns).toEqual(["DisplayName", "Status", "Name"]);
    expect(s?.rows[0]).toEqual(["통합 데이터 플랫폼 서비스", "Stopped", "ADPSvc"]);
    expect(s?.rows[3]).toEqual(["GameDVR 및 브로드캐스트 사용자 서비스_11ad18d8", "Stopped", "BcastDVRUserService_11ad18d8"]);
  });
  it("kubectl get pods — RESTARTS 의 `2 (5h ago)` · 아래 줄 하나여도", () => {
    const t = columnsTable(KUBECTL);
    expect(t?.columns).toEqual(["NAME", "READY", "STATUS", "RESTARTS", "AGE"]);
    expect(t?.rows[2]).toEqual(["worker-5f8c7b9d4-ljx8w", "0/1", "CrashLoopBackOff", "14 (2m3s ago)", "47m"]);
    expect(columnsTable(KUBECTL.split("\n").slice(0, 2).join("\n"))?.rows).toEqual([["web-7d4b9c6f5d-2xkqp", "1/1", "Running", "0", "3d4h"]]);
  });
});

describe("줄 맞춘 표 — 표가 되면 안 되는 것", () => {
  it("탭으로 나뉜 ConvertTo-Csv 출력(버퍼에서 탭은 공백) — 원문", () => {
    const tsv = [
      '"Name"  "Id"    "WS"',
      '"AggregatorHost"        "7920"  "13324288"',
      '"aihost"        "26472" "34365440"',
      '"cargo" "18888" "31383552"',
      '"claude"        "17556" "405299200"',
    ].join("\n");
    expect(columnsTable(tsv)).toBeNull();
    expect(detectFormat(tsv).format).toBe("raw");
  });
  it("ls — 한 줄 · 여러 줄(파일 이름 · 홈 폴더)", () => {
    expect(detectFormat("CLAUDE.md  LICENSE  README.md  build  docs  package.json  src").format).toBe("raw");
    const ls = [
      "CLAUDE.md          docs               src-tauri",
      "LICENSE            node_modules       static",
      "README.ko.md       package-lock.json  svelte.config.js",
      "README.md          package.json       tsconfig.json",
      "build              scripts            vite.config.js",
      "build-target.js    src                vitest.config.ts",
    ].join("\n");
    expect(columnsTable(ls)).toBeNull();
    expect(columnsTable("Desktop    Downloads  Pictures  Templates\nDocuments  Music      Public    Videos")).toBeNull();
    expect(columnsTable("bin   dev  home  lib64  mnt  proc  run   srv  tmp  var\nboot  etc  lib   media  opt  root  sbin  sys  usr")).toBeNull();
    expect(columnsTable("total 8\ndrwxr-xr-x 2 u u 4096 Oct 18 02:43 a\n-rw-r--r-- 1 u u   12 Oct 18 02:43 b")).toBeNull();
  });
  it("평범한 문장 · 로그 줄 · 숫자만", () => {
    expect(columnsTable("Build finished successfully\nSee the log at line 42 for details\nAll done")).toBeNull();
    expect(columnsTable("On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean")).toBeNull();
    expect(columnsTable("Hello World\nFoo Bar")).toBeNull();
    const log = [
      "2026-10-18 10:41:02 INFO  server started on :8080",
      "2026-10-18 10:41:05 WARN  slow request /api/items 1204ms",
      "2026-10-18 10:41:09 INFO  GET /health 200 3ms",
    ].join("\n");
    expect(columnsTable(log)).toBeNull();
    expect(columnsTable(Array.from({ length: 13 }, (_, i) => String(i + 1)).join("\n"))).toBeNull();
    expect(columnsTable("NAME   STATUS")).toBeNull();
  });
});

describe("짧은 출력 · 명령 글자", () => {
  it("12줄 · 1500자 이하면 짧다", () => {
    expect(isShortOutput("a\nb\n")).toBe(true);
    expect(isShortOutput(Array.from({ length: 13 }, (_, i) => String(i)).join("\n"))).toBe(false);
    expect(isShortOutput("x".repeat(1501))).toBe(false);
  });
  it("길면 가운데 생략", () => {
    expect(headCommand("curl -s   localhost:8080/health | jq .")).toBe("curl -s localhost:8080/health | jq .");
    const s = headCommand("x".repeat(100), 21);
    expect(s.length).toBe(21);
    expect(s).toContain("…");
  });
});
