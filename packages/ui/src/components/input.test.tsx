import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "./input";

afterEach(cleanup);

describe("Input", () => {
  it("prevents mobile browser auto-zoom without changing desktop density", () => {
    render(<Input aria-label="Email" />);

    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input.className).toContain("h-8");
    expect(input.className).toContain("text-xs");
    expect(input.className).toContain("max-lg:h-11");
    expect(input.className).toContain("max-lg:text-base");
  });
});
