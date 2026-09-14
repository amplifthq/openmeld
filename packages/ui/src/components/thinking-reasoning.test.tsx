import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingReasoning } from "./thinking-reasoning";

afterEach(cleanup);

describe("ThinkingReasoning", () => {
  it("keeps the user's disclosure choice across tool and reasoning phases", () => {
    const { container, rerender, getByRole } = render(
      <ThinkingReasoning streaming text="First thought" />
    );
    const header = getByRole("button");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    rerender(<ThinkingReasoning streaming={false} text="First thought" />);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const viewport = getByRole("region", { name: "Live reasoning" });
    Object.defineProperty(viewport, "scrollHeight", { value: 600 });
    Object.defineProperty(viewport, "clientHeight", { value: 200 });
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);
    fireEvent.click(header);
    rerender(<ThinkingReasoning streaming text="Next thought" />);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Next thought");
    fireEvent.click(header);
    expect(container.textContent).toContain("Next thought");
    expect(viewport.scrollTop).toBe(600);
  });
});
