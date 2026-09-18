import { vi } from "vitest";
import { LOCAL_AGENT_ENVIRONMENT_ENV_VARS } from "../../src/space/local-agent-environment";

/**
 * Clear every Local Agent detection variable for the current test. The
 * commands under test read `process.env` directly, so a suite that stubs only
 * the variable it asserts on still detects the agent session that runs it —
 * the same suite then passes under one agent and fails under another.
 */
export function stubNoDetectedLocalAgentEnvironment(): void {
  for (const name of LOCAL_AGENT_ENVIRONMENT_ENV_VARS) {
    vi.stubEnv(name, undefined);
  }
}
