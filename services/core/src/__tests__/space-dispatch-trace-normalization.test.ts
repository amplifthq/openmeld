import { describe, expect, it } from "vitest";
import {
  normalizeDispatchOriginTraceRecord,
  normalizeDispatchPromptTraceRecord,
} from "../space/infrastructure/d1/space-dispatch-trace-normalization";

describe("space dispatch trace normalization", () => {
  it("omits origin diagnostics when every normalized field is empty", () => {
    expect(
      normalizeDispatchOriginTraceRecord({
        agentControllerConversationId: "   ",
        agentControllerRef: "",
        resolvedAgentControllerConversationId: null,
        agentControllerConversationKind: undefined,
        effectiveRuntimeWorkingDirectory: "  ",
      })
    ).toBeNull();
  });

  it("omits prompt diagnostics when every normalized field is empty", () => {
    expect(
      normalizeDispatchPromptTraceRecord({
        promptFingerprint: "   ",
        promptLength: undefined,
        promptPreview: "",
      })
    ).toBeNull();
  });

  it("drops negative prompt lengths while preserving meaningful prompt data", () => {
    expect(
      normalizeDispatchPromptTraceRecord({
        promptFingerprint: "sha256:demo",
        promptLength: -1,
        promptPreview: "Dispatch prompt preview",
      })
    ).toEqual({
      fingerprint: "sha256:demo",
      length: null,
      preview: "Dispatch prompt preview",
    });
  });
});
