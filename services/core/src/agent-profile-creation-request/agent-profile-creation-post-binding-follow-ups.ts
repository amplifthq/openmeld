export async function runAgentProfileCreationPostBindingFollowUps(input: {
  checkpoint: (step: "workspace" | "defaultProject") => Promise<void>;
  completed: { workspace: boolean; defaultProject: boolean };
  setWorkspace: () => Promise<unknown>;
  updateDefaultProject?: () => Promise<unknown>;
}): Promise<void> {
  if (!input.completed.workspace) {
    await input.setWorkspace();
    await input.checkpoint("workspace");
  }
  if (input.updateDefaultProject && !input.completed.defaultProject) {
    await input.updateDefaultProject();
    await input.checkpoint("defaultProject");
  }
}
