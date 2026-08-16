import { describe, expect, it } from "vitest";
import {
  organizationWorkingLanguagePreferenceResponseSchema,
  setOrganizationWorkingLanguagePreferenceBodySchema,
  workingLanguageGuidanceSchema,
  workingLanguageTagSchema,
} from "../../src/index";

describe("working language contracts", () => {
  it("canonicalizes valid BCP 47 language tags", () => {
    expect(workingLanguageTagSchema.parse("  zh-hans-cn  ")).toBe("zh-Hans-CN");
    expect(workingLanguageTagSchema.parse("EN-us")).toBe("en-US");
  });

  it("rejects locale-shaped strings that are not BCP 47 tags", () => {
    expect(workingLanguageTagSchema.safeParse("zh_CN").success).toBe(false);
    expect(workingLanguageTagSchema.safeParse("not a language").success).toBe(
      false
    );
  });

  it("keeps selected and automatic mutations explicit", () => {
    expect(
      setOrganizationWorkingLanguagePreferenceBodySchema.parse({
        languageTag: "zh-hant",
        mode: "selected",
      })
    ).toEqual({ languageTag: "zh-Hant", mode: "selected" });
    expect(
      setOrganizationWorkingLanguagePreferenceBodySchema.parse({
        mode: "automatic",
      })
    ).toEqual({ mode: "automatic" });
    expect(
      setOrganizationWorkingLanguagePreferenceBodySchema.safeParse({
        languageTag: "fr",
        mode: "automatic",
      }).success
    ).toBe(false);
  });

  it("represents an automatic observation without claiming an admin selection", () => {
    expect(
      organizationWorkingLanguagePreferenceResponseSchema.parse({
        languageTag: "es-MX",
        mode: "automatic",
        organizationId: "org_1",
        revision: 3,
        updatedAt: "2026-08-17T12:00:00.000Z",
        updatedByUserId: null,
      })
    ).toEqual({
      languageTag: "es-MX",
      mode: "automatic",
      organizationId: "org_1",
      revision: 3,
      updatedAt: "2026-08-17T12:00:00.000Z",
      updatedByUserId: null,
    });
  });

  it("requires selected preferences to include updater attribution", () => {
    expect(
      organizationWorkingLanguagePreferenceResponseSchema.safeParse({
        languageTag: "fr",
        mode: "selected",
        organizationId: "org_1",
        revision: 1,
        updatedAt: "2026-08-17T12:00:00.000Z",
        updatedByUserId: null,
      }).success
    ).toBe(false);
  });

  it("keeps the turn-time projection bounded and advisory", () => {
    expect(
      workingLanguageGuidanceSchema.parse({
        languageTag: "pt-br",
        mode: "automatic",
      })
    ).toEqual({ languageTag: "pt-BR", mode: "automatic" });
  });
});
