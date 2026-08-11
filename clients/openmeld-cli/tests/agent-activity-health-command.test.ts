import { afterEach, expect, it, vi } from "vitest";

const healthMocks = vi.hoisted(() => ({
  readActivity: vi.fn(() =>
    Promise.resolve({ pending: 2, permanentlyRejected: 200, retrying: 1 })
  ),
  readTaskCallbacks: vi.fn(() =>
    Promise.resolve({ pending: 3, permanentlyRejected: 4, retrying: 2 })
  ),
}));

vi.mock("../src/agent-activity/local-event-store", () => ({
  readAgentActivityOutboxHealth: healthMocks.readActivity,
}));

vi.mock("../src/agent-activity/controller-task-lifecycle-store", () => ({
  readControllerTaskLifecycleOutboxHealth: healthMocks.readTaskCallbacks,
}));

import { runActivityHealth } from "../src/agent-activity/activity-command";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("labels the bounded rejection history as recently retained evidence", async () => {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

  await runActivityHealth({});

  const output = write.mock.calls.map(([value]) => String(value)).join("");
  expect(output).toContain("Recent permanent rejections");
  expect(output).toContain("200 retained (latest 200 maximum)");
  expect(output).toContain("Task callbacks pending");
  expect(output).toContain("Task callbacks retrying");
  expect(output).toContain("Recent task callback rejections");
  expect(output).toContain("4 retained (latest 200 maximum)");
  expect(output).not.toContain("permanentlyRejected");
});
