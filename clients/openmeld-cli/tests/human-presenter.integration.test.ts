import { describe, expect, it } from "vitest";
import { createHumanPresenter } from "../src/runtime/presenter/human";
import { withCapturedStdio } from "./helpers/fs";

const OSC_LINK = "\u001B]8;;https://openmeld.ai\u0007click\u001B]8;;\u0007";

describe("human presenter", () => {
  it("sanitizes untrusted warning and error fragments before terminal output", async () => {
    const presenter = createHumanPresenter({
      context: {
        viewMode: "human",
        resolvedView: "human",
        interactive: false,
      },
    });

    const { stderr } = await withCapturedStdio(async () => {
      await Promise.resolve();
      presenter.event("error", "connect.error", {
        error: `${OSC_LINK}\rboom\b`,
      });
    });

    expect(stderr.includes("\u001B")).toBe(false);
    expect(stderr.includes("\r")).toBe(false);
    expect(stderr.includes("\b")).toBe(false);
    expect(stderr).toContain("error: click boom");
  });
});
