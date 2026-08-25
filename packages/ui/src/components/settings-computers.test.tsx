import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "#components/tooltip";
import {
  SettingsLocalAgentUsageLimits,
  SettingsLocalAgentUsageSummary,
} from "./settings-computers";

const NOW_MS = Date.parse("2026-08-20T08:00:00.000Z");
const AVAILABLE_FIVE_HOUR_USAGE_GAUGE_NAME =
  /Codex 5-hour usage, 58% left, Available/u;
const EXHAUSTED_SPARK_USAGE_GAUGE_NAME =
  /Codex Spark weekly usage, 0% left, Exhausted/u;
const LOW_WEEKLY_USAGE_GAUGE_NAME =
  /Codex Weekly usage, 12% left, Low, Resets in 7 days, Updated 10 minutes ago/u;
const STALE_USAGE_GAUGE_NAME = /Codex Last-known usage, 35% left, Stale/u;
const USAGE_UNSUPPORTED_COPY = /Usage unsupported/u;

afterEach(cleanup);

describe("Settings Local Agent usage limits", () => {
  it("summarizes the most constrained window and previews every limit", async () => {
    render(
      <TooltipProvider>
        <SettingsLocalAgentUsageSummary
          agentName="Codex"
          limits={[
            {
              key: "available",
              label: "5-hour usage",
              observedAt: "2026-08-20T07:57:00.000Z",
              resetsAt: "2026-08-20T10:00:00.000Z",
              status: "available",
              usedPercent: 42,
            },
            {
              key: "low",
              label: "Weekly usage",
              observedAt: "2026-08-20T07:50:00.000Z",
              resetsAt: "2026-08-27T08:00:00.000Z",
              status: "available",
              usedPercent: 88,
            },
            {
              key: "unsupported",
              label: "Other usage",
              observedAt: "2026-08-20T07:50:00.000Z",
              resetsAt: null,
              status: "unsupported",
              usedPercent: null,
            },
          ]}
          nowMs={NOW_MS}
        />
      </TooltipProvider>
    );

    const trigger = screen.getByTestId("local-agent-usage-summary");
    expect(trigger.textContent).toBe("12%");
    expect(trigger.getAttribute("role")).toBe("progressbar");
    expect(trigger.getAttribute("aria-valuemin")).toBe("0");
    expect(trigger.getAttribute("aria-valuemax")).toBe("100");
    expect(trigger.getAttribute("aria-valuenow")).toBe("12");
    expect(trigger.getAttribute("aria-valuetext")).toBe("12% left");
    expect(trigger.getAttribute("aria-label")).toContain(
      "Codex usage limits, 12% left, Low"
    );
    expect(
      trigger.querySelectorAll("circle")[1]?.getAttribute("stroke-dasharray")
    ).toBe("12 100");

    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);

    expect(await screen.findByText("5-hour usage")).toBeTruthy();
    expect(screen.getByText("58% left · Available")).toBeTruthy();
    expect(screen.getByText("Weekly usage")).toBeTruthy();
    expect(screen.getByText("12% left · Low")).toBeTruthy();
    expect(screen.getByText("Select this agent to view details.")).toBeTruthy();
  });

  it("omits collapsed summaries when the provider reports no percentage", () => {
    const { rerender } = render(
      <TooltipProvider>
        <SettingsLocalAgentUsageSummary
          agentName="Claude Code"
          limits={[
            {
              key: "claude-code:usage-limits",
              label: "Usage limits",
              observedAt: "2026-08-20T07:59:00.000Z",
              resetsAt: null,
              status: "unsupported",
              usedPercent: null,
            },
          ]}
          nowMs={NOW_MS}
        />
      </TooltipProvider>
    );

    expect(screen.queryByTestId("local-agent-usage-summary")).toBeNull();
    expect(screen.queryByText(USAGE_UNSUPPORTED_COPY)).toBeNull();

    rerender(
      <TooltipProvider>
        <SettingsLocalAgentUsageSummary
          agentName="Cursor"
          limits={[
            {
              key: "cursor:usage-limits",
              label: "Usage limits",
              observedAt: "2026-08-20T07:59:00.000Z",
              resetsAt: null,
              status: "unavailable",
              usedPercent: null,
            },
          ]}
          nowMs={NOW_MS}
        />
      </TooltipProvider>
    );

    expect(screen.queryByTestId("local-agent-usage-summary")).toBeNull();
  });

  it("renders multiple accessible gauges and every public capacity status", () => {
    render(
      <SettingsLocalAgentUsageLimits
        agentName="Codex"
        limits={[
          {
            key: "available",
            label: "5-hour usage",
            observedAt: "2026-08-20T07:57:00.000Z",
            resetsAt: "2026-08-20T10:00:00.000Z",
            status: "available",
            usedPercent: 42,
          },
          {
            key: "low",
            label: "Weekly usage",
            observedAt: "2026-08-20T07:50:00.000Z",
            resetsAt: "2026-08-27T08:00:00.000Z",
            status: "available",
            usedPercent: 88,
          },
          {
            key: "exhausted",
            label: "Spark weekly usage",
            observedAt: "2026-08-20T07:45:00.000Z",
            resetsAt: null,
            status: "exhausted",
            usedPercent: 100,
          },
          {
            key: "stale",
            label: "Last-known usage",
            observedAt: "2026-08-19T08:00:00.000Z",
            resetsAt: "2026-08-20T07:00:00.000Z",
            status: "stale",
            usedPercent: 65,
          },
          {
            key: "unavailable",
            label: "Provider usage",
            observedAt: "2026-08-20T07:59:00.000Z",
            resetsAt: null,
            status: "unavailable",
            usedPercent: null,
          },
          {
            key: "unsupported",
            label: "Other provider usage",
            observedAt: "2026-08-20T07:59:00.000Z",
            resetsAt: null,
            status: "unsupported",
            usedPercent: null,
          },
        ]}
        nowMs={NOW_MS}
      />
    );

    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("Low")).toBeTruthy();
    expect(screen.getByText("Exhausted")).toBeTruthy();
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    const availableGauge = screen.getByRole("progressbar", {
      name: AVAILABLE_FIVE_HOUR_USAGE_GAUGE_NAME,
    });
    const lowGauge = screen.getByRole("progressbar", {
      name: LOW_WEEKLY_USAGE_GAUGE_NAME,
    });
    const exhaustedGauge = screen.getByRole("progressbar", {
      name: EXHAUSTED_SPARK_USAGE_GAUGE_NAME,
    });
    const staleGauge = screen.getByRole("progressbar", {
      name: STALE_USAGE_GAUGE_NAME,
    });
    expect(lowGauge.getAttribute("aria-valuenow")).toBe("12");
    expect(lowGauge.getAttribute("aria-valuetext")).toBe("12% left");
    expect(availableGauge.querySelectorAll("circle")).toHaveLength(2);
    expect(lowGauge.querySelectorAll("circle")).toHaveLength(2);
    expect(exhaustedGauge.querySelectorAll("circle")).toHaveLength(2);
    expect(staleGauge.querySelectorAll("circle")).toHaveLength(2);
    expect(
      availableGauge
        .querySelectorAll("circle")[1]
        ?.getAttribute("stroke-dasharray")
    ).toBe("58 100");
    expect(
      lowGauge.querySelectorAll("circle")[1]?.getAttribute("stroke-dasharray")
    ).toBe("12 100");
    expect(screen.getByText("Reset time passed")).toBeTruthy();
    expect(screen.getByText("Last updated 1 day ago")).toBeTruthy();
    expect(screen.getByText("Temporarily unavailable.")).toBeTruthy();
    expect(screen.getByText("Not reported by provider.")).toBeTruthy();
  });

  it("puts Codex's overall weekly limit first and uses the lighter detail gauge", () => {
    render(
      <SettingsLocalAgentUsageLimits
        agentName="Codex"
        limits={[
          {
            key: "codex_spark:primary",
            label: "GPT-5.3-Codex-Spark weekly usage",
            observedAt: "2026-08-20T07:50:00.000Z",
            resetsAt: "2026-08-27T08:00:00.000Z",
            status: "available",
            usedPercent: 0,
          },
          {
            key: "codex:primary",
            label: "5-hour usage",
            observedAt: "2026-08-20T07:50:00.000Z",
            resetsAt: "2026-08-20T10:00:00.000Z",
            status: "available",
            usedPercent: 0,
          },
          {
            key: "codex:secondary",
            label: "Weekly usage",
            observedAt: "2026-08-20T07:50:00.000Z",
            resetsAt: "2026-08-27T08:00:00.000Z",
            status: "available",
            usedPercent: 88,
          },
        ]}
        nowMs={NOW_MS}
      />
    );

    const grid = screen.getByTestId("local-agent-usage-limit-grid");
    expect(grid.firstElementChild?.textContent).toContain("Weekly usage");
    expect(grid.firstElementChild?.textContent).not.toContain(
      "GPT-5.3-Codex-Spark"
    );

    const weeklyGauge = screen.getByRole("progressbar", {
      name: LOW_WEEKLY_USAGE_GAUGE_NAME,
    });
    for (const circle of weeklyGauge.querySelectorAll("circle")) {
      expect(circle.getAttribute("stroke-width")).toBe("2");
    }
    expect(
      weeklyGauge.querySelector("[data-usage-limit-value]")?.className
    ).toContain("text-sm");
    expect(
      weeklyGauge.querySelector("[data-usage-limit-unit]")?.className
    ).toContain("text-[9px]");
  });

  it("keeps an absent usage-limit projection out of the product surface", () => {
    render(<SettingsLocalAgentUsageLimits agentName="Cursor" nowMs={NOW_MS} />);

    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("Not reported by provider yet.")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
