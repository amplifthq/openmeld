import { describe, expect, it } from "vitest";
import {
  resolveHostCapabilities,
  resolveSettingsSections,
  type SettingsSectionDef,
  toSettingsNavItems,
} from "./settings-contract";
import { SETTINGS_SECTION_FIXTURES } from "./shell-contract.fixtures";

const alwaysShown: SettingsSectionDef = {
  id: "account",
  title: "Account",
  render: () => null,
};
const localServiceOnly: SettingsSectionDef = {
  id: "service",
  title: "Service",
  requires: ["LOCAL_SERVICE"],
  render: () => null,
};
const electronOnly: SettingsSectionDef = {
  id: "open-at-login",
  title: "Open at login",
  requires: ["ELECTRON_HOST"],
  render: () => null,
};

describe("resolveSettingsSections", () => {
  it("keeps sections with no capability requirement", () => {
    const kept = resolveSettingsSections([alwaysShown], ["CLOUD_ACCOUNT"]);
    expect(kept.map((section) => section.id)).toEqual(["account"]);
  });

  it("drops a section whose required capability the host lacks", () => {
    const kept = resolveSettingsSections(
      [alwaysShown, electronOnly],
      ["CLOUD_ACCOUNT"]
    );
    expect(kept.map((section) => section.id)).toEqual(["account"]);
  });

  it("requires ALL of a section's capabilities, not just one", () => {
    const both: SettingsSectionDef = {
      id: "both",
      title: "Both",
      requires: ["LOCAL_SERVICE", "ELECTRON_HOST"],
      render: () => null,
    };
    expect(resolveSettingsSections([both], ["LOCAL_SERVICE"])).toEqual([]);
    expect(
      resolveSettingsSections([both], ["LOCAL_SERVICE", "ELECTRON_HOST"])
    ).toHaveLength(1);
  });
});

describe("resolveHostCapabilities (tier composition)", () => {
  it("composes tiers so higher hosts include lower ones", () => {
    expect(resolveHostCapabilities("cloud")).toEqual(["CLOUD_ACCOUNT"]);
    expect(resolveHostCapabilities("local-service")).toEqual([
      "CLOUD_ACCOUNT",
      "LOCAL_SERVICE",
    ]);
    expect(resolveHostCapabilities("electron")).toEqual([
      "CLOUD_ACCOUNT",
      "LOCAL_SERVICE",
      "ELECTRON_HOST",
    ]);
  });

  it("makes a LOCAL_SERVICE section visible on both local-service and electron hosts, not cloud", () => {
    const onCloud = resolveSettingsSections(
      [localServiceOnly],
      resolveHostCapabilities("cloud")
    );
    const onLocal = resolveSettingsSections(
      [localServiceOnly],
      resolveHostCapabilities("local-service")
    );
    const onElectron = resolveSettingsSections(
      [localServiceOnly],
      resolveHostCapabilities("electron")
    );
    expect(onCloud).toEqual([]);
    expect(onLocal).toHaveLength(1);
    expect(onElectron).toHaveLength(1);
  });
});

describe("toSettingsNavItems", () => {
  it("projects id/title/anchor/to and preserves order", () => {
    const items = toSettingsNavItems(SETTINGS_SECTION_FIXTURES);
    expect(items.map((item) => item.id)).toEqual([
      "account",
      "computers",
      "agents",
      "service",
    ]);
    expect(items[0]).toEqual({
      id: "account",
      title: "Account",
      anchor: undefined,
      to: "/app/settings/account",
    });
  });
});

describe("settings section fixtures", () => {
  it("expose the four ratified settings nouns", () => {
    expect(SETTINGS_SECTION_FIXTURES.map((section) => section.id)).toEqual([
      "account",
      "computers",
      "agents",
      "service",
    ]);
  });

  it("render to a non-empty node for every section", () => {
    for (const section of SETTINGS_SECTION_FIXTURES) {
      expect(
        section.render({ capabilities: resolveHostCapabilities("electron") })
      ).toBeTruthy();
    }
  });

  it("gates the open-at-login row by ELECTRON_HOST inside the Service section", () => {
    const service = SETTINGS_SECTION_FIXTURES.find((s) => s.id === "service");
    const onElectron = service?.render({
      capabilities: resolveHostCapabilities("electron"),
    });
    const onLocal = service?.render({
      capabilities: resolveHostCapabilities("local-service"),
    });
    expect(String(onElectron)).toContain("open-at-login");
    expect(String(onLocal)).not.toContain("open-at-login");
  });
});
