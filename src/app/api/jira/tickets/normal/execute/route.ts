import { readJsonBody, errorResponse } from "@/lib/errors";
import { JiraClient } from "@/services/jira.client";
import { executeNormalTicket } from "@/services/workflow.service";
import { validateExecuteRequest } from "@/validators/ticket.validator";
import { configForRequest } from "@/lib/jira-account";

export async function POST(request: Request) {
  try {
    const input = validateExecuteRequest(await readJsonBody(request));
    const config = configForRequest(request);
    const result = await executeNormalTicket(input, new JiraClient(config), {
      timeZone: config.timeZone,
      worklogStartTime: config.worklogStartTime,
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}
