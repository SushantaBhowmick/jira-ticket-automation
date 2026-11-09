import { connection } from "next/server";
import { configForAccount } from "@/lib/jira-account";
import { AppError, errorResponse, readJsonBody } from "@/lib/errors";
import { JiraClient } from "@/services/jira.client";

export async function POST(request: Request) {
  await connection();
  try {
    const body = asRecord(await readJsonBody(request));
    const email = readText(body.email, "email");
    const apiToken = readText(body.apiToken, "apiToken");
    const account = await new JiraClient(configForAccount(email, apiToken)).verifyMyself();
    if (account.emailAddress && account.emailAddress.toLowerCase() !== email.toLowerCase()) {
      throw new AppError(401, "This API token belongs to a different Atlassian account.");
    }
    return Response.json({
      success: true,
      email,
      displayName: account.displayName,
    });
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

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, `${field} is required.`, { details: { field } });
  }
  return value.trim();
}
