export function outLine(line: string) {
  process.stdout.write(`${line}\n`);
}

export function outJsonLine(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function errLine(line: string) {
  process.stderr.write(`${line}\n`);
}
