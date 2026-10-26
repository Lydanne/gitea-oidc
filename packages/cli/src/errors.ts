export class CliError extends Error {
  public readonly exitCode: number;

  public constructor(message: string, options: { cause?: unknown; exitCode?: number } = {}) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.exitCode = options.exitCode ?? 1;
  }
}

export class CliUsageError extends CliError {
  public constructor(message: string) {
    super(message, { exitCode: 2 });
    this.name = "CliUsageError";
  }
}

export const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;
