export class AccountDisplayNameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDisplayNameValidationError";
  }
}

export class AccountDisplayNameInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDisplayNameInvariantError";
  }
}
