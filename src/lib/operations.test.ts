import { describe, expect, it } from "vitest";
import {
  classifyRisk,
  execEventAction,
  expiryLabel,
  reconcileExecState,
} from "$lib/operations";

/**
 * `classifyRisk` — 파괴적으로 보이는 명령에 배지를 켜는 **자문** 판정(보안 경계 아님).
 * 넓게(보수적으로) 잡는 규칙을 여기서 못 박는다.
 */
describe("classifyRisk", () => {
  it("파괴적 패턴은 dangerous", () => {
    for (const cmd of [
      "rm -rf /var/tmp",
      "rmdir old",
      "dd if=/dev/zero of=/dev/sda",
      "mkfs.ext4 /dev/sdb1",
      "sudo apt update",
      "su - root",
      "chmod 777 secret",
      "chown root:root file",
      "kill -9 1234",
      "killall node",
      "pkill -f server",
      "reboot",
      "shutdown -h now",
      "halt",
      "poweroff",
      "systemctl restart nginx",
      "systemctl stop postgres",
      "echo hi > out.txt",
      "cat a >> b",
      "find . -name '*.log' -delete",
      "git reset --hard HEAD~1",
      "truncate -s 0 app.log",
    ]) {
      expect(classifyRisk(cmd), cmd).toBe("dangerous");
    }
  });

  it("무해해 보이는 읽기 명령은 safe", () => {
    for (const cmd of [
      "ls -la",
      "cat /etc/hostname",
      "git status",
      "systemctl status nginx", // status 는 파괴적이지 않다
      "grep foo bar.txt",
      "uptime",
      "docker ps",
      "npm run build",
    ]) {
      expect(classifyRisk(cmd), cmd).toBe("safe");
    }
  });

  it("단어 경계 — 부분 문자열에 낚이지 않는다", () => {
    // 'confirm' 안의 rm, 'issue' 안의 su, 'address' 안의 dd 는 위험이 아니다.
    expect(classifyRisk("confirm changes")).toBe("safe");
    expect(classifyRisk("check the issue tracker")).toBe("safe");
    expect(classifyRisk("show the address book")).toBe("safe");
    // 'sudo' 안의 su 도 su 단독으로 오인하지 않는다(경계).
    expect(classifyRisk("kubectl get pods")).toBe("safe");
  });

  it("빈 문자열은 safe", () => {
    expect(classifyRisk("")).toBe("safe");
  });
});

/**
 * `reconcileExecState` — 관제판이 닫혀 있던 사이 놓친 최종 상태를 목록으로 메우는 판정
 * (docs/log/2026-09-20-console-fixes.md ②).
 */
describe("reconcileExecState", () => {
  it("같으면 건드리지 않는다", () => {
    for (const s of ["approved", "running", "succeeded", "failed"] as const) {
      expect(reconcileExecState(s, s), s).toBe("keep");
    }
  });

  it("아직 도는 중이면 상태만 갈아 끼운다", () => {
    expect(reconcileExecState("approved", "running")).toBe("update");
  });

  it("끝난 상태로 갔으면 결과도 다시 읽는다", () => {
    for (const s of ["succeeded", "partial", "failed", "cancelled"] as const) {
      expect(reconcileExecState("approved", s), s).toBe("update+refetch");
      expect(reconcileExecState("running", s), s).toBe("update+refetch");
    }
  });

  it("끝난 뷰가 다른 종료 상태로 정정돼도 결과를 다시 읽는다", () => {
    expect(reconcileExecState("succeeded", "partial")).toBe("update+refetch");
  });

  it("끝난 뷰가 되돌아가는 일은 없지만, 오면 상태만 따른다(백엔드가 권위)", () => {
    expect(reconcileExecState("succeeded", "running")).toBe("update");
  });
});

/**
 * `expiryLabel` — 검토 대기 만료까지 남은 시간의 **열쇠 하나**
 * (docs/log/2026-09-21-approval-ttl.md). 문구가 아니라 판단만 돌려준다.
 */
describe("expiryLabel", () => {
  const NOW = 1_700_000_000_000;

  it("만료 시각이 없으면 null — '만료 없음'", () => {
    expect(expiryLabel(null, NOW)).toBe(null);
  });

  it("남은 시간은 **올림** 분 — 30초 남았는데 0분이라 적지 않는다", () => {
    expect(expiryLabel(NOW + 12 * 60_000, NOW)).toEqual({ minutes: 12 });
    expect(expiryLabel(NOW + 30_000, NOW)).toEqual({ minutes: 1 });
    // 11분 30초 → 12분 (올림).
    expect(expiryLabel(NOW + 11 * 60_000 + 30_000, NOW)).toEqual({ minutes: 12 });
  });

  it("이미 지났으면 0분 — 다음 읽기에서 백엔드가 만료시킨다", () => {
    expect(expiryLabel(NOW, NOW)).toEqual({ minutes: 0 });
    expect(expiryLabel(NOW - 60_000, NOW)).toEqual({ minutes: 0 });
  });

  it("숫자가 아닌 값은 '만료 없음' 으로 본다 (손상된 응답 방어)", () => {
    expect(expiryLabel(Number.NaN, NOW)).toBe(null);
  });
});

/**
 * `execEventAction` — `operation-state` 이벤트가 실행 뷰를 **만들어도 되는가**
 * (docs/log/2026-09-21-approval-ttl.md). 만료·거부는 실행된 적이 없다.
 */
describe("execEventAction", () => {
  it("만료·거부는 뷰가 없으면 무시 — 카드를 만들지 않는다", () => {
    for (const s of ["expired", "rejected"] as const) {
      expect(execEventAction(s, false), s).toBe("ignore");
    }
  });

  it("만료·거부인데 뷰가 있으면 걷어낸다 (있을 수 없지만 안전하게)", () => {
    for (const s of ["expired", "rejected"] as const) {
      expect(execEventAction(s, true), s).toBe("drop");
    }
  });

  it("검토 대기는 뷰가 있든 없든 무시 — 아직 돌지 않았다 (2026-09-22 요청 즉시 이벤트)", () => {
    expect(execEventAction("awaitingApproval", false)).toBe("ignore");
    expect(execEventAction("awaitingApproval", true)).toBe("ignore");
  });

  it("나머지 상태는 뷰가 있든 없든 그대로 반영한다", () => {
    for (const s of [
      "draft",
      "approved",
      "running",
      "succeeded",
      "partial",
      "failed",
      "cancelled",
    ] as const) {
      expect(execEventAction(s, false), s).toBe("apply");
      expect(execEventAction(s, true), s).toBe("apply");
    }
  });
});
