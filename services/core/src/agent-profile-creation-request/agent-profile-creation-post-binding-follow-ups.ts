export async function runAgentProfileCreationPostBindingFollowUps(input: {
  setWorkspace: () => Promise<unknown>;
  updateDefaultProject?: () => Promise<unknown>;
}): Promise<void> {
  await input.setWorkspace();
  await input.updateDefaultProject?.();
}
