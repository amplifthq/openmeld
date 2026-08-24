import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Textarea } from "./textarea";

afterEach(cleanup);

describe("Textarea", () => {
  it("prevents mobile browser auto-zoom without changing desktop density", () => {
    render(<Textarea aria-label="Message" />);

    const textarea = screen.getByRole("textbox", { name: "Message" });
    expect(textarea.className).toContain("text-sm");
    expect(textarea.className).toContain("max-lg:text-base");
  });
});
