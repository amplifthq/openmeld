import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsActionMenu } from "./settings-action-menu";

afterEach(cleanup);

describe("SettingsActionMenu", () => {
  it("opens menu actions and closes after selection", () => {
    const onSelect = vi.fn();

    render(
      <SettingsActionMenu
        ariaLabel="Local agents options"
        items={[{ id: "check", label: "Check agents", onSelect }]}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Local agents options" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Check agents" })).toBeNull();
  });

  it("keeps disabled actions inert", () => {
    const onSelect = vi.fn();

    render(
      <SettingsActionMenu
        ariaLabel="Local agents options"
        items={[
          { disabled: true, id: "check", label: "Checking...", onSelect },
        ]}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Local agents options" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Checking..." }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
