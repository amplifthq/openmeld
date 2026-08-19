import { describe, expect, it } from "vitest";
import {
  buildWorkingLanguagePromptPlan,
  renderWorkingLanguagePrompt,
} from "../src/working-language-prompt";

describe("working language prompt", () => {
  it("keeps reply-language judgment with the executing agent", () => {
    const prompt = renderWorkingLanguagePrompt();

    expect(prompt).toContain("You decide the language for this response");
    expect(prompt).toContain("fully in English");
    expect(prompt).toContain("current conversation");
    expect(prompt).toContain("final fallback");
    expect(prompt).not.toContain("detect");
  });

  it("inherits the established conversation language for follow-up fragments", () => {
    const prompt = renderWorkingLanguagePrompt();

    expect(prompt).toContain(
      "An incomplete message that continues the current task"
    );
    expect(prompt).toContain("inherits the established language");
    expect(prompt).toContain("Judge its conversational role");
    expect(prompt).toContain(
      "rather than treating the surface language of a name, value, or answer in isolation as a language switch"
    );
    for (const incidentExample of [
      "Fangyuan",
      "Yes",
      "OK8",
      "@handle",
      "https://example.com",
      "429",
    ]) {
      expect(prompt).not.toContain(incidentExample);
    }
  });

  it("separates a one-response language choice from a durable language change", () => {
    const prompt = renderWorkingLanguagePrompt();

    expect(prompt).toContain("complete, self-contained request");
    expect(prompt).toContain(
      "Referring to established task context does not make an otherwise complete request incomplete"
    );
    expect(prompt).toContain("that response only");
    expect(prompt).toContain(
      "does not reset the conversation's established language"
    );
    expect(prompt).toContain("explicitly asks to continue in that language");
    expect(prompt).toContain("sustained sequence");
  });

  it("renders a selected Organization preference as advice, not a restriction", () => {
    const prompt = renderWorkingLanguagePrompt({
      workingLanguage: { languageTag: "zh-Hans", mode: "selected" },
    });

    expect(prompt).toContain("zh-Hans");
    expect(prompt).toContain("selected by an Organization owner or admin");
    expect(prompt).toContain("advisory");
    expect(prompt).toContain("Do not force it");
  });

  it("decides the first message language from upstream evidence before authoring it", () => {
    const prompt = renderWorkingLanguagePrompt();

    expect(prompt).toContain(
      "Before writing a new work surface's first message, handoff, or delegation"
    );
    expect(prompt).toContain(
      "choose its language from the upstream user request and established context"
    );
    expect(prompt).toContain("Self-generated text is an outcome, not evidence");
    expect(prompt).toContain(
      "the receiving Agent judges again from full semantic context"
    );
  });

  it("keeps the stable decision policy separate from the per-turn hint", () => {
    const plan = buildWorkingLanguagePromptPlan({
      workingLanguage: { languageTag: "fr", mode: "automatic" },
    });

    expect(plan.developerInstructions).toContain(
      "You decide the language for this response"
    );
    expect(plan.developerInstructions).not.toContain("Observed language: fr");
    expect(plan.perTurnPrompt).toContain("Observed language: fr");
    expect(plan.perTurnPrompt).toContain("Center Agent observation");
  });
});
