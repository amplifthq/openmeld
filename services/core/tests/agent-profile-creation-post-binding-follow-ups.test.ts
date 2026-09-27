import { describe, expect, it, vi } from "vitest";
import { runAgentProfileCreationPostBindingFollowUps } from "../src/agent-profile-creation-request/agent-profile-creation-post-binding-follow-ups";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Agent Profile creation post-Binding follow-ups", () => {
  it("releases the workspace mutation lease before saving Default Project", async () => {
    const workspace = deferred();
    let mutationLeaseHeld = false;
    const setWorkspace = vi.fn(async () => {
      mutationLeaseHeld = true;
      await workspace.promise;
      mutationLeaseHeld = false;
    });
    const updateDefaultProject = vi.fn(() => {
      if (mutationLeaseHeld) {
        return Promise.reject(
          new Error("profile.default_project_unavailable: lease occupied")
        );
      }
      return Promise.resolve();
    });

    const completion = runAgentProfileCreationPostBindingFollowUps({
      setWorkspace,
      updateDefaultProject,
    });

    expect(setWorkspace).toHaveBeenCalledOnce();
    expect(updateDefaultProject).not.toHaveBeenCalled();

    workspace.resolve();
    await completion;
    expect(updateDefaultProject).toHaveBeenCalledOnce();
  });

  it("does not set Default Project when the workspace outcome is unknown", async () => {
    const updateDefaultProject = vi.fn();
    await expect(
      runAgentProfileCreationPostBindingFollowUps({
        setWorkspace: () =>
          Promise.reject(new Error("workspace outcome unknown")),
        updateDefaultProject,
      })
    ).rejects.toThrow("workspace outcome unknown");
    expect(updateDefaultProject).not.toHaveBeenCalled();
  });
});
