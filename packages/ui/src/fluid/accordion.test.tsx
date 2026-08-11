import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#fluid/accordion";

afterEach(cleanup);

describe("Fluid Accordion", () => {
  it("renders an expanded default item and toggles another item", () => {
    render(
      <Accordion defaultValue={["codex"]} multiple>
        <AccordionItem value="codex">
          <AccordionTrigger>Codex</AccordionTrigger>
          <AccordionContent>Codex App Server</AccordionContent>
        </AccordionItem>
        <AccordionItem value="claude-code">
          <AccordionTrigger>Claude Code</AccordionTrigger>
          <AccordionContent>Claude CLI</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    expect(screen.getByText("Codex App Server")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));

    expect(screen.getByText("Claude CLI")).toBeTruthy();
  });
});
