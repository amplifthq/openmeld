import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitStartReadinessSnapshot } from "../src/commands/start-auth-and-readiness";

const { noteMock, selectMock } = vi.hoisted(() => ({
  noteMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  note: (...args: Parameters<typeof noteMock>) => noteMock(...args),
  select: (...args: Parameters<typeof selectMock>) => selectMock(...args),
}));

describe("emitStartReadinessSnapshot", () => {
  beforeEach(() => {
    noteMock.mockReset();
    selectMock.mockReset();
  });

  it("renders start setup checks without repeated status emoji noise", () => {
    emitStartReadinessSnapshot({
      runtime: {
        resolvedView: "human",
      } as never,
      presenter: {
        data: vi.fn(),
        line: vi.fn(),
      } as never,
      readiness: {
        auth: {
          status: "valid",
          email: "openmeld-dev-local-test@amplift.ai",
          authBaseUrl: "http://localhost:3000",
          gatewayUrl: "http://localhost:8080",
        },
        skills: {
          status: "up_to_date",
          targetCount: 3,
          summary: {
            upToDate: 3,
            outdated: 0,
            missing: 0,
            externalConflict: 0,
          },
        },
        agents: {
          status: "ok",
          totalBuiltins: 40,
          detectedSupported: 3,
          needsChoice: 1,
          needsRepair: 0,
          detectedNotSupportedYet: 6,
          notDetected: 31,
          candidates: [],
        },
        service: {
          status: "installed_current",
          installedVersion: "0.2.9",
          expectedVersion: "0.2.9",
          runtime: {
            status: "running",
            mode: "background",
            pid: 1234,
            startedAt: "2026-04-12T10:00:00.000Z",
            updatedAt: "2026-04-12T10:00:05.000Z",
            managedBySystemService: false,
            serviceController: "unknown",
            autoStart: false,
          },
        },
      },
    });

    expect(noteMock).toHaveBeenCalledTimes(1);
    const [content, title] = noteMock.mock.calls[0] ?? [];
    expect(title).toBe("Setup Check");
    expect(content).toContain("Sign-in: Signed in");
    expect(content).toContain("Skills Setup: Up to date.");
    expect(content).toContain("Agents: 10 found");
    expect(content).toContain("3 available to use");
    expect(content).toContain("1 need your choice");
    expect(content).toContain("OpenMeld Service Runtime: Connected");
    expect(content).not.toContain("✅");
    expect(content).not.toContain("🤖");
  });
});
