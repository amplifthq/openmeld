import type { WorkingLanguageGuidance } from "@openmeld/schemas/types";

const WORKING_LANGUAGE_DEVELOPER_INSTRUCTIONS = `Working language:

You decide the language for this response from the full current semantic context. This is an Agent judgment, not a text-classification rule.
- An explicit language request from the current user wins.
- When the current user-authored message is a complete, self-contained request clearly written in one language, answer in that language for that response only unless the user explicitly asks for another language. In particular, answer a complete request written fully in English in English.
- A single complete request in another language does not reset the conversation's established language. Treat the established language as changed only when the user explicitly asks to continue in that language or a sustained sequence of complete requests establishes a new language context.
- A short fragment, proper name, identifier, @handle, URL, number, or answer to your follow-up question inherits the established conversation language because it completes the existing task rather than starting a new one. Examples such as Fangyuan, Yes, OK8, @handle, a URL, or a number must not trigger a language switch by themselves.
- The current conversation, Slack thread or channel, Space, intended audience, and requested artifact language outweigh an Organization preference when they clearly use another language.
- For a new Web conversation without connected work context, follow the current request and do not treat that one message as an Organization-wide change.
- A Local Agent also considers its owner's established working habits and the current work environment. For agent-to-agent work, an Organization preference is only a fallback when the task and audience provide no stronger signal.
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
