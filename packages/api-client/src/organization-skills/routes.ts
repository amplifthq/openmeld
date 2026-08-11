const SKILLS_PATH = "/v1/organizations/current/skills";

export function buildOrganizationSkillsPath(): string {
  return SKILLS_PATH;
}

export function buildOrganizationSkillPath(skillId: string): string {
  return `${SKILLS_PATH}/${encodeURIComponent(skillId)}`;
}

export function buildOrganizationSkillGitHubImportPath(): string {
  return `${SKILLS_PATH}/import-github`;
}

export function buildOrganizationSkillGitHubPreviewPath(): string {
  return `${SKILLS_PATH}/preview-github`;
}

export function buildOrganizationSkillEnabledPath(skillId: string): string {
  return `${buildOrganizationSkillPath(skillId)}/enabled`;
}

export function buildOrganizationSkillMaintainersPath(skillId: string): string {
  return `${buildOrganizationSkillPath(skillId)}/maintainers`;
}
