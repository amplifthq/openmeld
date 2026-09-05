import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bars } from "#components/bars";
import { ThinkingIndicator } from "#components/thinking-indicator";
import { CheckboxGroup, CheckboxItem } from "#fluid/checkbox-group";
import { RadioGroup, RadioItem } from "#fluid/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "#fluid/select";

const layoutDescriptors = new Map<
  PropertyKey,
  PropertyDescriptor | undefined
>();
const originalWindowInnerHeight = window.innerHeight;
const originalWindowInnerWidth = window.innerWidth;

describe("Fluid Select", () => {
  beforeEach(() => {
    mockControlLayout();
  });

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalWindowInnerHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWindowInnerWidth,
    });
    restoreControlLayout();
    cleanup();
  });

  it("opens, selects an option, updates the hidden form value, and closes", async () => {
    const handleValueChange = vi.fn();

    const view = render(
      <form>
        <Select
          defaultValue="alpha"
          name="profile"
          onValueChange={handleValueChange}
        >
          <SelectTrigger aria-label="Profile" />
          <SelectContent>
            <SelectItem index={0} value="alpha">
              Alpha
            </SelectItem>
            <SelectItem index={1} value="beta">
              Beta
            </SelectItem>
          </SelectContent>
        </Select>
      </form>
    );

    const trigger = screen.getByRole("combobox", { name: "Profile" });
    expect(trigger.className).toContain("h-8");
    expect(trigger.className).toContain("max-lg:h-11");
    expect(trigger.className).toContain("max-lg:min-w-11");
    fireEvent.click(trigger);
    const betaOption = await screen.findByRole("option", { name: "Beta" });
    expect(betaOption.className).toContain("max-lg:min-h-11");

    fireEvent.click(betaOption);

    expect(handleValueChange).toHaveBeenCalledWith("beta");
    expect(
      view.container.querySelector<HTMLInputElement>('input[name="profile"]')
        ?.value
    ).toBe("beta");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("lets an embedded editor restore focus after selection and Escape", async () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    try {
      render(
        <Select
          defaultValue="alpha"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor.focus();
          }}
        >
          <SelectTrigger aria-label="Embedded relation" />
          <SelectContent>
            <SelectItem index={0} value="alpha">
              Alpha
            </SelectItem>
            <SelectItem index={1} value="beta">
              Beta
            </SelectItem>
          </SelectContent>
        </Select>
      );
      const trigger = screen.getByRole("combobox", {
        name: "Embedded relation",
      });
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole("option", { name: "Beta" }));
      await waitFor(() => expect(document.activeElement).toBe(editor));
      fireEvent.click(trigger);
      fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(document.activeElement).toBe(editor);
      });
    } finally {
      editor.remove();
    }
  });

  it("can anchor the menu above the trigger and align its end edge", async () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });

    render(
      <Select defaultValue="alpha">
        <SelectTrigger aria-label="Top profile" />
        <SelectContent align="end" side="top">
          <SelectItem index={0} value="alpha">
            Alpha
          </SelectItem>
          <SelectItem index={1} value="beta">
            Beta
          </SelectItem>
        </SelectContent>
      </Select>
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Top profile" }));
    const listbox = await screen.findByRole("listbox");
    const positioningFrame = listbox.parentElement?.parentElement;

    expect(positioningFrame?.style.bottom).toBe("50px");
    expect(positioningFrame?.style.right).toBe("304px");
    expect(positioningFrame?.style.left).toBe("");
    expect(positioningFrame?.style.top).toBe("");
    expect(listbox.style.maxHeight).toBe("142px");
  });

  it("can keep a long menu exactly as wide as its trigger", async () => {
    render(
      <Select defaultValue="alpha">
        <SelectTrigger aria-label="Working folder" />
        <SelectContent matchTriggerWidth>
          <SelectItem index={0} value="alpha">
            /Users/felix/Desktop/work/openmeld-worktrees/a-very-long-project-path
          </SelectItem>
        </SelectContent>
      </Select>
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Working folder" }));
    const listbox = await screen.findByRole("listbox");
    const positioningFrame = listbox.parentElement?.parentElement;

    expect(positioningFrame?.style.width).toBe("180px");
  });

  it("keeps a bottom-side menu inside the viewport when the trigger is near the bottom", async () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 200,
    });

    render(
      <Select defaultValue="alpha">
        <SelectTrigger aria-label="Bottom profile" />
        <SelectContent>
          <SelectItem index={0} value="alpha">
            Alpha
          </SelectItem>
          <SelectItem index={1} value="beta">
            Beta
          </SelectItem>
        </SelectContent>
      </Select>
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Bottom profile" }));
    const listbox = await screen.findByRole("listbox");
    const positioningFrame = listbox.parentElement?.parentElement;

    expect(positioningFrame?.style.bottom).toBe("50px");
    expect(positioningFrame?.style.top).toBe("");
    expect(listbox.style.maxHeight).toBe("142px");
  });

  it("closes with Escape and outside mouse down", async () => {
    renderTestSelect();

    fireEvent.click(screen.getByRole("combobox", { name: "Profile" }));
    await screen.findByRole("listbox");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Profile" }));
    await screen.findByRole("listbox");
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("ignores disabled options", async () => {
    const handleValueChange = vi.fn();
    renderTestSelect({ onValueChange: handleValueChange });

    fireEvent.click(screen.getByRole("combobox", { name: "Profile" }));
    const betaOption = await screen.findByRole("option", { name: "Beta" });

    fireEvent.click(betaOption);
    fireEvent.keyDown(betaOption, { key: "Enter" });

    expect(handleValueChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: "Profile" }).textContent
    ).toContain("Alpha");
  });

  it("moves keyboard focus through enabled options only", async () => {
    renderTestSelect();

    fireEvent.click(screen.getByRole("combobox", { name: "Profile" }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });

    const alphaOption = screen.getByRole("option", { name: "Alpha" });
    const gammaOption = screen.getByRole("option", { name: "Gamma" });

    expect(document.activeElement).toBe(alphaOption);

    fireEvent.keyDown(alphaOption, { key: "ArrowDown" });

    expect(document.activeElement).toBe(gammaOption);
  });
});

describe("Fluid RadioGroup", () => {
  beforeEach(() => {
    mockControlLayout();
  });

  afterEach(() => {
    restoreControlLayout();
    cleanup();
  });

  it("renders radio semantics and reports click selection", () => {
    const handleSelect = vi.fn();

    render(
      <RadioGroup selectedIndex={0}>
        <RadioItem index={0} label="Alpha" onSelect={vi.fn()} />
        <RadioItem index={1} label="Beta" onSelect={handleSelect} />
      </RadioGroup>
    );

    const alpha = screen.getByRole("radio", { name: "Alpha" });
    const beta = screen.getByRole("radio", { name: "Beta" });

    expect(alpha.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(beta);

    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it("supports arrow navigation and keyboard selection", () => {
    const handleSelectAlpha = vi.fn();
    const handleSelectBeta = vi.fn();

    render(
      <RadioGroup selectedIndex={0}>
        <RadioItem index={0} label="Alpha" onSelect={handleSelectAlpha} />
        <RadioItem index={1} label="Beta" onSelect={handleSelectBeta} />
      </RadioGroup>
    );

    const alpha = screen.getByRole("radio", { name: "Alpha" });
    const beta = screen.getByRole("radio", { name: "Beta" });

    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowDown" });

    expect(document.activeElement).toBe(beta);
    expect(handleSelectBeta).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(beta, { key: "Enter" });

    expect(handleSelectBeta).toHaveBeenCalledTimes(2);
  });

  it("uses horizontal geometry and arrow keys when orientation is horizontal", async () => {
    const handleSelectBeta = vi.fn();

    render(
      <RadioGroup orientation="horizontal" selectedIndex={0}>
        <RadioItem index={0} label="Alpha" onSelect={vi.fn()} />
        <RadioItem index={1} label="Beta" onSelect={handleSelectBeta} />
        <RadioItem index={2} label="Gamma" onSelect={vi.fn()} />
      </RadioGroup>
    );

    const group = screen.getByRole("radiogroup");
    const alpha = screen.getByRole("radio", { name: "Alpha" });
    const beta = screen.getByRole("radio", { name: "Beta" });

    expect(group.getAttribute("aria-orientation")).toBe("horizontal");
    expect(group.className).toContain("flex-row");
    expect(group.className).not.toContain("flex-col");

    fireEvent.mouseEnter(group);
    fireEvent.mouseMove(group, { clientX: 270, clientY: 16 });

    await waitFor(() => {
      expect(beta.querySelector(".text-foreground")).toBeTruthy();
    });

    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowRight" });

    expect(document.activeElement).toBe(beta);
    expect(handleSelectBeta).toHaveBeenCalledTimes(1);
  });
});

describe("Fluid CheckboxGroup", () => {
  beforeEach(() => {
    mockControlLayout();
  });

  afterEach(() => {
    restoreControlLayout();
    cleanup();
  });

  it("renders checkbox semantics and reports toggles", () => {
    const handleToggle = vi.fn();

    render(
      <CheckboxGroup checkedIndices={new Set([0])}>
        <CheckboxItem checked index={0} label="Alpha" onToggle={vi.fn()} />
        <CheckboxItem
          checked={false}
          index={1}
          label="Beta"
          onToggle={handleToggle}
        />
      </CheckboxGroup>
    );

    const alpha = screen.getByRole("checkbox", { name: "Alpha" });
    const beta = screen.getByRole("checkbox", { name: "Beta" });

    expect(alpha.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(beta);

    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it("supports arrow navigation and keyboard toggles", () => {
    const handleToggleAlpha = vi.fn();
    const handleToggleBeta = vi.fn();

    render(
      <CheckboxGroup checkedIndices={new Set([0])}>
        <CheckboxItem
          checked
          index={0}
          label="Alpha"
          onToggle={handleToggleAlpha}
        />
        <CheckboxItem
          checked={false}
          index={1}
          label="Beta"
          onToggle={handleToggleBeta}
        />
      </CheckboxGroup>
    );

    const alpha = screen.getByRole("checkbox", { name: "Alpha" });
    const beta = screen.getByRole("checkbox", { name: "Beta" });

    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowDown" });

    expect(document.activeElement).toBe(beta);

    fireEvent.keyDown(beta, { key: " " });

    expect(handleToggleBeta).toHaveBeenCalledTimes(1);
  });

  it("renders rich option content without changing the checkbox name", () => {
    render(
      <CheckboxGroup checkedIndices={new Set()}>
        <CheckboxItem
          adornment={<span data-testid="adornment">Folder</span>}
          checked={false}
          cornerAdornment={<span>Worktree</span>}
          description="Repository verified on this computer."
          index={0}
          label="/work/openmeld"
          labelClassName="font-mono"
          onToggle={vi.fn()}
        />
      </CheckboxGroup>
    );

    expect(
      screen.getByRole("checkbox", { name: "/work/openmeld" })
    ).toBeTruthy();
    expect(
      screen.getByText("Repository verified on this computer.")
    ).toBeTruthy();
    expect(screen.getByText("Worktree")).toBeTruthy();
    expect(screen.getByTestId("adornment")).toBeTruthy();
  });
});

describe("Status primitives", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders Bars as a loading status with the requested bar count", () => {
    const view = render(<Bars bars={4} className="h-4 w-6" />);

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(
      view.container.querySelectorAll("span[aria-hidden='true']")
    ).toHaveLength(4);
    expect(
      view.container.querySelectorAll(".loading-ui-wave-bar")
    ).toHaveLength(4);
  });

  it("renders ThinkingIndicator generic words and advances them over time", () => {
    vi.useFakeTimers();

    render(<ThinkingIndicator words={["Thinking", "Working"]} />);

    const status = screen.getByRole("status");

    expect(status.tagName).toBe("OUTPUT");
    expect(status.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    expect(status.querySelector("path")?.getAttribute("d")).toBe(
      "M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z"
    );
    expect(status.textContent).toContain("Thinking");

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByRole("status").textContent).toContain("Working");
    const wordLayers = Array.from(
      status.querySelectorAll<HTMLElement>(
        '[data-slot="thinking-indicator-word"]'
      )
    );
    expect(wordLayers.map((layer) => layer.textContent)).toEqual([
      "Thinking",
      "Working",
    ]);
    const enteringLayer = wordLayers.at(-1);
    expect(enteringLayer?.style.filter).toBe("blur(8px)");
    expect(enteringLayer?.style.transform).toContain("translateY(80%)");
  });

  it("lets a product surface provide its own ThinkingIndicator icon", () => {
    render(
      <ThinkingIndicator
        icon={<span data-testid="custom-thinking-icon" />}
        words={["Thinking"]}
      />
    );

    const status = screen.getByRole("status");
    expect(screen.getByTestId("custom-thinking-icon")).toBeTruthy();
    expect(status.querySelector("svg")).toBeNull();
  });

  it("never writes an invalid path while ThinkingIndicator starts animating", async () => {
    const animationPathWrites: string[] = [];
    const originalSetAttribute = SVGElement.prototype.setAttribute;
    vi.spyOn(SVGElement.prototype, "setAttribute").mockImplementation(
      function setAttribute(this: SVGElement, name, value) {
        if (name === "d") {
          animationPathWrites.push(String(value));
        }
        return originalSetAttribute.call(this, name, value);
      }
    );

    render(<ThinkingIndicator words={["Thinking"]} />);
    animationPathWrites.length = 0;

    await waitFor(() => {
      expect(animationPathWrites.length).toBeGreaterThan(0);
    });

    expect(animationPathWrites).not.toContain("undefined");
  });
});

function renderTestSelect(
  input: { onValueChange?: (value: string) => void } = {}
) {
  return render(
    <Select defaultValue="alpha" onValueChange={input.onValueChange}>
      <SelectTrigger aria-label="Profile" />
      <SelectContent>
        <SelectItem index={0} value="alpha">
          Alpha
        </SelectItem>
        <SelectItem disabled index={1} value="beta">
          Beta
        </SelectItem>
        <SelectItem index={2} value="gamma">
          Gamma
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function mockControlLayout() {
  const properties = {
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        if (this.getAttribute("role") === "combobox") {
          if (
            this.getAttribute("aria-label") === "Bottom profile" ||
            this.getAttribute("aria-label") === "Top profile"
          ) {
            return {
              bottom: 188,
              height: 32,
              left: 16,
              right: 196,
              top: 156,
              width: 180,
              x: 16,
              y: 156,
              toJSON: () => ({}),
            };
          }

          return {
            bottom: 40,
            height: 32,
            left: 16,
            right: 196,
            top: 8,
            width: 180,
            x: 16,
            y: 8,
            toJSON: () => ({}),
          };
        }

        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-proximity-index") ? 32 : 0;
      },
    },
    offsetLeft: {
      configurable: true,
      get(this: HTMLElement) {
        const index = Number(this.getAttribute("data-proximity-index") ?? "0");
        const isHorizontal = Boolean(
          this.closest('[aria-orientation="horizontal"]')
        );
        return isHorizontal && Number.isFinite(index) ? index * 180 : 0;
      },
    },
    offsetTop: {
      configurable: true,
      get(this: HTMLElement) {
        const index = Number(this.getAttribute("data-proximity-index") ?? "0");
        const isHorizontal = Boolean(
          this.closest('[aria-orientation="horizontal"]')
        );
        return !isHorizontal && Number.isFinite(index) ? index * 32 : 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-proximity-index") ? 180 : 0;
      },
    },
  } satisfies Record<PropertyKey, PropertyDescriptor>;

  for (const [property, descriptor] of Object.entries(properties)) {
    layoutDescriptors.set(
      property,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)
    );
    Object.defineProperty(HTMLElement.prototype, property, descriptor);
  }
}

function restoreControlLayout() {
  for (const [property, descriptor] of layoutDescriptors) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
      continue;
    }

    delete HTMLElement.prototype[property as keyof HTMLElement];
  }
  layoutDescriptors.clear();
}
