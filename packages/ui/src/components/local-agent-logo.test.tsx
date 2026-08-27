import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgentLogo } from "#components/local-agent-logo";

afterEach(cleanup);

describe("LocalAgentLogo", () => {
  it("keeps decorative vendor SVG metadata out of the pointer hover target", () => {
    render(<LocalAgentLogo agentId="claude-code" />);

    const logo = screen.getByTestId("local-agent-logo-claude-code");
    expect(logo.getAttribute("aria-hidden")).toBe("true");
    expect(logo.classList.contains("pointer-events-none")).toBe(true);
  });
});
