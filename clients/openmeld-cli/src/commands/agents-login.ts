import {
  checkAntigravityAcpAccount,
  isAntigravityAcpLaunchContract,
} from "@openmeld/adapter-antigravity";
import { resolveAgentTargetState } from "../agents/registry";
import { acquireLock, runWithHeldLock } from "../config/lock";
import { withProbeWorkingDirectory } from "../local-service/inventory/probe-working-directory";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";

export async function runAgentsLogin(input: {
  agentId: string;
  method: string;
  view?: string;
}): Promise<void> {
  if (input.agentId !== "antigravity") {
    throw new Error("This sign-in command currently supports Antigravity ACP.");
  }
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const state = await resolveAgentTargetState(input.agentId);
  const launchContract = state?.launchContract;
  if (!(launchContract && isAntigravityAcpLaunchContract(launchContract))) {
    throw new Error(
      "Select the official Antigravity ACP installation first. Install it using Google's ACP instructions, then run openmeld agents manage to choose that installation."
    );
  }
  const lock = await acquireLock({
    openMeldProfileId: "agent-controller-auth",
    key: "antigravity-login",
  });
  await runWithHeldLock({
    lock,
    run: async () => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        presenter.line({
          code: "agents.login.start",
          text: "Signing in to the selected Antigravity ACP installation. Press Ctrl+C to cancel.",
        });
        await withProbeWorkingDirectory(async (cwd) => {
          await checkAntigravityAcpAccount({
            launchContract,
            cwd,
            signal: controller.signal,
            login: {
              methodId: input.method,
              onAuthorizationUrl: (url) => {
                presenter.line({
                  code: "agents.login.authorization_url",
                  text: `Open this link on this computer to sign in:\n${url}`,
                });
              },
            },
          });
          // Verify a new process can use the native saved account, not just the
          // authenticated process's in-memory session.
          const verification = await checkAntigravityAcpAccount({
            launchContract,
            cwd,
            signal: controller.signal,
          });
          if (verification.authStatus !== "authenticated") {
            throw new Error(
              "Antigravity could not use the saved sign-in in a new session. Try signing in again."
            );
          }
        });
        presenter.line({
          code: "agents.login.verified",
          text: "Signed in. Antigravity ACP accepted a new session. Select Check again in OpenMeld to refresh this computer's status. Usage limits are not reported.",
        });
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    },
  });
}
