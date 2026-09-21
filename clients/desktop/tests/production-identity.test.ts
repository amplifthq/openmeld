import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withDesktopAppName } from "../../../scripts/desktop/app-name";
import {
  assertMacProductionBundleIdentity,
  MAC_PRODUCTION_APP_BUNDLE_NAME,
  MAC_PRODUCTION_APP_ID,
  MAC_PRODUCTION_PRODUCT_NAME,
} from "../src/main/update/mac-bundle-path";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as {
  productName: string;
  build: {
    appId: string;
    productName: string;
    mac: { extendInfo: Record<string, unknown> };
  };
};

describe("production Desktop update identity", () => {
  it("keeps the selected production filesystem name and app identity stable", () => {
    const production = withDesktopAppName(
      packageJson.build,
      MAC_PRODUCTION_APP_ID
    );
    expect(MAC_PRODUCTION_APP_BUNDLE_NAME).toBe("OpenMeld.app");
    expect(MAC_PRODUCTION_PRODUCT_NAME).toBe("OpenMeld");
    expect(MAC_PRODUCTION_APP_ID).toBe("sh.openmeld.desktop");
    expect(production.productName).toBe(MAC_PRODUCTION_PRODUCT_NAME);
    expect(production.appId).toBe(MAC_PRODUCTION_APP_ID);
    expect(production.extraMetadata.productName).toBe(
      MAC_PRODUCTION_PRODUCT_NAME
    );
    expect(production.mac.extendInfo.CFBundleName).toBe(
      MAC_PRODUCTION_PRODUCT_NAME
    );
    expect(production.mac.extendInfo.CFBundleDisplayName).toBe(
      MAC_PRODUCTION_PRODUCT_NAME
    );
    expect(() => assertMacProductionBundleIdentity(production)).not.toThrow();
  });

  it("does not give bare local packages the production update identity", () => {
    expect(packageJson.productName).toBe("OpenMeld Dev");
    expect(packageJson.build.appId).toBe("sh.openmeld.desktop.dev");
    expect(() =>
      assertMacProductionBundleIdentity(packageJson.build)
    ).toThrow();
  });
});
