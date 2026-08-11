import { describe, expect, it } from "vitest";
import {
  UNINSTALL_ALL_CONFIRM_TOKEN,
  UNINSTALL_ALL_LANES_COPY,
  UNINSTALL_AUTH_TOKENS_PROMPT,
  UNINSTALL_SKILLS_PROMPT,
} from "../src/uninstall/copy";

describe("uninstall copy", () => {
  it("keeps the approved skills prompt copy", () => {
    expect(UNINSTALL_SKILLS_PROMPT).toEqual({
      title: "OpenMeld-installed skills?",
      keepLabel: "Keep the skills",
      keepHint: "Recommended",
      removeLabel: "Remove the skills",
      removeHint: "Delete what OpenMeld installed here",
    });
  });

  it("keeps the approved auth token prompt copy", () => {
    expect(UNINSTALL_AUTH_TOKENS_PROMPT).toEqual({
      title: "Your OpenMeld sign-in?",
      removeLabel: "Sign me out here",
      removeHint: "Remove the OpenMeld sign-in on this Mac",
      keepLabel: "Keep my sign-in",
      keepHint: "Recommended",
    });
  });

  it("keeps the approved all-lanes confirmation copy", () => {
    expect(UNINSTALL_ALL_CONFIRM_TOKEN).toBe("UNINSTALL ALL");
    expect(UNINSTALL_ALL_LANES_COPY).toEqual({
      title: "Remove every OpenMeld copy on this Mac?",
      detail:
        "This removes OpenMeld, OpenMeld Dev, and OpenMeld Canary from this Mac.",
      confirm: 'Type "UNINSTALL ALL" to continue.',
    });
  });
});
