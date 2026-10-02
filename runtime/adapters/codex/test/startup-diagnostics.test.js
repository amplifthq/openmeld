import assert from "node:assert/strict";
import test from "node:test";
import { CodexStartupDiagnostics } from "../dist/transport/codex-startup-diagnostics.js";

test("startup diagnostics retain bounded observations without provider data", () => {
  const diagnostics = new CodexStartupDiagnostics();
  // Trace marker from Codex session/session.rs; notification fields from the
  // installed app-server's generated ServerNotification schema.
  diagnostics.observeStderr("DEBUG session_init.mcp_man");
  diagnostics.observeStderr(
    "ager_init: new /private/repo token=private-secret\n"
  );
  diagnostics.observeNotification("mcpServer/startupStatus/updated", {
    threadId: "private-thread",
    name: "private-server",
    status: "failed",
    error: "https://private-host/?token=private-secret",
    failureReason: "reauthenticationRequired",
  });
  assert.equal(
    diagnostics.summary(),
    " Observed: lastStartupPhase=mcp_manager_init; mcpStartupStatus=failed; mcpReauthenticationObserved=true."
  );
  diagnostics.observeStderr("x".repeat(100_000));
  diagnostics.observeNotification("mcpServer/startupStatus/updated", {
    status: "private-secret",
    failureReason: "private-secret",
  });
  assert.ok(diagnostics.summary().length < 200);
  assert.equal(diagnostics.summary().includes("private"), false);
});

test("missing startup evidence remains unknown rather than a fabricated cause", () => {
  const diagnostics = new CodexStartupDiagnostics();
  diagnostics.observeStderr("ERROR unrelated HTTP 401 private-secret\n");
  diagnostics.observeNotification("unrelated", { status: "failed" });
  assert.equal(diagnostics.summary(), "");
});
