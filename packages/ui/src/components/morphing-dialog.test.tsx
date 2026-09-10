import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "./morphing-dialog";

afterEach(cleanup);

it("closes the preview without cancelling its editor and returns keyboard focus", () => {
  const cancelEditor = vi.fn();
  render(
    <div>
      <MorphingDialog transition={{ duration: 0 }}>
        <MorphingDialogTrigger aria-label="Preview attachment">
          Image
        </MorphingDialogTrigger>
        <MorphingDialogContainer>
          <MorphingDialogContent>
            <MorphingDialogTitle>Attachment preview</MorphingDialogTitle>
            <MorphingDialogClose />
          </MorphingDialogContent>
        </MorphingDialogContainer>
      </MorphingDialog>
    </div>
  );
  const trigger = screen.getByRole("button", { name: "Preview attachment" });
  fireEvent.click(trigger);
  expect(
    screen.getByRole("dialog", { name: "Attachment preview" })
  ).toBeTruthy();
  const close = screen.getByRole("button", { name: "Close dialog" });
  expect(document.activeElement).toBe(close);
  document.addEventListener("keydown", cancelEditor);
  fireEvent.keyDown(close, { key: "Escape" });
  document.removeEventListener("keydown", cancelEditor);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(cancelEditor).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.classList.contains("overflow-hidden")).toBe(false);
});
