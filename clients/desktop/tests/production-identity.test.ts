import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  build: { appId: string; productName: string };
};

describe("production Desktop update identity", () => {
  it("keeps the installed filesystem name and app identity stable", () => {
    expect(MAC_PRODUCTION_APP_BUNDLE_NAME).toBe("OpenMeld.app");
    expect(MAC_PRODUCTION_PRODUCT_NAME).toBe("OpenMeld");
    expect(MAC_PRODUCTION_APP_ID).toBe("sh.openmeld.desktop");
    expect(packageJson.productName).toBe(MAC_PRODUCTION_PRODUCT_NAME);
    expect(packageJson.build.productName).toBe(MAC_PRODUCTION_PRODUCT_NAME);
    expect(packageJson.build.appId).toBe(MAC_PRODUCTION_APP_ID);
    expect(() =>
      assertMacProductionBundleIdentity({
        appId: packageJson.build.appId,
        productName: packageJson.productName,
      })
    ).not.toThrow();
  });
});
