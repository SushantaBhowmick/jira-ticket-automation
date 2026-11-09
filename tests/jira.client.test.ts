import { afterEach, describe, expect, it, vi } from "vitest";
import { getJiraConfig } from "@/config/jira.config";
import { JiraClient } from "@/services/jira.client";
import type { JiraConfig } from "@/config/jira.config";

const config: JiraConfig = {
  baseUrl: "https://pactap-ecosystem.atlassian.net",
  email: "bot@example.com",
  apiToken: "secret-token",
  timeZone: "Asia/Kolkata",
  worklogStartTime: "09:00:00",
  timeoutMs: 20000,
};

const ENV_KEYS = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_TIMEZONE",
  "JIRA_WORKLOG_START_TIME",
  "JIRA_HTTP_TIMEOUT_MS",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("jira client", () => {
  it("reads an issue and does not retry a rejected worklog post", async () => {
    let posts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.includes("/worklog")) {
        posts += 1;
        if (posts > 1) return jsonResponse({}, 429, { "Retry-After": "0" });
        return jsonResponse({
          errorMessages: ["rejected secret-token for bot@example.com"],
        }, 400);
      }
      if (url.includes("/transitions")) {
        return jsonResponse({
          transitions: [{ id: 31, name: "Merge", to: { name: "Done codded & Merged" } }],
        });
      }
      return jsonResponse({
        key: "PP3-3198",
        fields: {
          summary: "Sample",
          status: { name: "In progres" },
          issuetype: { name: "Story" },
        },
      });
    });

    const client = new JiraClient(config, fetchImpl);
    const issue = await client.getIssue("PP3-3198");
    expect(issue).toMatchObject({ status: "In progres", issueType: "Story" });

    const transitions = await client.getTransitions("PP3-3198");
    expect(transitions).toEqual([
      { id: "31", name: "Merge", toStatus: "Done codded & Merged" },
    ]);

    const entry = {
      timeSpentSeconds: 14400,
      started: "2026-11-09T09:00:00.000+0530",
      comment: "Development and testing work",
    };
    await expect(client.addWorklog("PP3-3198", entry)).rejects.toMatchObject({
      statusCode: 400,
      message: "rejected [redacted] for [redacted]",
    });

    await expect(client.addWorklog("PP3-3198", entry)).rejects.toMatchObject({
      statusCode: 429,
    });

    const postCalls = fetchImpl.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === "POST";
    });
    expect(postCalls).toHaveLength(2);
    const postUrl = String(postCalls[0][0]);
    expect(postUrl).toContain("adjustEstimate=auto");
    expect(postUrl).not.toContain("newEstimate=");
    expect(postUrl).toContain("notifyUsers=false");
    const headers = new Headers((postCalls[0][1] as RequestInit).headers);
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("bot@example.com:secret-token").toString("base64")}`,
    );
  });

  it("reduces the remaining estimate by the logged time", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "42" }));

    const created = await new JiraClient(config, fetchImpl).addWorklog("PP3-3198", {
      timeSpentSeconds: 7200,
      started: "2026-11-10T09:00:00.000+0530",
    });

    expect(created).toEqual({ id: "42" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const postUrl = String(fetchImpl.mock.calls[0][0]);
    expect(postUrl).toContain("adjustEstimate=auto");
    expect(postUrl).not.toContain("newEstimate=");
    expect(postUrl).not.toContain("adjustEstimate=leave");
  });

  it("reads the estimate and the time already logged", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        key: "PP3-3198",
        fields: {
          summary: "Sample",
          status: { name: "In Progress" },
          issuetype: { name: "Task" },
          timetracking: {
            originalEstimate: "1d",
            timeSpent: "3h",
            remainingEstimate: "5h",
          },
        },
      }),
    );

    const issue = await new JiraClient(config, fetchImpl).getIssue("PP3-3198");
    expect(issue.originalEstimate).toBe("1d");
    expect(issue.timeSpent).toBe("3h");
    expect(issue.remainingEstimate).toBe("5h");
  });

  it("retries a rate-limited read once when Retry-After is short", async () => {
    let reads = 0;
    const fetchImpl = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return jsonResponse({}, 429, { "Retry-After": "0" });
      return jsonResponse({
        key: "PP3-3198",
        fields: {
          summary: "Sample",
          status: { name: "In progres" },
          issuetype: { name: "Task" },
        },
      });
    });

    const issue = await new JiraClient(config, fetchImpl).getIssue("PP3-3198");
    expect(issue.status).toBe("In progres");
    expect(reads).toBe(2);
  });

  it("reports an uncertain timeout without retrying the post", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    await expect(
      new JiraClient(config, fetchImpl).transitionIssue("PP3-3198", "31"),
    ).rejects.toMatchObject({ statusCode: 504, uncertain: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps missing credentials and invalid authentication", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(() => getJiraConfig()).toThrow(/JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN/);

    process.env.JIRA_BASE_URL = "https://pactap-ecosystem.atlassian.net";
    process.env.JIRA_EMAIL = "bot@example.com";
    process.env.JIRA_API_TOKEN = "eyJhbGciOi.eyJzdWIiOiJ1c2Vy.signature";
    expect(() => getJiraConfig()).toThrow(/browser session token/);

    process.env.JIRA_BASE_URL = "http://pactap-ecosystem.atlassian.net";
    process.env.JIRA_EMAIL = "bot@example.com";
    process.env.JIRA_API_TOKEN = "secret-token";
    expect(() => getJiraConfig()).toThrow(/https/);

    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    await expect(new JiraClient(config, fetchImpl).getIssue("PP3-404")).rejects.toMatchObject({
      statusCode: 401,
    });

    fetchImpl.mockImplementation(async () => jsonResponse({}, 404));
    await expect(new JiraClient(config, fetchImpl).getIssue("PP3-404")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("reads the first active sprint and its issues", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rest/agile/1.0/board?")) {
        return jsonResponse({ values: [{ id: 12, name: "PP3 board" }] });
      }
      if (url.includes("/sprint?state=active")) {
        return jsonResponse({
          values: [{ id: 44, name: "Sprint 12", startDate: "2026-11-01T00:00:00.000Z", endDate: "2026-11-14T00:00:00.000Z" }],
        });
      }
      expect(url).toContain("assignee+%3D+currentUser");
      return jsonResponse({
        total: 3,
        issues: [
          {
            key: "PP3-1",
            fields: {
              summary: "Ship the form",
              status: { name: "In Progress" },
              issuetype: { name: "Task" },
              assignee: { displayName: "Ada" },
            },
          },
          {
            key: "PP3-2",
            fields: {
              summary: "Already on stage",
              status: { name: "Build Deployed - Stage ENV." },
              issuetype: { name: "Task" },
              assignee: { displayName: "Ada" },
            },
          },
          {
            key: "PP3-3",
            fields: {
              summary: "Already in production",
              status: { name: "Build Deployed - PROD. DEV" },
              issuetype: { name: "Task" },
              assignee: { displayName: "Ada" },
            },
          },
        ],
      });
    });

    const sprint = await new JiraClient(config, fetchImpl).getActiveSprint("PP3");
    expect(sprint.sprintName).toBe("Sprint 12");
    expect(sprint.issues).toEqual([
      {
        key: "PP3-1",
        summary: "Ship the form",
        status: "In Progress",
        issueType: "Task",
        assignee: "Ada",
      },
    ]);
  });
});
