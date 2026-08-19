import type { WorkingLanguageGuidance } from "@openmeld/schemas/types";

const WORKING_LANGUAGE_DEVELOPER_INSTRUCTIONS = `Working language:

You decide the language for this response from full semantic context, not text classification.
- The current user's explicit language request wins.
- A complete, self-contained request clearly in one language controls that response only; answer a complete request written fully in English in English. Referring to established task context does not make an otherwise complete request incomplete, and the earlier conversation language must not override it.
- A single complete request in another language does not reset the conversation's established language. Change it only when the user explicitly asks to continue in that language or a sustained sequence of complete requests follows.
- An incomplete message that continues the current task inherits the established language. Judge its conversational role rather than treating the surface language of a name, value, or answer in isolation as a language switch.
- Before writing a new work surface's first message, handoff, or delegation, choose its language from the upstream user request and established context: the current conversation, Slack thread or channel, Space, intended audience, and requested artifact. Self-generated text is an outcome, not evidence. If unclear, consider the Organization preference; the receiving Agent judges again from full semantic context.
- For a new Web conversation without connected work context, follow the current request; one message never changes Organization state.
- A Local Agent also considers its owner's established working habits and current work environment.
- Keep OpenMeld product terms, code, identifiers, machine contracts, and internal maintenance text in English when translating them would reduce precision.
- If the language remains genuinely unclear, use English as the final fallback.

Never claim that a single message changed the Organization preference. Only the Core-owned settings and trusted Organization-learning paths can do that.`;

export type WorkingLanguagePromptPlan = {
  developerInstructions: string;
  perTurnPrompt: string | null;
};

export function buildWorkingLanguagePromptPlan(input?: {
  workingLanguage?: WorkingLanguageGuidance | null;
}): WorkingLanguagePromptPlan {
  const guidance = input?.workingLanguage ?? null;
  return {
    developerInstructions: WORKING_LANGUAGE_DEVELOPER_INSTRUCTIONS,
    perTurnPrompt: guidance ? renderOrganizationHint(guidance) : null,
  };
}

export function renderWorkingLanguagePrompt(input?: {
  workingLanguage?: WorkingLanguageGuidance | null;
}): string {
  const plan = buildWorkingLanguagePromptPlan(input);
  return [plan.developerInstructions, plan.perTurnPrompt]
    .filter((section): section is string => section !== null)
    .join("\n\n");
}

function renderOrganizationHint(guidance: WorkingLanguageGuidance): string {
  const origin =
    guidance.mode === "selected"
      ? "selected by an Organization owner or admin"
      : "a trusted Center Agent observation from Organization work";
  const label =
    guidance.mode === "selected" ? "Preferred language" : "Observed language";
  return `Organization working-language hint (advisory):
${label}: ${guidance.languageTag}
Source: ${origin}.
Use this only when the current request, conversation, audience, and artifact provide no stronger language signal. Do not force it, describe it as a restriction, or mention this hint unless the user asks.`;
}
