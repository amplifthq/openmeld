import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingStepImage,
  ThinkingStepSource,
  ThinkingStepSources,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "#fluid/thinking-steps";

afterEach(cleanup);

describe("Fluid ThinkingSteps", () => {
  it("keeps streaming activity compact until the user expands it", () => {
    const onOpenChange = vi.fn();

    render(
      <ThinkingSteps defaultOpen={false} onOpenChange={onOpenChange}>
        <ThinkingStepsHeader active summary="Reading files…">
          Activity
        </ThinkingStepsHeader>
        <ThinkingStepsContent>
          <ThinkingStep
            icon={CheckCircleIcon}
            label="Ran a command"
            status="complete"
          />
          <ThinkingStep label="Reading files…" status="active" />
        </ThinkingStepsContent>
      </ThinkingSteps>
    );

    const trigger = screen.getByRole("button", {
      name: "Activity Reading files…",
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByText("Reading files…", { selector: "[aria-live]" })
    ).toBeTruthy();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
    expect(
      screen
        .getByText("Ran a command")
        .closest("[data-status]")
        ?.getAttribute("data-status")
    ).toBe("complete");
  });

  it("hides pending steps and exposes failed steps semantically", () => {
    const view = render(
      <ThinkingSteps defaultOpen>
        <ThinkingStepsHeader summary="A command ran into a problem">
          Activity
        </ThinkingStepsHeader>
        <ThinkingStepsContent>
          <ThinkingStep label="Waiting" status="pending" />
          <ThinkingStep
            icon={WarningCircleIcon}
            label="A command ran into a problem"
            status="failed"
          />
        </ThinkingStepsContent>
      </ThinkingSteps>
    );

    expect(screen.queryByText("Waiting")).toBeNull();
    expect(
      screen
        .getByText("A command ran into a problem", {
          selector: "[data-slot=thinking-step-label]",
        })
        .closest("[data-status]")
        ?.getAttribute("data-status")
    ).toBe("failed");
    expect(
      view.container.querySelector("[data-slot=thinking-step-indicator] svg")
    ).toBeTruthy();
  });

  it("renders a summary without a redundant label or separator", () => {
    render(
      <ThinkingSteps>
        <ThinkingStepsHeader aria-label="Ran a command" summary="Ran a command">
          {null}
        </ThinkingStepsHeader>
      </ThinkingSteps>
    );

    const trigger = screen.getByRole("button", { name: "Ran a command" });
    expect(trigger.textContent).toBe("Ran a command");
    expect(
      trigger.querySelector("[data-slot=thinking-steps-header-label]")
    ).toBeNull();
  });

  it("supports nested details, sources, and accessible images", () => {
    render(
      <ThinkingSteps defaultOpen>
        <ThinkingStepsHeader>Research</ThinkingStepsHeader>
        <ThinkingStepsContent>
          <ThinkingStep isLast label="Reviewed the result">
            <ThinkingStepDetails
              details={["src/index.ts", "src/index.test.ts"]}
              summary="Explored 2 files"
            />
            <ThinkingStepSources>
              <ThinkingStepSource>OpenMeld docs</ThinkingStepSource>
            </ThinkingStepSources>
            <ThinkingStepImage
              alt="A generated architecture preview"
              caption="Architecture preview"
              height={180}
              src="/architecture-preview.png"
              width={320}
            />
          </ThinkingStep>
        </ThinkingStepsContent>
      </ThinkingSteps>
    );

    const detailsTrigger = screen.getByRole("button", {
      name: "Explored 2 files",
    });
    expect(detailsTrigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(detailsTrigger);
    expect(detailsTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("src/index.ts")).toBeTruthy();
    expect(screen.getByText("OpenMeld docs")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "A generated architecture preview" })
    ).toBeTruthy();
  });
});
