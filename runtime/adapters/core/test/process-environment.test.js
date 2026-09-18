import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommandEnvironment } from "../dist/process-environment.js";

test("normalizes Windows runtime keys without losing Path or persisting a second spelling", () => {
  const source = {
    Path: "C:\\Node;C:\\Users\\Test\\npm",
    systemroot: "C:\\Windows",
    temp: "C:\\Temp",
    npm_config_prefix: "C:\\npm",
  };
  const result = normalizeCommandEnvironment(source, "win32");
  assert.deepEqual(result, {
    PATH: source.Path,
    SystemRoot: source.systemroot,
    TEMP: source.temp,
    npm_config_prefix: source.npm_config_prefix,
  });
  assert.deepEqual(source.Path, "C:\\Node;C:\\Users\\Test\\npm");
  assert.equal(Object.hasOwn(source, "PATH"), false);
});

test("keeps Node's explicit uppercase override and preserves POSIX case distinctions", () => {
  const source = {
    Path: "old",
    PATH: "selected",
    API_KEY: "upper",
    api_key: "lower",
  };
  assert.deepEqual(normalizeCommandEnvironment(source, "win32"), {
    PATH: "selected",
    API_KEY: "upper",
  });
  assert.deepEqual(normalizeCommandEnvironment(source, "darwin"), source);
  assert.deepEqual(
    normalizeCommandEnvironment({ PATH: undefined, Path: "valid" }, "win32"),
    { PATH: "valid" }
  );
});
