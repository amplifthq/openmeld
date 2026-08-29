export async function runAgentProfileCreationPostBindingFollowUps(input: {
  setWorkspace: () => Promise<unknown>;
  updateDefaultProject?: () => Promise<unknown>;
}): Promise<void> {
  await Promise.all([input.setWorkspace(), input.updateDefaultProject?.()]);
}
