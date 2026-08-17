import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openMeldSource = readFileSync(
  new URL("../src/openmeld.ts", import.meta.url),
  "utf8"
);
const serviceSource = readFileSync(
  new URL("../src/commands/service.ts", import.meta.url),
  "utf8"
);
const startNextActionSource = readFileSync(
  new URL("../src/commands/start-next-action.ts", import.meta.url),
  "utf8"
);
const spaceMenuSource = readFileSync(
  new URL("../src/space/menu.ts", import.meta.url),
  "utf8"
);
const spaceCommandSource = readFileSync(
  new URL("../src/space/command.ts", import.meta.url),
  "utf8"
);
const PROFILE_MENU_ENTRY_CHECKS_RE =
  /runProfileMenu\(\{\s*view,\s*entryChecksHandled:\s*true,/m;
const DAEMON_RUN_AFTER_ENTRY_CHECKS_RE = /runDaemonRunAfterEntryChecks\(\{/m;
const DAEMON_RUN_ENTRY_CHECKS_RE =
  /runDaemonRunAfterEntryChecks\([\s\S]*return await runRun\(\{[\s\S]*entryChecksHandled:\s*true,/m;
const SPACE_MENU_ENTRY_CHECKS_RE =
  /runSpaceMenu\(\{[\s\S]*entryChecksHandled:\s*true,/m;
const SPACE_JOIN_ENTRY_CHECKS_RE =
  /runSpaceJoin\(\{[\s\S]*entryChecksHandled:\s*true,/m;

describe("command entry duplicate guards", () => {
  it("marks public wrappers that already passed shared entry checks", () => {
    expect(openMeldSource).toMatch(PROFILE_MENU_ENTRY_CHECKS_RE);
    expect(openMeldSource).toMatch(DAEMON_RUN_AFTER_ENTRY_CHECKS_RE);
    expect(serviceSource).toMatch(DAEMON_RUN_ENTRY_CHECKS_RE);
    expect(openMeldSource).toMatch(SPACE_MENU_ENTRY_CHECKS_RE);
    expect(openMeldSource).toMatch(SPACE_JOIN_ENTRY_CHECKS_RE);
  });

  it("keeps start-owned follow-up flows from re-running shared front-door checks", () => {
    expect(startNextActionSource).toContain("entryChecksHandled: true");
    expect(startNextActionSource).toContain("await runSpaceCreate({");
    expect(startNextActionSource).toContain("return runSpaceJoin({");
    expect(startNextActionSource).not.toContain("confirmProfileSelection");
  });

  it("keeps space menu and public space commands on wrapper-owned auth flow", () => {
    expect(spaceMenuSource).toContain("if (!input.entryChecksHandled) {");
    expect(spaceMenuSource).toContain("entryChecksHandled: true");
    expect(spaceMenuSource).not.toContain("confirmProfileSelection");
    expect(spaceCommandSource).toContain("entryChecksHandled?: boolean;");
    expect(spaceCommandSource).not.toContain("confirmProfileSelection");
    expect(spaceCommandSource).toContain("authenticatedGatewayUrl =");
    expect(spaceCommandSource).toContain(
      'buildCommandAuthenticationPromptMessage("joining a space")'
    );
  });
});
