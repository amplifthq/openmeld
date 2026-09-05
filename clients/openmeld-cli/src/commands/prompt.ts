import {
  getPromptGuideCatalogEntry,
  resolvePromptGuideTopic,
} from "../prompt/guide-catalog";
import {
  buildPromptGuideJson,
  renderPromptGuideText,
} from "../prompt/guide-output";
import { readBundledOpenMeldCliSkillDocumentByPath } from "../skills/bundled-assets";
import { collectSkillsReadinessSnapshot } from "../skills/installation-inventory";
import { outJsonLine } from "../ui/io";

export async function runPrompt(input?: {
  topic?: string;
  raw?: boolean;
  json?: boolean;
}): Promise<void> {
  if (input?.raw && input?.json) {
    throw new Error(
      "`openmeld prompt` does not allow --raw together with --json"
    );
  }

  const topic = resolvePromptGuideTopic(input?.topic);
  const entry = getPromptGuideCatalogEntry({
    topic,
    skillsReadiness: input?.raw
      ? null
      : await collectSkillsReadinessSnapshot().catch(() => null),
  });

  if (input?.raw) {
    process.stdout.write(
      await readBundledOpenMeldCliSkillDocumentByPath(entry.sourcePath)
    );
    return;
  }

  if (input?.json) {
    outJsonLine(buildPromptGuideJson(entry.guide));
    return;
  }

  process.stdout.write(renderPromptGuideText(entry.guide));
}
