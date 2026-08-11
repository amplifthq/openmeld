import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandBlock } from "./command-block";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "clipboard"
);

afterEach(() => {
  cleanup();
  if (clipboardDescriptor) {
    Object.defineProperty(window.navigator, "clipboard", clipboardDescriptor);
  } else {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  }
});

describe("CommandBlock", () => {
  it("renders a linked label and command", () => {
    render(
      <CommandBlock
        command="npx openmeld"
        label="NPM"
        labelHref="https://www.npmjs.com/package/openmeld"
      />
    );

    expect(screen.getByText("npx openmeld")).toBeTruthy();
    expect(screen.getByRole("link", { name: "NPM" }).getAttribute("href")).toBe(
      "https://www.npmjs.com/package/openmeld"
    );
    expect(
      screen.getByRole("button", { name: "Copy command: npx openmeld" })
    ).toBeTruthy();
  });

  it("copies the command and shows copied feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<CommandBlock command="npx openmeld" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy command: npx openmeld" })
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("npx openmeld");
    });
    expect(
      screen.getByRole("button", { name: "Copied: npx openmeld" })
    ).toBeTruthy();
  });
});
