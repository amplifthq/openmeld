import { describe, expect, it } from "vitest";
import {
  diagnoseNpmPackageAcquisitionFailure,
  formatNpmPackageAcquisitionFailureDiagnosis,
} from "../src/runtime/npm-package-acquisition-diagnostics";

const UNRELATED_RECOVERY = /proxy|permissions|reach.*registry/iu;

describe("npm package acquisition diagnostics", () => {
  it.each([
    "catalog:",
    "workspace:*",
  ])("identifies an unpublished dependency reference instead of blaming the network: %s", (specifier) => {
    const diagnosis = diagnoseNpmPackageAcquisitionFailure({
      text: [
        "npm http fetch GET 200 https://registry.npmmirror.com/openmeld",
        "npm error code EUNSUPPORTEDPROTOCOL",
        `npm error Unsupported URL Type "${specifier.split(":")[0]}:": ${specifier}`,
      ].join("\n"),
    });
    expect(diagnosis?.code).toBe("npm_package_dependency_invalid");
    expect(diagnosis?.message).toContain("dependency reference");
    expect(diagnosis?.nextSteps.join(" ")).not.toMatch(UNRELATED_RECOVERY);
  });

  it("classifies unreachable local proxy npm fetch failures", () => {
    const diagnosis = diagnoseNpmPackageAcquisitionFailure({
      text: [
        "npm error code EPERM",
        "FetchError: request to https://registry.npmjs.org/openmeld failed, reason: connect EPERM 127.0.0.1:7890-Local (0.0.0.0:0)",
      ].join("\n"),
    });

    expect(diagnosis).toMatchObject({
      code: "npm_local_proxy_unreachable",
    });
    expect(diagnosis).not.toBeNull();
    if (!diagnosis) {
      throw new Error("Expected npm local proxy diagnosis.");
    }
    expect(formatNpmPackageAcquisitionFailureDiagnosis(diagnosis)).toContain(
      "npm config get https-proxy"
    );
  });

  it("classifies npm cache permission failures", () => {
    const diagnosis = diagnoseNpmPackageAcquisitionFailure({
      text: "Log files were not written due to an error writing to the directory: /Users/felix/.npm/_logs",
    });

    expect(diagnosis).toMatchObject({
      code: "npm_cache_or_log_unwritable",
    });
  });
});
