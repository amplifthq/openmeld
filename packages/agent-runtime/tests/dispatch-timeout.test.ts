import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_EXECUTION_TIMEOUT_MS,
  DEFAULT_LOCAL_ADAPTER_PROCESS_TIMEOUT_MS,
} from "../src/dispatch-timeout";

describe("dispatch-timeout", () => {
  it("does not set a fixed wall-clock timeout for normal Agent execution", () => {
    expect(DEFAULT_AGENT_EXECUTION_TIMEOUT_MS).toBeNull();
    expect(DEFAULT_LOCAL_ADAPTER_PROCESS_TIMEOUT_MS).toBeNull();
  });
});
