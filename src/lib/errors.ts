export class AppError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  readonly uncertain: boolean;

  constructor(
    statusCode: number,
    message: string,
    options?: { details?: unknown; uncertain?: boolean },
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = options?.details;
    this.uncertain = options?.uncertain ?? false;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const headers = new Headers();
    const retryAfter = readRetryAfter(error.details);
    if (retryAfter) {
      headers.set("Retry-After", retryAfter);
    }

    return Response.json(
      {
        success: false,
        error: error.message,
        ...(error.uncertain ? { uncertain: true } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.statusCode, headers },
    );
  }

  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Unexpected server error: ${message}`);
  return Response.json(
    { success: false, error: "Unexpected server error." },
    { status: 500 },
  );
}

function readRetryAfter(details: unknown): string | null {
  if (!details || typeof details !== "object" || !("retryAfter" in details)) {
    return null;
  }
  const value = details.retryAfter;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "Request body must be valid JSON.");
  }
}
