export const INSTALL_RECORD_GROUP_SEPARATOR = "::";

export function toTargetKey(targetId: string, targetDir: string): string {
  return `${targetId}${INSTALL_RECORD_GROUP_SEPARATOR}${targetDir}`;
}
