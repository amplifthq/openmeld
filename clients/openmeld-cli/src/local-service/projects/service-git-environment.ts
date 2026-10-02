/** Service inspection/preparation never executes repository-provided commands. */
export function createServiceGitEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  const settings = {
    "core.hooksPath": "/dev/null",
    "core.attributesFile": "/dev/null",
    "core.fsmonitor": "false",
    "core.sshCommand": "false",
    "credential.helper": "",
    "protocol.allow": "never",
    "protocol.file.allow": "always",
    "fetch.recurseSubmodules": "false",
    "submodule.recurse": "false",
    "uploadpack.packObjectsHook": "",
    "gc.auto": "0",
    "maintenance.auto": "false",
  };
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(Object.keys(settings).length),
  });
  for (const [index, [key, value]] of Object.entries(settings).entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return env;
}
