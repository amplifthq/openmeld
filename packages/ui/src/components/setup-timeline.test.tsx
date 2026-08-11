import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "#components/button";
import { SetupTimeline, SetupTimelineStep } from "#components/setup-timeline";

afterEach(() => {
  cleanup();
});

describe("SetupTimeline", () => {
  it("renders setup steps with stable states and caller-owned actions", () => {
    render(
      <SetupTimeline>
        <SetupTimelineStep
          state="complete"
          summary="Requirements are ready."
          title="Check requirements"
        />
        <SetupTimelineStep
          action={<Button size="sm">Try again</Button>}
          state="blocked"
          summary="Setup needs attention."
          title="Set up this Mac"
        >
          <p>OpenMeld Desktop could not finish setup.</p>
        </SetupTimelineStep>
        <SetupTimelineStep
          state="pending"
          summary="OpenMeld Service is not ready yet."
          title="Ready for Spaces"
        />
      </SetupTimeline>
    );

    const steps = document.querySelectorAll(
      '[data-slot="setup-timeline-step"]'
    );
    expect(steps).toHaveLength(3);
    expect(steps[0]?.getAttribute("data-state")).toBe("complete");
    expect(steps[1]?.getAttribute("data-state")).toBe("blocked");
    expect(steps[2]?.getAttribute("data-state")).toBe("pending");
    expect(screen.getByText("Check requirements")).toBeTruthy();
    expect(screen.getByText("Set up this Mac")).toBeTruthy();
    expect(screen.getByText("Ready for Spaces")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(
      screen.getByText("OpenMeld Desktop could not finish setup.")
    ).toBeTruthy();
  });

  it("renders active steps with a loading indicator", () => {
    render(
      <SetupTimeline>
        <SetupTimelineStep
          state="active"
          summary="OpenMeld Desktop is setting up this Mac."
          title="Set up this Mac"
        />
      </SetupTimeline>
    );

    const step = screen
      .getByText("Set up this Mac")
      .closest('[data-slot="setup-timeline-step"]');
    expect(step?.getAttribute("data-state")).toBe("active");
    expect(within(step as HTMLElement).getByText("Loading")).toBeTruthy();
  });

  it("colors terminal disconnected labels as destructive", () => {
    render(
      <SetupTimeline>
        <SetupTimelineStep
          state="terminal_disconnected"
          summary="Terminal disconnected. Run a fresh setup command."
          title="Connect Terminal"
        />
      </SetupTimeline>
    );

    expect(screen.getByText("Connect Terminal").className).toContain(
      "text-destructive"
    );
    expect(
      screen.getByText("Terminal disconnected. Run a fresh setup command.")
        .className
    ).toContain("text-destructive");
  });
});
