import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { AppError, errorResponse, readJsonBody } from "@/lib/errors";

export async function POST(request: Request) {
  await connection();
  try {
    const body = asRecord(await readJsonBody(request));
    const password = readPassword(body.password);
    const expected = process.env.SETUP_PASSWORD;
    if (!expected) {
      throw new AppError(503, "SETUP_PASSWORD is not set on the server.");
    }
    if (!passwordsMatch(password, expected)) {
      throw new AppError(401, "That password does not match.");
    }
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function readPassword(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(400, "Password is required.", { details: { field: "password" } });
  }
  return value;
}

function passwordsMatch(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
