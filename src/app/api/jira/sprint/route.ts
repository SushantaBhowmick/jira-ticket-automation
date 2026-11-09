import { connection } from "next/server";
import { configForRequest } from "@/lib/jira-account";
import { errorResponse } from "@/lib/errors";
import { JiraClient } from "@/services/jira.client";

const PROJECT_KEY = process.env.JIRA_PROJECT_KEY?.trim() || "PP3";

export async function GET(request: Request) {
  await connection();
  try {
    const sprint = await new JiraClient(configForRequest(request)).getActiveSprint(PROJECT_KEY);
    return Response.json(sprint);
  } catch (error) {
    return errorResponse(error);
  }
}
