import { connection } from "next/server";
import { configForRequest } from "@/lib/jira-account";
import { JiraClient } from "@/services/jira.client";
import { inspectIssue } from "@/services/workflow.service";
import { errorResponse } from "@/lib/errors";
import { validateTicketKey } from "@/validators/ticket.validator";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketKey: string }> },
) {
  await connection();
  try {
    const { ticketKey: rawKey } = await params;
    const ticketKey = validateTicketKey(decodeURIComponent(rawKey));
    const result = await inspectIssue(ticketKey, new JiraClient(configForRequest(request)));
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
