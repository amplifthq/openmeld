import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../fluid/select";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "./morphing-dialog";

afterEach(cleanup);

// jsdom has no layout geometry. Exercise modal behavior with the supported
// reduced-motion variant; real-browser smoke verifies shared-layout travel.
function ReducedMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="always">{children}</MotionConfig>;
}

it("keeps the dialog open when Escape closes a portaled setting selector", async () => {
  render(
    <MorphingDialog transition={{ duration: 0 }}>
      <MorphingDialogTrigger aria-label="Edit working folder">
        Working folder
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent>
          <MorphingDialogTitle>Working folder</MorphingDialogTitle>
          <Select defaultValue="managed">
            <SelectTrigger aria-label="Folder source" />
            <SelectContent>
              <SelectItem index={0} value="managed">
                Let OpenMeld choose
              </SelectItem>
              <SelectItem index={1} value="local">
                On this computer
              </SelectItem>
            </SelectContent>
          </Select>
          <MorphingDialogClose />
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>,
    { wrapper: ReducedMotion }
  );
  const card = screen.getByRole("button", { name: "Edit working folder" });
  fireEvent.click(card);
  const select = screen.getByRole("combobox", { name: "Folder source" });
  await waitFor(() => expect(document.activeElement).toBe(select));
  fireEvent.click(select);
  const listbox = await screen.findByRole("listbox");
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() =>
    expect(select.getAttribute("aria-expanded")).toBe("false")
  );
  expect(screen.getByRole("dialog", { name: "Working folder" })).toBeTruthy();
  expect(document.activeElement).toBe(select);
  fireEvent.keyDown(select, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(card));
});

it("closes the preview without cancelling its editor and returns keyboard focus", async () => {
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
    </div>,
    { wrapper: ReducedMotion }
  );
  const trigger = screen.getByRole("button", { name: "Preview attachment" });
  fireEvent.click(trigger);
  expect(
    screen.getByRole("dialog", { name: "Attachment preview" })
  ).toBeTruthy();
  const close = screen.getByRole("button", { name: "Close dialog" });
  await waitFor(() => expect(document.activeElement).toBe(close));
  document.addEventListener("keydown", cancelEditor);
  fireEvent.keyDown(close, { key: "Escape" });
  document.removeEventListener("keydown", cancelEditor);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(cancelEditor).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(document.body.classList.contains("overflow-hidden")).toBe(false);
});
