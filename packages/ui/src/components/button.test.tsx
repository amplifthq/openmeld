import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("provides a mobile touch target without changing desktop button sizes", () => {
    render(<Button size="xs">Open</Button>);

    const button = screen.getByRole("button", { name: "Open" });
    expect(button.className).toContain("h-6");
    expect(button.className).toContain("max-lg:min-h-11");
    expect(button.className).toContain("max-lg:min-w-11");
  });
});
