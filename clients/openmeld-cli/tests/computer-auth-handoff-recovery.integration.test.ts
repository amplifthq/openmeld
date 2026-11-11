import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

// Only the OS secret store and the Service boundaries are replaced. The
// auth-session owner, its transition journal, and the recovery decision run
// for real, so the previous owner comes from the restored payload itself.
const boundaries = vi.hoisted(() => ({
  deleteAccessToken: vi.fn(),
  readAccessToken: vi.fn(),
  revokePreparedAuthSession: vi.fn(),
  runDaemonServiceParticipationGate: vi.fn(),
  stopCurrentLaneDaemonService: vi.fn(),
  storeAccessToken: vi.fn(),
}));

vi.mock("../src/config/token-store", () => ({
  deleteAccessToken: boundaries.deleteAccessToken,
  isStoredTokenRef: () => true,
  readAccessToken: boundaries.readAccessToken,
  storeAccessToken: boundaries.storeAccessToken,
}));
vi.mock("../src/commands/service", () => ({
  bestEffortStopCurrentLaneDaemonService:
    boundaries.stopCurrentLaneDaemonService,
}));
vi.mock("../src/system/local-service-participation-gate", () => ({
  runDaemonServiceParticipationGate:
    boundaries.runDaemonServiceParticipationGate,
}));
vi.mock("../src/commands/computer-auth-session", () => ({
  revokePreparedAuthSession: boundaries.revokePreparedAuthSession,
}));
vi.mock("../src/local-service/maintenance/openmeld-tools-update-join", () => ({
  resolveExternalOpenMeldToolsUpdate: vi.fn().mockResolvedValue(null),
  waitForExternalOpenMeldToolsUpdate: vi.fn().mockResolvedValue(undefined),
}));

import {
  beginAuthSessionTransition,
  setAuthSession,
} from "../src/config/auth-session";
import type { Presenter } from "../src/runtime/presenter";
import type { RuntimeContext } from "../src/runtime/types";

const PREVIOUS_TOKEN_REF = {
  account: "openmeld-auth-previous",
  provider: "macos-keychain" as const,
  service: "sh.openmeld.auth.token",
};
const CANDIDATE_TOKEN_REF = {
  account: "openmeld-auth-candidate",
  provider: "macos-keychain" as const,
  service: "sh.openmeld.auth.token",
};

const runtime = {
  interactive: false,
  resolvedView: "agent",
  viewMode: "agent",
} satisfies RuntimeContext;

function createPresenter() {
  return {
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
    view: "agent",
  } satisfies Presenter;
}

type PreviousCredential = "found" | "locked" | "missing";

let previousCredential: PreviousCredential = "found";

// Interrupts a switch from the previous owner to a candidate, then returns
// recovery entrypoints from a fresh module graph, as a restarted CLI would
// run them without the interrupted process's in-memory credential cache.
async function interruptAccountSwitch() {
  boundaries.storeAccessToken.mockResolvedValueOnce(PREVIOUS_TOKEN_REF);
  await setAuthSession({
    accessToken: "previous-token",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: { id: "previous-owner" },
  });
  boundaries.storeAccessToken.mockResolvedValueOnce(CANDIDATE_TOKEN_REF);
  const transition = await beginAuthSessionTransition(
    {
      accessToken: "candidate-token",
      authBaseUrl: "https://auth.openmeld.invalid",
      clientId: "openmeld-cli",
      user: { id: "candidate-owner" },
    },
    { computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid" } }
  );
  await transition.rollback();
  vi.resetModules();
  const [recovery, authSession] = await Promise.all([
    import("../src/commands/computer-auth-handoff-recovery"),
    import("../src/config/auth-session"),
  ]);
  return {
    getInterruptedComputerAuthSessionRecovery:
      authSession.getInterruptedComputerAuthSessionRecovery,
    recoverInterruptedComputerAuthHandoff:
      recovery.recoverInterruptedComputerAuthHandoff,
  };
}

function readFixtureAccessToken(ref: { account: string }) {
  if (ref.account === CANDIDATE_TOKEN_REF.account) {
    return { status: "found", accessToken: "candidate-token" };
  }
  if (previousCredential === "locked") {
    return {
      status: "unavailable",
      errorMessage: "The macOS Keychain is locked.",
    };
  }
  return previousCredential === "missing"
    ? { status: "missing" }
    : { status: "found", accessToken: "previous-token" };
}

async function transitionJournalExists(home: string): Promise<boolean> {
  return await access(
    join(home, ".openmeld", "auth", "session-transition.json")
  )
    .then(() => true)
    .catch(() => false);
}

describe("interrupted Computer account-switch recovery", () => {
  beforeEach(() => {
    previousCredential = "found";
    for (const mock of Object.values(boundaries)) {
      mock.mockReset();
    }
    boundaries.deleteAccessToken.mockResolvedValue(undefined);
    boundaries.readAccessToken.mockImplementation((ref: { account: string }) =>
      Promise.resolve(readFixtureAccessToken(ref))
    );
    boundaries.stopCurrentLaneDaemonService.mockResolvedValue({
      status: "stopped",
    });
    boundaries.runDaemonServiceParticipationGate.mockResolvedValue({
      status: "aligned",
    });
    boundaries.revokePreparedAuthSession.mockResolvedValue({ ok: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          session: {
            id: "previous-session",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          user: { id: "previous-owner" },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the restore point while the previous credential is locked, then restores the previous owner", async () => {
    await withTempHome(async (home) => {
      const {
        getInterruptedComputerAuthSessionRecovery,
        recoverInterruptedComputerAuthHandoff,
      } = await interruptAccountSwitch();
      previousCredential = "locked";

      await expect(
        getInterruptedComputerAuthSessionRecovery()
      ).resolves.toMatchObject({ previousOwnerUserId: "previous-owner" });
      await expect(
        recoverInterruptedComputerAuthHandoff({
          presenter: createPresenter(),
          runtime,
        })
      ).rejects.toThrow("The macOS Keychain is locked.");

      expect(
        boundaries.runDaemonServiceParticipationGate
      ).not.toHaveBeenCalled();
      expect(boundaries.revokePreparedAuthSession).not.toHaveBeenCalled();
      await expect(transitionJournalExists(home)).resolves.toBe(true);
      await expect(
        getInterruptedComputerAuthSessionRecovery()
      ).resolves.toMatchObject({
        previousOwnerUserId: "previous-owner",
        remoteSessionRevoked: false,
        serviceReconciled: false,
      });

      previousCredential = "found";
      const presenter = createPresenter();
      await expect(
        recoverInterruptedComputerAuthHandoff({ presenter, runtime })
      ).resolves.toBe("completed");

      expect(boundaries.runDaemonServiceParticipationGate).toHaveBeenCalledWith(
        expect.objectContaining({ expectedOwnerUserId: "previous-owner" })
      );
      expect(boundaries.revokePreparedAuthSession).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "candidate-token" })
      );
      expect(presenter.line).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "setup.computer_handoff_recovery.completed",
          text: "Restored the previous computer connection.",
        })
      );
      await expect(transitionJournalExists(home)).resolves.toBe(false);
    });
  });

  it("finishes without a restore and reports the stopped Service when the previous credential is missing", async () => {
    await withTempHome(async (home) => {
      const { recoverInterruptedComputerAuthHandoff } =
        await interruptAccountSwitch();
      previousCredential = "missing";
      const presenter = createPresenter();

      await expect(
        recoverInterruptedComputerAuthHandoff({ presenter, runtime })
      ).resolves.toBe("completed");

      expect(
        boundaries.runDaemonServiceParticipationGate
      ).not.toHaveBeenCalled();
      expect(boundaries.revokePreparedAuthSession).toHaveBeenCalledTimes(1);
      expect(presenter.line).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "setup.computer_handoff_recovery.previous_sign_in_unavailable",
          data: {
            reasonCode: "session_token_missing",
            state: "invalid",
          },
        })
      );
      expect(presenter.line).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "setup.computer_handoff_recovery.completed",
          text: "Cleared the interrupted computer connection. OpenMeld Service stays stopped until this computer signs in again.",
        })
      );
      await expect(transitionJournalExists(home)).resolves.toBe(false);
    });
  });
});
