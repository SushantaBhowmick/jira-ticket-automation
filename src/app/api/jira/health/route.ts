import { connection } from "next/server";
import { getPublicJiraConfig } from "@/config/jira.config";
import { errorResponse } from "@/lib/errors";
import { WORKFLOWS } from "@/workflows/normal.workflow";

export async function GET() {
  await connection();
  try {
    const config = getPublicJiraConfig();
    return Response.json({
      configured: config.configured,
      missing: config.missing,
      baseUrl: config.baseUrl,
      timeZone: config.timeZone,
      worklogStartTime: config.worklogStartTime,
      workflows: Object.values(WORKFLOWS).map((workflow) => ({
        key: workflow.key,
        label: workflow.label,
        statuses: workflow.statuses,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
