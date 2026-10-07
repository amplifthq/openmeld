import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgentLogo } from "#components/local-agent-logo";

afterEach(cleanup);

describe("LocalAgentLogo", () => {
  it.each([
    "codex",
    "antigravity",
    "openclaw",
  ])("keeps each %s logo's paint references inside its own SVG when a sidebar copy is hidden", (agentId) => {
    const { container } = render(
      <>
        <aside hidden>
          <LocalAgentLogo agentId={agentId} />
        </aside>
        <main>
          <LocalAgentLogo agentId={agentId} />
          <LocalAgentLogo agentId={agentId} />
        </main>
      </>
    );
    const logos = container.querySelectorAll("main svg");
    expect(logos).toHaveLength(2);
    const ids = [...container.querySelectorAll("[id]")].map(
      (element) => element.id
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const logo of logos) {
      const paints = [...logo.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes]
          .map((attribute) => attribute.value)
          .filter((value) => value.startsWith("url(#"))
      );
      expect(paints.length).toBeGreaterThan(0);
      for (const paint of paints) {
        const id = paint.slice(5, -1);
        const definition = document.getElementById(id);
        expect(definition).not.toBeNull();
        expect(logo.contains(definition)).toBe(true);
      }
    }
  });

  it("keeps decorative vendor SVG metadata out of the pointer hover target", () => {
    render(<LocalAgentLogo agentId="claude-code" />);

    const logo = screen.getByTestId("local-agent-logo-claude-code");
    expect(logo.getAttribute("aria-hidden")).toBe("true");
    expect(logo.classList.contains("pointer-events-none")).toBe(true);
  });
});
