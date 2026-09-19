import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { isSameOrDescendantPath } from "../src/lib/path-containment";

describe("canonical folder containment", () => {
  it.each([
    [posix, "/allowed", "/allowed", true],
    [posix, "/allowed/child", "/allowed", true],
    [posix, "/allowed/..notes", "/allowed", true],
    [posix, "/private", "/allowed", false],
    [posix, "/allowed-other", "/allowed", false],
    [posix, "/", "/allowed", false],
    [posix, "relative", "/allowed", false],
    [win32, "C:\\Allowed", "C:\\Allowed", true],
    [win32, "c:\\allowed\\child", "C:\\Allowed", true],
    [win32, "C:\\Allowed\\..notes", "C:\\Allowed", true],
    [win32, "C:/Allowed/child", "C:\\Allowed", true],
    [win32, "C:\\Private", "C:\\Allowed", false],
    [win32, "C:\\Allowed-other", "C:\\Allowed", false],
    [win32, "C:\\", "C:\\Allowed", false],
    [win32, "D:\\Allowed\\child", "C:\\Allowed", false],
    [win32, "C:relative", "C:\\Allowed", false],
    [
      win32,
      "\\\\server\\share\\allowed\\child",
      "\\\\server\\share\\allowed",
      true,
    ],
    [win32, "\\\\server\\share\\private", "\\\\server\\share\\allowed", false],
    [win32, "\\\\server\\other\\allowed", "\\\\server\\share\\allowed", false],
  ] as const)("checks %s candidate %s under %s", (paths, candidate, parent, allowed) => {
    expect(isSameOrDescendantPath(candidate, parent, paths)).toBe(allowed);
  });
});
