import { describe, expect, it } from "vitest";
import {
  isTaskResultStatusSuccessLike,
  resolveTaskResultDeliverySemantic,
} from "../src";

describe("agent-runtime task result delivery semantic", () => {
  it("treats success and partial_success as success-like", () => {
    expect(isTaskResultStatusSuccessLike("success")).toBe(true);
    expect(isTaskResultStatusSuccessLike("partial_success")).toBe(true);
    expect(isTaskResultStatusSuccessLike("failed")).toBe(false);
  });

  it("resolves stable delivery semantics from task result statuses", () => {
    expect(
      resolveTaskResultDeliverySemantic({
        payloadStatus: "success",
      })
    ).toEqual({
      kind: "success_like",
      successLike: true,
    });
    expect(
      resolveTaskResultDeliverySemantic({
        payloadStatus: "partial_success",
      })
    ).toEqual({
      kind: "success_like",
      successLike: true,
    });
    expect(
      resolveTaskResultDeliverySemantic({
        payloadStatus: "failed",
      })
    ).toEqual({
      kind: "failed_requires_classification",
      successLike: false,
    });
  });
});
