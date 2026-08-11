const CURRENT_COMPUTER_FILE_ACCESS_PATH =
  "/v1/local-runtimes/current/file-access";

export function buildComputerFileAccessReadPath(
  expectedDeviceId: string
): string {
  const searchParams = new URLSearchParams({ expectedDeviceId });
  return `${CURRENT_COMPUTER_FILE_ACCESS_PATH}?${searchParams.toString()}`;
}

export function buildComputerFileAccessUpdatePath(): string {
  return CURRENT_COMPUTER_FILE_ACCESS_PATH;
}
