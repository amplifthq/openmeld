import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SettingsField,
  settingsFieldStatusLabel,
} from "#components/settings-field";
import { SettingsRow } from "#components/settings-row";
import { SettingsSection } from "#components/settings-section";
import type { SettingsFieldStatus } from "#lib/settings-contract";

afterEach(() => {
  cleanup();
});

describe("SettingsSection", () => {
  it("is a scroll anchor (its id) with an accessible heading", () => {
    render(
      <SettingsSection id="profile" title="Profile">
        <div>body</div>
      </SettingsSection>
    );

    const section = document.getElementById("profile");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-slot")).toBe("settings-section");
    const heading = screen.getByRole("heading", { name: "Profile" });
    expect(section?.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("renders the optional description, action, and footer only when provided", () => {
    const { rerender } = render(
      <SettingsSection id="s" title="Section">
        <div>body</div>
      </SettingsSection>
    );
    expect(
      document.querySelector('[data-slot="settings-section-footer"]')
    ).toBeNull();

    rerender(
      <SettingsSection
        action={<button type="button">Header action</button>}
        description="What this section does"
        footer={<button type="button">Footer action</button>}
        id="s"
        title="Section"
      >
        <div>body</div>
      </SettingsSection>
    );
    expect(screen.getByText("What this section does")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Header action" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Footer action" })).toBeTruthy();
  });

  it("exposes the section-level status as a data attribute", () => {
    render(
      <SettingsSection id="s" status="error" title="Section">
        <div>body</div>
      </SettingsSection>
    );
    expect(
      document
        .querySelector('[data-slot="settings-section"]')
        ?.getAttribute("data-status")
    ).toBe("error");
  });

  it("does not draw divider borders between settings sections", () => {
    render(
      <SettingsSection id="s" title="Section">
        <div>body</div>
      </SettingsSection>
    );

    expect(
      document.querySelector('[data-slot="settings-section"]')?.className
    ).not.toContain("border-b");
  });

  it("accepts a caller className for page-level layout alignment", () => {
    render(
      <SettingsSection className="pt-[1.375rem]" id="s" title="Section">
        <div>body</div>
      </SettingsSection>
    );

    const className = document.querySelector(
      '[data-slot="settings-section"]'
    )?.className;
    expect(className).toContain("pb-6");
    expect(className).toContain("pt-[1.375rem]");
    expect(className).not.toContain("pt-6");
  });
});

describe("SettingsRow", () => {
  it("renders label, description, and the injected control", () => {
    render(
      <SettingsRow
        control={<button type="button">Change</button>}
        description="Your account password"
        label="Password"
      />
    );

    expect(screen.getByText("Password")).toBeTruthy();
    expect(screen.getByText("Your account password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("shows error copy under the control only when status is error", () => {
    const { rerender } = render(
      <SettingsRow
        control={<input />}
        error="Wrong password"
        label="Password"
        status="dirty"
      />
    );
    // dirty: no error copy even though `error` is provided
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <SettingsRow
        control={<input />}
        error="Wrong password"
        label="Password"
        status="error"
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Wrong password");
    expect(alert.getAttribute("data-slot")).toBe("settings-row-error");
  });

  it("color-codes the lifecycle status badge", () => {
    render(<SettingsRow control={<input />} label="Token" status="saved" />);
    const badge = document.querySelector('[data-slot="settings-field-status"]');
    expect(badge?.getAttribute("data-status")).toBe("saved");
    expect(badge?.textContent).toContain("Saved");
  });

  it("can hide the row divider for grouped controls", () => {
    render(
      <SettingsRow control={<input />} label="Token" showDivider={false} />
    );

    expect(
      document.querySelector('[data-slot="settings-row"]')?.className
    ).not.toContain("border-b");
  });

  it("can stack a full-width control below its label", () => {
    render(
      <SettingsRow
        control={<div>Full-width control</div>}
        label="Theme"
        layout="stacked"
      />
    );

    const row = document.querySelector('[data-slot="settings-row"]');
    const control = document.querySelector(
      '[data-slot="settings-row-control"]'
    );

    expect(row?.getAttribute("data-layout")).toBe("stacked");
    expect(row?.className).not.toContain("sm:flex-row");
    expect(control?.className).toContain("w-full");
    expect(control?.className).toContain("min-w-0");
    expect(control?.className).not.toContain("shrink-0");
  });
});

describe("SettingsField", () => {
  it("renders its label, control, and the status badge", () => {
    render(
      <SettingsField label="Display name" status="saving">
        <input defaultValue="Felix" />
      </SettingsField>
    );

    expect(screen.getByText("Display name")).toBeTruthy();
    const badge = document.querySelector('[data-slot="settings-field-status"]');
    expect(badge?.getAttribute("data-status")).toBe("saving");
  });

  it("programmatically associates its label with the injected control", () => {
    render(
      <SettingsField label="Service port">
        <input defaultValue="4321" />
      </SettingsField>
    );

    // The visible label is the control's accessible name (implicit <label>).
    const control = screen.getByLabelText("Service port");
    expect(control).toBeTruthy();
    expect(control.tagName).toBe("INPUT");
    expect((control as HTMLInputElement).value).toBe("4321");
  });

  it("shows error copy with role=alert only when status is error", () => {
    const { rerender } = render(
      <SettingsField error="Required" label="Name" status="idle">
        <input />
      </SettingsField>
    );
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <SettingsField error="Required" label="Name" status="error">
        <input />
      </SettingsField>
    );
    expect(screen.getByRole("alert").textContent).toBe("Required");
  });

  it("hides the status badge when idle", () => {
    render(
      <SettingsField label="Name" status="idle">
        <input />
      </SettingsField>
    );
    expect(
      document.querySelector('[data-slot="settings-field-status"]')
    ).toBeNull();
  });

  it("maps each lifecycle status to a distinct human label", () => {
    const labels: Record<SettingsFieldStatus, string> = {
      idle: settingsFieldStatusLabel("idle"),
      dirty: settingsFieldStatusLabel("dirty"),
      saving: settingsFieldStatusLabel("saving"),
      saved: settingsFieldStatusLabel("saved"),
      error: settingsFieldStatusLabel("error"),
    };
    expect(labels.idle).toBe("");
    expect(labels.dirty).not.toBe("");
    expect(labels.saving).not.toBe("");
    expect(labels.saved).not.toBe("");
    expect(labels.error).not.toBe("");
    // dirty / saving / saved / error are all distinct copy.
    const distinct = new Set([
      labels.dirty,
      labels.saving,
      labels.saved,
      labels.error,
    ]);
    expect(distinct.size).toBe(4);
  });
});
