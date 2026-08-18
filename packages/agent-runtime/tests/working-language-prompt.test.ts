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

    expect(prompt).toContain("short fragment");
    expect(prompt).toContain("proper name");
    expect(prompt).toContain("answer to your follow-up question");
    expect(prompt).toContain("Fangyuan");
    expect(prompt).toContain("Yes");
    expect(prompt).toContain("OK8");
    expect(prompt).toContain("@handle");
    expect(prompt).toContain("URL");
    expect(prompt).toContain("number");
  });

  it("separates a one-response language choice from a durable language change", () => {
    const prompt = renderWorkingLanguagePrompt();

    expect(prompt).toContain("complete, self-contained request");
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
