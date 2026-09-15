import { DESKTOP_APP_ORIGIN, DESKTOP_CONTRACT_HEADER } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import { checkDesktopCompatibility } from "../src/main/desktop-compatibility";

it("admits only an explicit supported response without sending credentials or following redirects", async () => {
  const fetchCloud = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ contractVersion: "1" }));
  await checkDesktopCompatibility("https://openmeld.ai", fetchCloud);
  const call = fetchCloud.mock.calls[0];
  if (!call) {
    throw new Error("Expected compatibility request");
  }
  const [url, options] = call;
  expect(String(url)).toBe("https://openmeld.ai/v1/desktop/compatibility");
  expect(options?.redirect).toBe("manual");
  expect(options?.cache).toBe("no-store");
  expect(new Headers(options?.headers).get("origin")).toBe(DESKTOP_APP_ORIGIN);
  expect(new Headers(options?.headers).get(DESKTOP_CONTRACT_HEADER)).toBe("1");
  expect(new Headers(options?.headers).get("cookie")).toBeNull();
  for (const payload of [
    {},
    { contractVersion: "2" },
    { contractVersion: "1", fallback: true },
  ]) {
    fetchCloud.mockResolvedValueOnce(Response.json(payload));
    await expect(
      checkDesktopCompatibility("https://openmeld.ai", fetchCloud)
    ).rejects.toThrow("verify server compatibility");
  }
  fetchCloud.mockResolvedValueOnce(new Response(null, { status: 409 }));
  await expect(
    checkDesktopCompatibility("https://openmeld.ai", fetchCloud)
  ).rejects.toThrow("app update");
  fetchCloud.mockRejectedValueOnce(new TypeError("network unavailable"));
  await expect(
    checkDesktopCompatibility("https://openmeld.ai", fetchCloud)
  ).rejects.toThrow("Check your connection");
});
