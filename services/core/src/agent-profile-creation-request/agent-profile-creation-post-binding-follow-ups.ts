export async function runAgentProfileCreationPostBindingFollowUps(input: {
  authorizeForOrganization?: () => Promise<unknown>;
  setWorkspace: () => Promise<unknown>;
  updateDefaultProject?: () => Promise<unknown>;
}): Promise<void> {
  await Promise.all([
    input.setWorkspace(),
    input.updateDefaultProject?.(),
    input.authorizeForOrganization?.(),
  ]);
}
