import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { createStartFetchHandler } from "./helpers/start-fetch";

const UNEXPECTED_FETCH_REQUEST_PATTERN = /Unexpected fetch request/u;

describe("start fetch helper", () => {
  it("fails fast on unexpected requests instead of returning a fake success", () => {
    const handler = createStartFetchHandler(packageJson.version);

    expect(() =>
      handler("https://gateway.openmeld.invalid/v1/unexpected-endpoint", {
        method: "GET",
      })
    ).toThrow(UNEXPECTED_FETCH_REQUEST_PATTERN);
  });
});
