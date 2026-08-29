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
  it("starts independent workspace and Project updates together", async () => {
    const workspace = deferred();
    const defaultProject = deferred();
    const setWorkspace = vi.fn(() => workspace.promise);
    const updateDefaultProject = vi.fn(() => defaultProject.promise);

    const completion = runAgentProfileCreationPostBindingFollowUps({
      setWorkspace,
      updateDefaultProject,
    });

    expect(setWorkspace).toHaveBeenCalledOnce();
    expect(updateDefaultProject).toHaveBeenCalledOnce();

    workspace.resolve();
    defaultProject.resolve();
    await completion;
  });
});
