import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMeldLetterLogoStrong } from "#components/openmeld-letter-logo-strong";

afterEach(() => {
  cleanup();
});

describe("OpenMeldLogoCore", () => {
  it("gives the strong glow enough internal bleed to fade before its filter surface ends", () => {
    const { container } = render(<OpenMeldLetterLogoStrong size={16} />);
    const glowLayer = container.querySelector(
      '[data-slot="openmeld-logo-strong-glow"]'
    );

    expect(glowLayer).toBeInstanceOf(HTMLElement);
    expect(glowLayer?.getAttribute("style")).toContain(
      "padding: var(--openmeld-logo-strong-glow-bleed)"
    );
    expect(glowLayer?.getAttribute("style")).toContain(
      "top: calc(var(--openmeld-logo-strong-glow-bleed) * -1)"
    );
    expect(glowLayer?.getAttribute("style")).toContain(
      "left: calc(var(--openmeld-logo-strong-glow-bleed) * -1)"
    );
  });
});
