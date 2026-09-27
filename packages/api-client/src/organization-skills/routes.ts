const SKILLS_PATH = "/v1/organizations/current/skills";

export function buildOrganizationSkillsPath(): string {
  return SKILLS_PATH;
}

export function buildOrganizationSkillPath(skillId: string): string {
  return `${SKILLS_PATH}/${encodeURIComponent(skillId)}`;
}

export function buildOrganizationSkillCatalogPath(skillId: string): string {
  return `${buildOrganizationSkillPath(skillId)}/catalog`;
}

export function buildOrganizationSkillResourcePath(input: {
  skillId: string;
  releaseId: string;
  path: string;
}): string {
  return `${buildOrganizationSkillPath(input.skillId)}/releases/${encodeURIComponent(input.releaseId)}/resources?path=${encodeURIComponent(input.path)}`;
}

export function buildOrganizationSkillGitHubImportPath(): string {
  return `${SKILLS_PATH}/import-github`;
}

export function buildOrganizationSkillImportBatchesPath(): string {
  return `${SKILLS_PATH}/import-github-batches`;
}

export function buildOrganizationSkillImportBatchPath(batchId: string): string {
  return `${buildOrganizationSkillImportBatchesPath()}/${encodeURIComponent(batchId)}`;
}

export function buildOrganizationSkillFilesImportPath(): string {
  return `${SKILLS_PATH}/import-files`;
}

export function buildOrganizationSkillFilesPreviewPath(): string {
  return `${SKILLS_PATH}/preview-files`;
}

export function buildOrganizationSkillGitHubPreviewPath(): string {
  return `${SKILLS_PATH}/preview-github`;
}

export function buildOrganizationSkillRepositoryPreviewPath(): string {
  return `${SKILLS_PATH}/preview-github-repository`;
}

export function buildOrganizationSkillEnabledPath(skillId: string): string {
  return `${buildOrganizationSkillPath(skillId)}/enabled`;
}

export function buildOrganizationSkillMaintainersPath(skillId: string): string {
  return `${buildOrganizationSkillPath(skillId)}/maintainers`;
}
