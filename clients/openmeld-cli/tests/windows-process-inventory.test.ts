import { describe, expect, it } from "vitest";
import { parseWindowsProcessInventory } from "../src/local-service/lifecycle/daemon-service-process-inventory";

describe("Windows process inventory JSON", () => {
  const record = {
    ProcessId: 123,
    ParentProcessId: 45,
    CommandLine: '"C:\\Users\\测试\\node.exe" "D:\\My Project\\service.js"',
  };
  it.each([
    record,
    [record],
  ])("preserves Unicode command paths for one or multiple CIM rows", (value) => {
    expect(parseWindowsProcessInventory(JSON.stringify(value))).toEqual([
      { pid: 123, parentPid: 45, command: record.CommandLine },
    ]);
  });
  it.each([
    "null",
    "",
    "not-json",
    '"failed"',
  ])("rejects an invalid observation rather than claiming absence: %s", (value) => {
    expect(() => parseWindowsProcessInventory(value)).toThrow();
  });
  it("omits protected processes without readable command lines", () => {
    expect(
      parseWindowsProcessInventory(
        JSON.stringify([
          { ProcessId: 4, ParentProcessId: 0, CommandLine: null },
          record,
        ])
      )
    ).toEqual([{ pid: 123, parentPid: 45, command: record.CommandLine }]);
  });
});
