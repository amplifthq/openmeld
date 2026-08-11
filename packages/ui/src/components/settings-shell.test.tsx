import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsShell } from "#components/settings-shell";

afterEach(() => {
  cleanup();
});

describe("SettingsShell", () => {
  it("lays out the nav slot and the panel children as a flex row", () => {
    render(
      <SettingsShell nav={<div>Settings nav</div>}>
        <div>Account panel</div>
      </SettingsShell>
    );

    expect(screen.getByText("Settings nav")).toBeTruthy();
    expect(screen.getByText("Account panel")).toBeTruthy();

    const shell = document.querySelector('[data-slot="settings-shell"]');
    expect(shell?.className).toContain("flex");
  });

  it("renders the nav on the sidebar surface and the panel on the recessed background", () => {
    render(
      <SettingsShell nav={<div>Nav</div>}>
        <div>Panel</div>
      </SettingsShell>
    );

    const nav = document.querySelector('[data-slot="settings-shell-nav"]');
    const panel = document.querySelector('[data-slot="settings-shell-panel"]');
    expect(nav?.className).toContain("bg-sidebar");
    expect(panel?.className).toContain("bg-background");
  });
});
