import stringWidth from "string-width";
import { afterEach, describe, expect, it } from "vitest";
import { buildUnifiedCardFrame } from "../src/ui/card-frame";

const originalColumnsDescriptor = Object.getOwnPropertyDescriptor(
  process.stdout,
  "columns"
);
const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(
  process.stdout,
  "isTTY"
);

describe("card frame", () => {
  afterEach(() => {
    restoreProcessStdoutProperty("columns", originalColumnsDescriptor);
    restoreProcessStdoutProperty("isTTY", originalIsTTYDescriptor);
  });

  it("wraps long rows to the available terminal width", () => {
    setProcessStdoutProperties({
      columns: 72,
      isTTY: true,
    });

    const frame = buildUnifiedCardFrame({
      title: "⚠️ OpenMeld Service Needs Attention",
      rowTextList: [
        "🔧 Next: Run `openmeld service run --mode foreground` to see the live error. The latest local service log is at `/Users/felix/.openmeld/runtime/daemon/logs/daemon-system-service.log`.",
      ],
    });

    expect(frame.rows.length).toBeGreaterThan(1);
    for (const line of [frame.top, ...frame.rows, frame.bottom]) {
      expect(stringWidth(line)).toBeLessThanOrEqual(72);
    }
  });

  it("keeps frame widths aligned when rows contain emoji", () => {
    setProcessStdoutProperties({
      columns: 90,
      isTTY: true,
    });

    const frame = buildUnifiedCardFrame({
      title: "🧩 OpenMeld Service Status",
      rowTextList: [
        "🧩 OpenMeld Service: ✅ Running — OpenMeld Service is running and the local service link is available on this device",
        "⚙️ Runtime: 🟢 Running",
      ],
    });

    const allWidths = [frame.top, frame.empty, ...frame.rows, frame.bottom].map(
      (line) => stringWidth(line)
    );
    const bodyWidths = [frame.empty, ...frame.rows, frame.bottom].map((line) =>
      stringWidth(line)
    );
    expect(new Set(bodyWidths).size).toBe(1);
    expect(new Set(allWidths).size).toBe(1);
  });
});

function setProcessStdoutProperties(input: {
  columns: number;
  isTTY: boolean;
}): void {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value: input.columns,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: input.isTTY,
  });
}

function restoreProcessStdoutProperty(
  key: "columns" | "isTTY",
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(process.stdout, key, descriptor);
    return;
  }
  Reflect.deleteProperty(process.stdout, key);
}
