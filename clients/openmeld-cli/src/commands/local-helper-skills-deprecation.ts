import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { errLine } from "../ui/io";

const REPLACEMENT_BY_ALIAS = {
  check: "openmeld doctor",
  ensure: "openmeld setup",
  install: "openmeld setup",
  uninstall: "openmeld uninstall --remove-skills",
  update: "openmeld setup",
} as const;

export type DeprecatedLocalHelperSkillsAlias =
  keyof typeof REPLACEMENT_BY_ALIAS;

export function emitLocalHelperSkillsDeprecation(
  alias: DeprecatedLocalHelperSkillsAlias
): void {
  errLine(
    formatInlineOpenMeldCliCommands(
      `Deprecated: \`openmeld skills ${alias}\` manages OpenMeld's local setup helper, not Organization Skills. Use \`${REPLACEMENT_BY_ALIAS[alias]}\` instead. This compatibility alias will be removed after one published CLI window.`
    )
  );
}
