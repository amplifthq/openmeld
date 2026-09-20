import { describe, expect, it } from "vitest";
import {
  isAbsoluteWebPath,
  normalizeExternalBrowserUrl,
  resolveDesktopWebUrl,
} from "../src/main/desktop-environment";
import { isDesktopAppHref } from "../src/shared/navigation";

describe("Desktop browser destinations", () => {
  it("admits only supported application routes to Desktop Router", () => {
    expect(isDesktopAppHref("/o/team/agents?profileId=agent-1#activity")).toBe(
      true
    );
    expect(isDesktopAppHref("/spaces/space-1?signalId=signal-1")).toBe(true);
    expect(isDesktopAppHref("/file-preview?spaceId=space-1")).toBe(true);
    expect(isDesktopAppHref("/api/oauth/start")).toBe(false);
    expect(isDesktopAppHref("//evil.example/o/team")).toBe(false);
  });

  it("preserves path, query, hash, and existing encoding", () => {
    expect(
      resolveDesktopWebUrl({
        env: { WEB_APP_URL: "http://lane.localhost:31952" },
        path: "/o/test/agents?profileId=agent-%E4%B8%AD#activity",
      })
    ).toBe(
      "http://lane.localhost:31952/o/test/agents?profileId=agent-%E4%B8%AD#activity"
    );
  });

  it.each([
    "//evil.example/path",
    "/\\evil.example/path",
    "\\evil.example",
  ])("rejects escaping Web path %s", (path) => {
    expect(isAbsoluteWebPath(path)).toBe(false);
    expect(() =>
      resolveDesktopWebUrl({
        env: { WEB_APP_URL: "http://lane.localhost:31952" },
        path,
      })
    ).toThrow("single /");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///tmp/private",
    "https://user:password@example.com/private",
    "https:\\evil.example/private",
  ])("rejects unsafe browser URL %s", (url) => {
    expect(() => normalizeExternalBrowserUrl(url)).toThrow();
  });

  it.each([
    "mailto:help@example.com",
    "tel:+14155550100",
  ])("allows the existing system URL %s", (url) =>
    expect(normalizeExternalBrowserUrl(url)).toBe(url));
});
