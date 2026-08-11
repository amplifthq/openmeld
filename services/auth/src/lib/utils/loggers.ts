export function logDebug(nodeEnv: string | undefined, ...args: unknown[]) {
  if (nodeEnv === "development") {
    console.log(...args);
  }
}

export function logWarn(nodeEnv: string | undefined, ...args: unknown[]) {
  if (nodeEnv === "development") {
    console.warn(...args);
  }
}

export function logError(...args: unknown[]) {
  console.error(...args);
}
