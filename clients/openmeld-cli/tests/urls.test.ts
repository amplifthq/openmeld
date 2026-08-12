import { describe, expect, it } from "vitest";
import {
  normalizeBaseUrl,
  toSpaceBoardUrl,
  toSpaceDispatchTraceUrl,
  toSpaceLeaveUrl,
  toSpaceMembersUrl,
  toSpacePasswordUrl,
  toSpaceRemoveMembersUrl,
  toSpaceWsUrl,
} from "../src/protocol/urls";

describe("protocol urls", () => {
  it("normalizes origin-only base URLs", () => {
    expect(normalizeBaseUrl("https://gateway.example.com/")).toBe(
      "https://gateway.example.com"
    );
  });

  it("rejects base URLs with path/query/hash", () => {
    expect(() => normalizeBaseUrl("https://gateway.example.com/api")).toThrow(
      "baseUrl must be origin-only"
    );
    expect(() =>
      normalizeBaseUrl("https://gateway.example.com?env=dev")
    ).toThrow("baseUrl must be origin-only");
    expect(() => normalizeBaseUrl("https://gateway.example.com#local")).toThrow(
      "baseUrl must be origin-only"
    );
  });

  it("maps http/https to ws/wss", () => {
    expect(toSpaceWsUrl("http://gateway.example.com", "ops room")).toBe(
      "ws://gateway.example.com/v1/spaces/ops%20room/stream"
    );
    expect(toSpaceWsUrl("https://gateway.example.com", "ops room")).toBe(
      "wss://gateway.example.com/v1/spaces/ops%20room/stream"
    );
  });

  it("preserves ws/wss protocols", () => {
    expect(toSpaceWsUrl("ws://gateway.example.com", "ops room")).toBe(
      "ws://gateway.example.com/v1/spaces/ops%20room/stream"
    );
    expect(toSpaceWsUrl("wss://gateway.example.com", "ops room")).toBe(
      "wss://gateway.example.com/v1/spaces/ops%20room/stream"
    );
  });

  it("throws for unsupported websocket protocols", () => {
    expect(() => toSpaceWsUrl("ftp://gateway.example.com", "ops room")).toThrow(
      "unsupported baseUrl protocol for websocket URL"
    );
  });

  it("builds space password endpoint URL", () => {
    expect(toSpacePasswordUrl("https://gateway.example.com", "ops room")).toBe(
      "https://gateway.example.com/v1/spaces/ops%20room/password"
    );
  });

  it("builds space members endpoint URL", () => {
    expect(toSpaceMembersUrl("https://gateway.example.com", "ops room")).toBe(
      "https://gateway.example.com/v1/spaces/ops%20room/members"
    );
  });

  it("builds space board endpoint URL", () => {
    expect(toSpaceBoardUrl("https://gateway.example.com", "ops room")).toBe(
      "https://gateway.example.com/v1/spaces/ops%20room/board"
    );
  });

  it("builds space remove-members action endpoint URL", () => {
    expect(
      toSpaceRemoveMembersUrl("https://gateway.example.com", "ops room")
    ).toBe("https://gateway.example.com/v1/spaces/ops%20room/members/remove");
  });

  it("builds space leave endpoint URL", () => {
    expect(toSpaceLeaveUrl("https://gateway.example.com", "ops room")).toBe(
      "https://gateway.example.com/v1/spaces/ops%20room/leave"
    );
  });

  it("builds space dispatch trace endpoint URL", () => {
    expect(
      toSpaceDispatchTraceUrl(
        "https://gateway.example.com",
        "ops room",
        "dispatch/42"
      )
    ).toBe(
      "https://gateway.example.com/v1/spaces/ops%20room/dispatches/dispatch%2F42/trace"
    );
    expect(
      toSpaceDispatchTraceUrl(
        "https://gateway.example.com",
        "ops room",
        "dispatch/42",
        { includeRemoteAgentRuntimeDiagnostics: true }
      )
    ).toBe(
      "https://gateway.example.com/v1/spaces/ops%20room/dispatches/dispatch%2F42/trace?includeRemoteAgentRuntimeDiagnostics=true"
    );
  });
});
