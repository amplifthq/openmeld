import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "#components/tooltip";
import {
  SettingsLocalAgentUsageDockItem,
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
const OPENCODE_GO_SUMMARY_NAME = /OpenCode Go usage, 12% left, Low/u;

afterEach(cleanup);

describe("Settings Local Agent usage limits", () => {
  it("keeps dock quotas separate by computer and provider and preserves a logo without usage", async () => {
    const limit = {
      key: "weekly",
      label: "Weekly usage",
      observedAt: "2026-08-20T07:50:00.000Z",
      resetsAt: null,
      status: "available" as const,
      usedPercent: 88,
    };
    const { rerender } = render(
      <TooltipProvider>
        <SettingsLocalAgentUsageDockItem
          agentName="OpenCode"
          nowMs={NOW_MS}
          sources={[
            {
              id: "laptop",
              label: "Laptop",
              limits: [
                { ...limit, provider: { id: "go", displayName: "Go" } },
                {
                  ...limit,
                  key: "proxy",
                  usedPercent: 25,
                  provider: { id: "proxy", displayName: "Proxy" },
                },
              ],
            },
            {
              id: "desktop",
              label: "Desktop",
              limits: [{ ...limit, usedPercent: 40, status: "stale" }],
            },
          ]}
        >
          <span>Agent logo</span>
        </SettingsLocalAgentUsageDockItem>
      </TooltipProvider>
    );
    expect(
      screen
        .getAllByRole("progressbar")
        .map((ring) => ring.getAttribute("aria-valuenow"))
    ).toEqual(["12"]);
    expect(
      screen
        .getAllByRole("progressbar")
        .map((ring) => ring.getAttribute("aria-label"))
    ).toEqual(["Laptop · Go usage, 12% left, Low"]);
    expect(screen.queryByText("+2")).toBeNull();
    const trigger = screen.getByTitle("OpenCode");
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    expect(await screen.findByText("Laptop · Go")).toBeTruthy();
    expect(screen.getByText("Desktop · OpenCode")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("Stale")).toBeTruthy();
    rerender(
      <TooltipProvider>
        <SettingsLocalAgentUsageDockItem
          agentName="OpenCode"
          nowMs={NOW_MS}
          sources={[]}
        >
          <span>Agent logo</span>
        </SettingsLocalAgentUsageDockItem>
      </TooltipProvider>
    );
    expect(screen.getByText("Agent logo")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
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
    expect(screen.getByText("58%")).toBeTruthy();
    expect(screen.getByText("Weekly usage")).toBeTruthy();
    expect(screen.getAllByText("12%").length).toBeGreaterThan(0);
    expect(screen.getByText("Low")).toBeTruthy();
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

  it("shows one collapsed summary per provider and groups detail windows", () => {
    const limits = [
      {
        key: "opencode-go:rolling",
        label: "5-hour usage",
        observedAt: "2026-08-20T07:57:00.000Z",
        provider: { displayName: "OpenCode Go", id: "opencode-go" },
        resetsAt: "2026-08-20T10:00:00.000Z",
        status: "available" as const,
        usedPercent: 42,
      },
      {
        key: "opencode-go:weekly",
        label: "Weekly usage",
        observedAt: "2026-08-20T07:50:00.000Z",
        provider: { displayName: "OpenCode Go", id: "opencode-go" },
        resetsAt: "2026-08-27T08:00:00.000Z",
        status: "available" as const,
        usedPercent: 88,
      },
      {
        key: "company-proxy:daily",
        label: "Daily usage",
        observedAt: "2026-08-20T07:50:00.000Z",
        provider: { displayName: "Company Proxy", id: "company-proxy" },
        resetsAt: "2026-08-21T08:00:00.000Z",
        status: "available" as const,
        usedPercent: 25,
      },
      {
        key: "openai:provider",
        label: "Usage limits",
        observedAt: "2026-08-20T07:50:00.000Z",
        provider: { displayName: "OpenAI", id: "openai" },
        resetsAt: null,
        status: "unsupported" as const,
        usedPercent: null,
      },
    ];
    const { rerender } = render(
      <TooltipProvider>
        <SettingsLocalAgentUsageSummary
          agentName="OpenCode"
          limits={limits}
          nowMs={NOW_MS}
        />
      </TooltipProvider>
    );

    const summary = screen.getByTestId("local-agent-usage-summary");
    expect(summary.textContent).toBe("OpenCode Go12%Company Proxy75%");
    expect(within(summary).getAllByRole("progressbar")).toHaveLength(2);
    expect(
      within(summary).getByRole("progressbar", {
        name: OPENCODE_GO_SUMMARY_NAME,
      })
    ).toBeTruthy();
    expect(summary.textContent).not.toContain("OpenAI");

    rerender(
      <SettingsLocalAgentUsageLimits
        agentName="OpenCode"
        limits={limits}
        nowMs={NOW_MS}
      />
    );
    const providerGrid = screen.getByTestId("local-agent-usage-provider-grid");
    const openCodeGoGroup = within(providerGrid).getByRole("region", {
      name: "OpenCode Go usage limits",
    });
    expect(openCodeGoGroup.className).not.toContain("border");
    expect(
      within(providerGrid).queryByRole("region", {
        name: "OpenAI usage limits",
      })
    ).toBeNull();
    expect(
      within(providerGrid).getByTestId("local-agent-usage-unreported")
        .textContent
    ).toBe("Usage not supportedOpenAI");
    expect(within(providerGrid).getAllByRole("progressbar")).toHaveLength(3);
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
    expect(screen.getByText("Usage temporarily unavailable")).toBeTruthy();
    expect(screen.getByText("Usage not supported")).toBeTruthy();
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
    expect(screen.getByText("Provider usage")).toBeTruthy();
    expect(screen.getByText("Other provider usage")).toBeTruthy();
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
