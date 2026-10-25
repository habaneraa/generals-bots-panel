export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
