import { spawn } from "node:child_process";

export function tryOpenUrl(url: string): Promise<boolean> {
  const target = String(url ?? "").trim();
  if (!target) {
    return Promise.resolve(false);
  }

  const command = resolveOpenCommand();

  return new Promise<boolean>((resolve) => {
    const child = spawn(command, [target], {
      detached: true,
      stdio: "ignore",
    });

    let settled = false;
    const settle = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.once("error", () => settle(false));
    child.once("spawn", () => settle(true));
    child.unref();
  });
}

function resolveOpenCommand(): string {
  if (process.platform === "darwin") {
    return "open";
  }
  if (process.platform === "win32") {
    return "explorer.exe";
  }
  return "xdg-open";
}
