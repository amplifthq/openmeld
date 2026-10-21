import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { describe, expect, it, type Mock, vi } from "vitest";
import { measureRenderedTerminalLinesHeight } from "../src/ui/interactive-prompt";
import {
  createSearchPromptState,
  getSearchPromptSelection,
  getSearchPromptViewModel,
  handleSearchPromptKeypress,
  promptSearchMultiselect,
  renderSearchPromptLines,
  updateSearchPromptState,
} from "../src/ui/search-select";

const UNDERLINE_ANSI = "\u001B[4m";
const RED_BACKGROUND_ESCAPE = "\u001B[41m";
const OSC_LINK =
  "\u001B]8;;https://openmeld.invalid\u0007openmeld\u001B]8;;\u0007";

describe("search select prompt", () => {
  it("filters using searchText instead of only visible labels", () => {
    const state = updateSearchPromptState(
      createSearchPromptState({
        mode: "single",
        message: "Choose a space you joined before",
        allowBack: true,
        items: [
          {
            value: "known:0",
            label: "Mission Control",
            detail: "ID abc12345...def678 · Mira · joined 5m ago",
            searchText:
              "Mission Control 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef Mira",
          },
          {
            value: "known:1",
            label: "Delta Lab",
            detail: "ID fedcba98...123456 · Felix · joined 2h ago",
            searchText:
              "Delta Lab fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210 Felix",
          },
        ],
      }),
      {
        type: "set-query",
        query: "fedcba9876543210fedcba98",
      }
    );

    const viewModel = getSearchPromptViewModel(state);

    expect(viewModel.filteredIndexes).toEqual([1]);
    expect(viewModel.visibleRows[0]).toMatchObject({
      kind: "item",
      item: expect.objectContaining({
        label: "Delta Lab",
      }),
    });
  });

  it("shows hidden counts while arrow navigation scrolls the window", () => {
    let state = createSearchPromptState({
      mode: "single",
      message: "Choose a space you joined before",
      allowBack: true,
      maxVisible: 3,
      items: Array.from({ length: 7 }, (_, index) => ({
        value: `known:${String(index)}`,
        label: `Space ${String(index + 1)}`,
        detail: `ID ${String(index + 1).repeat(8)}...${String(index + 1).repeat(6)} · Creator · joined ${String(index + 1)}h ago`,
      })),
    });

    state = updateSearchPromptState(state, {
      type: "move",
      delta: 3,
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines).toContain("│  ↑ 2 more  ↓ 2 more");
    expect(lines).toContain("│ ❯ ● Space 4");
  });

  it("shows enter-based hint text for single-select prompts", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Choose a space",
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: "Mission Control",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines).toContain("│  ↑↓ move, Press `Enter` to select, Esc back");
  });

  it("shows browse-only hint text for read-only prompts", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Browse tracked targets",
      allowBack: true,
      readOnly: true,
      items: [
        {
          value: "target:1",
          label: "Up to date · Codex",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines).toContain("│  ↑↓ browse, type to filter, Esc back");
    expect(lines).not.toContain(
      "│  ↑↓ move, Press `Enter` to select, Esc back"
    );
    expect(lines).toContain("│ ❯ Up to date · Codex");
  });

  it("renders prompt notice lines inside a notification card above the search box", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Choose a space",
      noticeLines: [
        "Removed from your space list: Deleted Mission (deleted by Mira Sidecar).",
      ],
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: "Mission Control",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));
    const titleIndex = lines.findIndex((line) =>
      line.includes("⚠️ Notification")
    );
    const noticeIndex = lines.findIndex((line) =>
      line.includes(
        "⚠️ Removed from your space list: Deleted Mission (deleted by Mira Sidecar)."
      )
    );
    const searchIndex = lines.indexOf("│  Search:  ");

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(noticeIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeGreaterThan(noticeIndex);
  });

  it("shows space-based hint text for multi-select prompts", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Choose profiles",
      allowBack: true,
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines).toContain(
      "│  ↑↓ move, Press `Space` to select, Press `Enter` to confirm, Esc back"
    );
  });

  it("shows an Enter reminder below the multi-select summary", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Choose profiles",
      initialSelectedValues: ["profile:1"],
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    const selectedLineIndex = lines.indexOf("│  Selected: Felix");
    const reminderLineIndex = lines.indexOf("│  Press `Enter` to continue.");

    expect(selectedLineIndex).toBeGreaterThan(-1);
    expect(reminderLineIndex).toBe(selectedLineIndex + 1);
  });

  it("drives multi-select prompts from raw TTY data", async () => {
    const input = createTestInputStream();
    const output = createTestOutputStream();

    const resultPromise = promptSearchMultiselect(
      {
        message: "Choose the local agents to connect to OpenMeld",
        initialSelectedValues: ["claude-code", "codex", "opencode"],
        items: [
          { value: "claude-code", label: "Claude Code" },
          { value: "codex", label: "Codex" },
          { value: "opencode", label: "OpenCode" },
        ],
      },
      { input, output }
    );

    input.write("\u001b[B");
    input.write(" ");
    input.write("\r");

    await expect(resultPromise).resolves.toEqual({
      status: "submitted",
      value: ["claude-code", "opencode"],
    });
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
  });

  it("uses square markers for multi-select prompts", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Choose profiles",
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines).toContain("│ ❯ □ Felix");
  });

  it("returns back when the visible back row is active and enter is pressed", () => {
    let state = createSearchPromptState({
      mode: "single",
      message: "Choose a space you joined before",
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: "Mission Control",
        },
      ],
    });

    state = updateSearchPromptState(state, {
      type: "move",
      delta: 1,
    });

    const result = getSearchPromptSelection(state);
    const submittedLines = stripAnsiLines(
      renderSearchPromptLines(state, "submitted")
    );

    expect(result).toEqual({ status: "back" });
    expect(submittedLines).toContain("│  Back");
  });

  it("maps escape to back when back is enabled", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Choose a space you joined before",
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: "Mission Control",
        },
      ],
    });

    const result = handleSearchPromptKeypress({
      state,
      str: "",
      key: { name: "escape" },
    });

    expect(result).toMatchObject({
      type: "result",
      result: { status: "back" },
      status: "submitted",
      state: {
        activeRowIndex: 1,
      },
    });
  });

  it("maps ctrl+c to cancelled", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Choose a space you joined before",
      items: [
        {
          value: "known:0",
          label: "Mission Control",
        },
      ],
    });

    const result = handleSearchPromptKeypress({
      state,
      str: "",
      key: { name: "c", ctrl: true },
    });

    expect(result).toEqual({
      type: "result",
      result: { status: "cancelled" },
      status: "cancelled",
    });
  });

  it("ignores keypress events whose text payload is missing", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Choose agents",
      items: [
        {
          value: "codex",
          label: "Codex",
        },
      ],
    });

    const result = handleSearchPromptKeypress({
      state,
      str: undefined,
      key: { name: "undefined-key" },
    });

    expect(result).toEqual({
      type: "ignore",
    });
  });

  it("does not submit disabled items in single-select mode", () => {
    let state = createSearchPromptState({
      mode: "single",
      message: "Choose an agent",
      items: [
        {
          value: "codex",
          label: "Codex",
          detail: "ID codex · already enabled",
          disabled: true,
        },
        {
          value: "claude-code",
          label: "Claude Code",
        },
      ],
    });

    expect(getSearchPromptSelection(state)).toBeNull();

    state = updateSearchPromptState(state, {
      type: "move",
      delta: 1,
    });

    expect(getSearchPromptSelection(state)).toEqual({
      status: "submitted",
      value: "claude-code",
    });
  });

  it("does not toggle a disabled item into the selection in multi-select mode", () => {
    let state = createSearchPromptState({
      mode: "multiple",
      message:
        "Choose the local agents to connect to OpenMeld on this computer",
      items: [
        {
          value: "codex",
          label: "Codex",
          hint: "Found, but can't start on this device -- fix the agent and rerun setup",
          disabled: true,
        },
        {
          value: "claude-code",
          label: "Claude Code",
        },
      ],
    });

    // Space toggles the active item. The active item starts on the disabled
    // "codex" entry, so this must be a no-op that leaves nothing selected.
    const spaceResult = handleSearchPromptKeypress({
      state,
      str: " ",
      key: { name: "space" },
    });
    expect(spaceResult).toMatchObject({
      type: "state",
      state: { selectedValues: [] },
    });

    // Enter on a disabled active item must not submit it as a selection
    // either -- a launch-failed agent can never reach the returned value.
    expect(getSearchPromptSelection(state)).toEqual({
      status: "submitted",
      value: [],
    });

    // The enabled entry right after it remains fully selectable.
    state = updateSearchPromptState(state, {
      type: "move",
      delta: 1,
    });
    state = updateSearchPromptState(state, {
      type: "toggle-active",
    });
    expect(getSearchPromptSelection(state)).toEqual({
      status: "submitted",
      value: ["claude-code"],
    });
  });

  it("does not submit read-only items in single-select mode", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Browse tracked targets",
      readOnly: true,
      items: [
        {
          value: "target:codex",
          label: "Up to date · Codex",
        },
      ],
    });

    expect(getSearchPromptSelection(state)).toBeNull();
  });

  it("supports multi-select toggling and enter confirmation", () => {
    let state = createSearchPromptState({
      mode: "multiple",
      message: "Choose profiles",
      allowBack: true,
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
        {
          value: "profile:2",
          label: "Ops Agent",
        },
      ],
    });

    const toggled = handleSearchPromptKeypress({
      state,
      str: " ",
      key: { name: "space" },
    });
    if (toggled.type !== "state") {
      throw new Error("expected state transition");
    }
    state = updateSearchPromptState(toggled.state, {
      type: "move",
      delta: 1,
    });
    state = updateSearchPromptState(state, {
      type: "toggle-active",
    });

    const submitted = handleSearchPromptKeypress({
      state,
      str: "",
      key: { name: "return" },
    });

    expect(submitted).toEqual({
      type: "result",
      result: {
        status: "submitted",
        value: ["profile:1", "profile:2"],
      },
      status: "submitted",
    });
  });

  it("accepts enter key names emitted by alternate terminal runtimes", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Choose agents",
      items: [
        {
          value: "claude-code",
          label: "Claude Code",
        },
        {
          value: "codex",
          label: "Codex",
        },
      ],
      initialSelectedValues: ["claude-code", "codex"],
    });

    const submitted = handleSearchPromptKeypress({
      state,
      str: "\r",
      key: { name: "enter" },
    });

    expect(submitted).toEqual({
      type: "result",
      result: {
        status: "submitted",
        value: ["claude-code", "codex"],
      },
      status: "submitted",
    });
  });

  it("accepts raw carriage return enter events emitted without key names", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Choose agents",
      items: [
        {
          value: "claude-code",
          label: "Claude Code",
        },
        {
          value: "codex",
          label: "Codex",
        },
      ],
      initialSelectedValues: ["claude-code", "codex"],
    });

    const submitted = handleSearchPromptKeypress({
      state,
      str: "\r",
      key: { name: undefined, sequence: "\r" },
    });

    expect(submitted).toEqual({
      type: "result",
      result: {
        status: "submitted",
        value: ["claude-code", "codex"],
      },
      status: "submitted",
    });
  });

  it("renders workbench actions below the selection summary and keeps focus on the first item", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Review the profiles to bring into this space",
      allowBack: true,
      workbench: true,
      footerActions: [
        {
          value: "create_new",
          icon: "🆕",
          label: "Create new profile",
        },
        {
          value: "join_now",
          icon: "➡️",
          label: "Join this space with 1 selected profile",
          separatorBefore: true,
        },
      ],
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
      initialSelectedValues: ["profile:1"],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));
    const itemLineIndex = lines.findIndex((line) => line.includes("❯ ■ Felix"));
    const selectedLineIndex = lines.findIndex((line) =>
      line.includes("Selected: Felix")
    );
    const createLineIndex = lines.findIndex((line) =>
      line.includes("🆕 Create new profile")
    );
    const actionGapIndex = lines.findIndex(
      (line, index) => index > createLineIndex && line === "│"
    );
    const joinLineIndex = lines.findIndex((line) =>
      line.includes("➡️ Join this space with 1 selected profile")
    );
    const backGapIndex = lines.findIndex(
      (line, index) => index > joinLineIndex && line === "│"
    );
    const backLineIndex = lines.findIndex((line) => line.endsWith(" Back"));

    expect(itemLineIndex).toBeGreaterThan(-1);
    expect(createLineIndex).toBeGreaterThan(-1);
    expect(selectedLineIndex).toBeGreaterThan(itemLineIndex);
    expect(createLineIndex).toBeGreaterThan(selectedLineIndex);
    expect(actionGapIndex).toBe(createLineIndex + 1);
    expect(joinLineIndex).toBe(actionGapIndex + 1);
    expect(backGapIndex).toBe(joinLineIndex + 1);
    expect(backLineIndex).toBeGreaterThan(joinLineIndex);
    expect(backLineIndex).toBe(backGapIndex + 1);
  });

  it("toggles the active item when Enter is pressed in workbench mode", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Review the profiles to bring into this space",
      allowBack: true,
      workbench: true,
      footerActions: [
        {
          value: "join_now",
          icon: "➡️",
          label: "Join this space with 0 selected profiles",
          disabled: true,
        },
      ],
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
    });

    const result = handleSearchPromptKeypress({
      state,
      str: "",
      key: { name: "return" },
    });

    expect(result).toMatchObject({
      type: "state",
      state: {
        selectedValues: ["profile:1"],
      },
    });
  });

  it("does not submit disabled workbench actions", () => {
    let state = createSearchPromptState({
      mode: "multiple",
      message: "Review the profiles to bring into this space",
      allowBack: true,
      workbench: true,
      footerActions: [
        {
          value: "join_now",
          label: "Join this space with 0 selected profiles",
          disabled: true,
        },
      ],
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
    });

    state = updateSearchPromptState(state, {
      type: "move",
      delta: 1,
    });

    expect(getSearchPromptSelection(state)).toBeNull();
  });

  it("updates workbench actions when the selection changes", () => {
    let state = createSearchPromptState({
      mode: "multiple",
      message: "Review the profiles to bring into this space",
      allowBack: true,
      workbench: true,
      footerActionsResolver: ({ selectedValues }) => [
        {
          value: "join_now",
          icon: "➡️",
          label: `Join this space with ${String(selectedValues.length)} selected ${selectedValues.length === 1 ? "profile" : "profiles"}`,
          ...(selectedValues.length === 0 ? { disabled: true } : {}),
        },
      ],
      items: [
        {
          value: "profile:1",
          label: "Felix",
        },
      ],
    });

    let lines = stripAnsiLines(renderSearchPromptLines(state));
    expect(lines).toContain("│   ➡️ Join this space with 0 selected profiles");

    const toggled = handleSearchPromptKeypress({
      state,
      str: "",
      key: { name: "return" },
    });
    if (toggled.type !== "state") {
      throw new Error("expected state transition");
    }
    state = updateSearchPromptState(toggled.state, {
      type: "move",
      delta: 1,
    });

    lines = stripAnsiLines(renderSearchPromptLines(state));
    expect(lines).toContain("│ ❯ ➡️ Join this space with 1 selected profile");
    expect(getSearchPromptSelection(state)).toEqual({
      status: "action",
      action: "join_now",
      selectedValues: ["profile:1"],
    });
  });

  it("shows workbench actions even when there are no matching items", () => {
    const state = createSearchPromptState({
      mode: "multiple",
      message: "Review the profiles to bring into this space",
      allowBack: true,
      workbench: true,
      footerActions: [
        {
          value: "create_new",
          icon: "🆕",
          label: "Create new profile",
        },
        {
          value: "join_now",
          icon: "➡️",
          label: "Join this space with 0 selected profiles",
          disabled: true,
          separatorBefore: true,
        },
      ],
      items: [],
      emptyLabel: "No other profiles are available yet.",
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    const emptyLabelIndex = lines.findIndex((line) =>
      line.includes("No other profiles are available yet.")
    );
    const selectedLineIndex = lines.findIndex((line) =>
      line.includes("Selected: (none)")
    );
    const createLineIndex = lines.findIndex((line) =>
      line.includes("❯ 🆕 Create new profile")
    );
    const actionGapIndex = lines.findIndex(
      (line, index) => index > createLineIndex && line === "│"
    );
    const joinLineIndex = lines.findIndex((line) =>
      line.includes("➡️ Join this space with 0 selected profiles")
    );
    const backGapIndex = lines.findIndex(
      (line, index) => index > joinLineIndex && line === "│"
    );
    const backLineIndex = lines.findIndex((line) => line.endsWith(" Back"));

    expect(emptyLabelIndex).toBeGreaterThan(-1);
    expect(selectedLineIndex).toBeGreaterThan(emptyLabelIndex);
    expect(createLineIndex).toBeGreaterThan(-1);
    expect(createLineIndex).toBeGreaterThan(selectedLineIndex);
    expect(actionGapIndex).toBe(createLineIndex + 1);
    expect(joinLineIndex).toBe(actionGapIndex + 1);
    expect(backGapIndex).toBe(joinLineIndex + 1);
    expect(backLineIndex).toBeGreaterThan(joinLineIndex);
    expect(backLineIndex).toBe(backGapIndex + 1);
  });

  it("renders accented workbench action labels using the accent style", () => {
    const rendered = renderSearchPromptLines(
      createSearchPromptState({
        mode: "multiple",
        message: "Review the profiles to bring into this space",
        allowBack: true,
        workbench: true,
        footerActions: [
          {
            value: "create_new",
            icon: "🆕",
            label: "Create new profile",
          },
          {
            value: "join_now",
            icon: "➡️",
            accent: true,
            label: "Join this space with 1 selected profile",
            separatorBefore: true,
          },
        ],
        items: [],
      })
    ).join("\n");

    expect(rendered).toContain(
      pc.green("Join this space with 1 selected profile")
    );
  });

  it("renders the empty state when search returns no matches", () => {
    const state = updateSearchPromptState(
      createSearchPromptState({
        mode: "single",
        message: "Choose a space you joined before",
        allowBack: true,
        items: [
          {
            value: "known:0",
            label: "Mission Control",
          },
        ],
      }),
      {
        type: "set-query",
        query: "nope",
      }
    );

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines).toContain("│  No matches found");
    expect(lines).toContain("│ ❯ Back");
  });

  it("does not underline the active item or back row", () => {
    let state = createSearchPromptState({
      mode: "single",
      message: "Choose a space you joined before",
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: "Mission Control",
          detail: "ID abc12345...def678 · Mira · joined 5m ago",
        },
      ],
    });

    const activeItemLines = renderSearchPromptLines(state).join("\n");
    expect(activeItemLines).not.toContain(UNDERLINE_ANSI);

    state = updateSearchPromptState(state, {
      type: "move",
      delta: 1,
    });

    const activeBackLines = renderSearchPromptLines(state).join("\n");
    expect(activeBackLines).not.toContain(UNDERLINE_ANSI);
  });

  it("renders the summary card above the searchable list when provided", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "OpenMeld skills status",
      allowBack: true,
      readOnly: true,
      summaryCard: {
        title: "Summary",
        rows: [
          {
            label: "Status",
            value:
              "OpenMeld skills are up to date on all detected agents and saved installs",
          },
          {
            label: "Store directory",
            value: "/tmp/.openmeld-dev/skills",
          },
        ],
        compact: true,
      },
      items: [
        {
          value: "target:codex",
          label: "Up to date · Codex",
        },
      ],
    });

    const lines = stripAnsiLines(renderSearchPromptLines(state));

    expect(lines.some((line) => line.includes("Summary"))).toBe(true);
    expect(
      lines.some((line) =>
        line.includes("Status: OpenMeld skills are up to date")
      )
    ).toBe(true);
    expect(
      lines.some((line) =>
        line.includes("Store directory: /tmp/.openmeld-dev/skills")
      )
    ).toBe(true);
  });

  it("measures wrapped terminal height instead of only logical line count", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: "Search or move ↑↓ to select",
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: "catalog-signal-e2e-025538 - created by you",
          detail:
            "ID 6076b9cc...4b23a1 · felix · joined 1d ago · creator profile agt_fc9e5a37-f074-4dd8-ab39-3d509f616e59",
        },
      ],
    });

    const lines = renderSearchPromptLines(state);
    const renderedHeight = measureRenderedTerminalLinesHeight(lines, 40);

    expect(renderedHeight).toBeGreaterThan(lines.length);
  });

  it("sanitizes interactive labels and details sourced from untrusted text", () => {
    const state = createSearchPromptState({
      mode: "single",
      message: `${RED_BACKGROUND_ESCAPE}Choose a space${UNDERLINE_ANSI}`,
      allowBack: true,
      items: [
        {
          value: "known:0",
          label: `${RED_BACKGROUND_ESCAPE}Mission Control`,
          detail: `${OSC_LINK}\rjoined 5m ago`,
          hint: `${RED_BACKGROUND_ESCAPE}creator`,
          searchText: `${OSC_LINK}\nmission control`,
        },
      ],
    });

    const rendered = renderSearchPromptLines(state).join("\n");
    const plain = stripVTControlCharacters(rendered);

    expect(rendered.includes("\u001B]")).toBe(false);
    expect(rendered.includes(RED_BACKGROUND_ESCAPE)).toBe(false);
    expect(plain).toContain("Choose a space");
    expect(plain).toContain("Mission Control");
    expect(plain).toContain("openmeld joined 5m ago");
  });
});

function stripAnsiLines(lines: string[]): string[] {
  return lines.map((line) => stripVTControlCharacters(line));
}

type TestInputStream = NodeJS.ReadStream & {
  setRawMode: Mock<(mode: boolean) => TestInputStream>;
};

function createTestInputStream(): TestInputStream {
  const input = new PassThrough() as unknown as TestInputStream;
  input.isTTY = true;
  input.setRawMode = vi.fn<(mode: boolean) => TestInputStream>();
  return input;
}

function createTestOutputStream(): NodeJS.WriteStream {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as NodeJS.WriteStream;
  output.isTTY = true;
  output.columns = 80;
  return output;
}
