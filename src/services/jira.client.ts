import { getJiraConfig, type JiraConfig } from "@/config/jira.config";
import { commentToText, textToAdf } from "@/lib/adf";
import { secondsToJiraTimeSpent } from "@/lib/duration";
import { AppError } from "@/lib/errors";
import type {
  AvailableTransition,
  ExistingWorklog,
  IssueSnapshot,
  JiraGateway,
  NewWorklog,
} from "@/types/jira";

export type SprintIssue = {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  assignee: string | null;
};

export type ActiveSprintSnapshot = {
  projectKey: string;
  boardName: string;
  sprintId: string;
  sprintName: string;
  startDate: string | null;
  endDate: string | null;
  issues: SprintIssue[];
};

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  operation: string;
  allowEmpty: boolean;
};

export class JiraClient implements JiraGateway {
  constructor(
    private readonly config: JiraConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(): JiraClient {
    return new JiraClient(getJiraConfig());
  }

  async getIssue(issueKey: string): Promise<IssueSnapshot> {
    const payload = await this.request<unknown>({
      method: "GET",
      path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,issuetype,timetracking`,
      operation: "reading the issue",
      allowEmpty: false,
    });
    return parseIssue(payload, issueKey);
  }

  async getTransitions(issueKey: string): Promise<AvailableTransition[]> {
    const payload = await this.request<unknown>({
      method: "GET",
      path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      operation: "reading transitions",
      allowEmpty: false,
    });
    return parseTransitions(payload);
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request({
      method: "POST",
      path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      body: { transition: { id: transitionId } },
      operation: "transitioning the issue",
      allowEmpty: true,
    });
  }

  async findWorklogsOnDate(
    issueKey: string,
    range: { startedAfterMs: number; startedBeforeMs: number },
  ): Promise<ExistingWorklog[]> {
    const worklogs: ExistingWorklog[] = [];
    let startAt = 0;

    for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({
        startAt: String(startAt),
        maxResults: "100",
        startedAfter: String(range.startedAfterMs),
        startedBefore: String(range.startedBeforeMs),
      });
      const payload = await this.request<unknown>({
        method: "GET",
        path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?${params.toString()}`,
        operation: "reading worklogs",
        allowEmpty: false,
      });
      const pageResult = parseWorklogPage(payload);
      worklogs.push(...pageResult.worklogs);
      if (pageResult.worklogs.length === 0 || worklogs.length >= pageResult.total) break;
      startAt += pageResult.worklogs.length;
    }

    return worklogs;
  }

  async verifyMyself(): Promise<{ displayName: string; emailAddress: string | null }> {
    const payload = await this.request<unknown>({
      method: "GET",
      path: "/rest/api/3/myself",
      operation: "checking the Jira account",
      allowEmpty: false,
    });
    const record = asRecord(payload);
    return {
      displayName: typeof record.displayName === "string" ? record.displayName : "Jira user",
      emailAddress: typeof record.emailAddress === "string" ? record.emailAddress : null,
    };
  }

  async getActiveSprint(projectKey: string): Promise<ActiveSprintSnapshot> {
    const boardPayload = await this.request<unknown>({
      method: "GET",
      path: `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=20`,
      operation: "reading Jira boards",
      allowEmpty: false,
    });
    const boards = readNamedValues(boardPayload);
    if (boards.length === 0) {
      throw new AppError(404, `No Jira board was found for ${projectKey}.`);
    }

    for (const board of boards) {
      let sprintPayload: unknown;
      try {
        sprintPayload = await this.request<unknown>({
          method: "GET",
          path: `/rest/agile/1.0/board/${board.id}/sprint?state=active&maxResults=5`,
          operation: "reading the active sprint",
          allowEmpty: false,
        });
      } catch (error) {
        if (error instanceof AppError && (error.statusCode === 400 || error.statusCode === 404)) continue;
        throw error;
      }
      const sprint = readNamedValues(sprintPayload)[0];
      if (!sprint) continue;
      const record = asRecord(sprintPayload);
      const values = Array.isArray(record.values) ? record.values : [];
      const sprintRecord = asRecord(values[0]);
      const issues = await this.readSprintIssues(sprint.id);
      return {
        projectKey,
        boardName: board.name,
        sprintId: sprint.id,
        sprintName: sprint.name,
        startDate: typeof sprintRecord.startDate === "string" ? sprintRecord.startDate.slice(0, 10) : null,
        endDate: typeof sprintRecord.endDate === "string" ? sprintRecord.endDate.slice(0, 10) : null,
        issues,
      };
    }

    throw new AppError(404, `No active sprint was found for ${projectKey}.`);
  }

  async addWorklog(issueKey: string, entry: NewWorklog): Promise<{ id: string }> {
    const params = new URLSearchParams({
      adjustEstimate: "auto",
      notifyUsers: "false",
    });
    const payload = await this.request<unknown>({
      method: "POST",
      path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?${params.toString()}`,
      body: {
        timeSpentSeconds: entry.timeSpentSeconds,
        started: entry.started,
        ...(entry.comment ? { comment: textToAdf(entry.comment) } : {}),
      },
      operation: "creating the worklog",
      allowEmpty: false,
    });
    return { id: readWorklogId(payload) };
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    return this.requestOnce(options, true);
  }

  private async requestOnce<T>(options: RequestOptions, allowRateLimitRetry: boolean): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}${options.path}`, {
        method: options.method,
        headers: this.headers(options.body !== undefined),
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        redirect: "error",
      });

      if (response.status === 429 && options.method === "GET" && allowRateLimitRetry) {
        const retryAfter = response.headers.get("Retry-After");
        const waitSeconds = readRetryDelaySeconds(retryAfter);
        if (waitSeconds !== null && waitSeconds <= 2) {
          await delay(waitSeconds * 1000);
          return this.requestOnce(options, false);
        }
        throw jiraStatusError(response.status, await safeErrorMessage(response), retryAfter, this.config);
      }

      if (!response.ok) {
        throw jiraStatusError(
          response.status,
          await safeErrorMessage(response),
          response.headers.get("Retry-After"),
          this.config,
        );
      }

      if (options.allowEmpty && (response.status === 204 || response.status === 201)) {
        const text = await response.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof SyntaxError) {
        throw new AppError(502, `Jira returned an unreadable response while ${options.operation}.`);
      }
      if (isAbortError(error)) {
        throw new AppError(
          504,
          `Jira did not respond within ${this.config.timeoutMs}ms while ${options.operation}. If this was a transition or worklog, Jira may have applied it. Verify the issue before retrying.`,
          { uncertain: true },
        );
      }
      console.error(`Jira request failed while ${options.operation}.`);
      throw new AppError(502, `Could not reach Jira while ${options.operation}.`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readSprintIssues(sprintId: string): Promise<SprintIssue[]> {
    const issues: SprintIssue[] = [];
    let startAt = 0;
    for (let page = 0; page < 5; page += 1) {
      const params = new URLSearchParams({
        fields: "summary,status,issuetype,assignee",
        maxResults: "100",
        startAt: String(startAt),
        jql: "assignee = currentUser()",
      });
      const payload = await this.request<unknown>({
        method: "GET",
        path: `/rest/agile/1.0/sprint/${encodeURIComponent(sprintId)}/issue?${params.toString()}`,
        operation: "reading sprint issues",
        allowEmpty: false,
      });
      const record = asRecord(payload);
      const batch = Array.isArray(record.issues) ? record.issues.flatMap(readSprintIssue) : [];
      issues.push(...batch);
      const total = typeof record.total === "number" ? record.total : issues.length;
      if (batch.length === 0 || issues.length >= total) break;
      startAt += batch.length;
    }
    return issues
      .filter((issue) => isTodoSprintStatus(issue.status))
      .sort((left, right) => left.status.localeCompare(right.status) || left.key.localeCompare(right.key));
  }

  private headers(hasBody: boolean): Headers {
    const headers = new Headers();
    const credentials = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    headers.set("Authorization", `Basic ${credentials}`);
    headers.set("Accept", "application/json");
    if (hasBody) headers.set("Content-Type", "application/json");
    return headers;
  }
}

function parseIssue(payload: unknown, issueKey: string): IssueSnapshot {
  const record = asRecord(payload);
  const fields = asRecord(record.fields);
  const status = asRecord(fields.status);
  const issueType = asRecord(fields.issuetype);
  if (typeof record.key !== "string" || typeof fields.summary !== "string" || typeof status.name !== "string") {
    throw new AppError(502, "Jira returned an unexpected issue payload.");
  }
  const tracking = readTimeTracking(fields.timetracking);
  return {
    key: record.key || issueKey,
    summary: fields.summary,
    issueType: typeof issueType.name === "string" ? issueType.name : "Unknown",
    status: status.name,
    originalEstimate: tracking.originalEstimate,
    timeSpent: tracking.timeSpent,
    remainingEstimate: tracking.remainingEstimate,
  };
}

function readTimeTracking(value: unknown): {
  originalEstimate: string | null;
  timeSpent: string | null;
  remainingEstimate: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { originalEstimate: null, timeSpent: null, remainingEstimate: null };
  }
  const record = value as Record<string, unknown>;
  return {
    originalEstimate: readTrackedTime(record, "originalEstimate", "originalEstimateSeconds"),
    timeSpent: readTrackedTime(record, "timeSpent", "timeSpentSeconds"),
    remainingEstimate: readTrackedTime(record, "remainingEstimate", "remainingEstimateSeconds"),
  };
}

function readTrackedTime(record: Record<string, unknown>, textKey: string, secondsKey: string): string | null {
  const text = record[textKey];
  if (typeof text === "string" && text.trim()) return text.trim();
  const seconds = record[secondsKey];
  if (typeof seconds === "number") return secondsToJiraTimeSpent(seconds);
  return null;
}

function parseTransitions(payload: unknown): AvailableTransition[] {
  const record = asRecord(payload);
  if (!Array.isArray(record.transitions)) {
    throw new AppError(502, "Jira returned an unexpected transitions payload.");
  }
  return record.transitions.map((entry) => {
    const transition = asRecord(entry);
    const destination = asRecord(transition.to);
    if (typeof transition.id !== "string" && typeof transition.id !== "number") {
      throw new AppError(502, "Jira returned a transition without an id.");
    }
    if (typeof transition.name !== "string" || typeof destination.name !== "string") {
      throw new AppError(502, "Jira returned an unexpected transition payload.");
    }
    return {
      id: String(transition.id),
      name: transition.name,
      toStatus: destination.name,
    };
  });
}

function parseWorklogPage(payload: unknown): { worklogs: ExistingWorklog[]; total: number } {
  const record = asRecord(payload);
  if (!Array.isArray(record.worklogs)) {
    throw new AppError(502, "Jira returned an unexpected worklog payload.");
  }
  const worklogs = record.worklogs.map((entry) => {
    const worklog = asRecord(entry);
    if (typeof worklog.id !== "string" && typeof worklog.id !== "number") {
      throw new AppError(502, "Jira returned a worklog without an id.");
    }
    if (typeof worklog.started !== "string" || typeof worklog.timeSpentSeconds !== "number") {
      throw new AppError(502, "Jira returned an unexpected worklog payload.");
    }
    return {
      id: String(worklog.id),
      started: worklog.started,
      timeSpentSeconds: worklog.timeSpentSeconds,
      commentText: commentToText(worklog.comment),
    };
  });
  const total = typeof record.total === "number" ? record.total : worklogs.length;
  return { worklogs, total };
}

function readWorklogId(payload: unknown): string {
  const record = asRecord(payload);
  if (typeof record.id !== "string" && typeof record.id !== "number") {
    throw new AppError(502, "Jira created a worklog but did not return its id. Verify the issue before retrying.", {
      uncertain: true,
    });
  }
  return String(record.id);
}

function readNamedValues(payload: unknown): Array<{ id: string; name: string }> {
  const record = asRecord(payload);
  if (!Array.isArray(record.values)) return [];
  return record.values.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if ((typeof item.id !== "number" && typeof item.id !== "string") || typeof item.name !== "string") {
      return [];
    }
    return [{ id: String(item.id), name: item.name }];
  });
}

function isTodoSprintStatus(status: string): boolean {
  const normalized = status.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\bstage\b/.test(normalized)) return false;
  if (/\bprod\b/.test(normalized)) return false;
  return true;
}

function readSprintIssue(entry: unknown): SprintIssue[] {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
  const issue = entry as Record<string, unknown>;
  const fields = issue.fields;
  if (typeof issue.key !== "string" || !fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  const fieldRecord = fields as Record<string, unknown>;
  const status = fieldRecord.status;
  const issueType = fieldRecord.issuetype;
  const assignee = fieldRecord.assignee;
  if (typeof fieldRecord.summary !== "string") return [];
  const statusName =
    status && typeof status === "object" && !Array.isArray(status) && typeof (status as { name?: unknown }).name === "string"
      ? (status as { name: string }).name
      : "Unknown";
  const typeName =
    issueType && typeof issueType === "object" && !Array.isArray(issueType) && typeof (issueType as { name?: unknown }).name === "string"
      ? (issueType as { name: string }).name
      : "Unknown";
  const assigneeName =
    assignee && typeof assignee === "object" && !Array.isArray(assignee) && typeof (assignee as { displayName?: unknown }).displayName === "string"
      ? (assignee as { displayName: string }).displayName
      : null;
  return [{ key: issue.key, summary: fieldRecord.summary, issueType: typeName, status: statusName, assignee: assigneeName }];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(502, "Jira returned an unexpected payload.");
  }
  return value as Record<string, unknown>;
}

function jiraStatusError(
  status: number,
  message: string,
  retryAfter: string | null,
  config: JiraConfig,
): AppError {
  const safeMessage = redact(message, config);
  console.error(`Jira responded with HTTP ${status}.`);
  if (status === 401) {
    return new AppError(401, "Jira rejected the API credentials.");
  }
  if (status === 403) {
    return new AppError(403, "The Jira API user does not have permission for this operation.");
  }
  if (status === 404) {
    return new AppError(404, "Jira issue was not found or is not visible to the API user.");
  }
  if (status === 429) {
    return new AppError(429, "Jira rate limit reached. Try again later.", {
      details: retryAfter ? { retryAfter } : undefined,
    });
  }
  if (status === 409) {
    return new AppError(409, safeMessage || "Jira rejected the change because of a workflow conflict.");
  }
  if (status === 400) {
    return new AppError(400, safeMessage || "Jira rejected the request.");
  }
  if (status >= 500) {
    return new AppError(502, "Jira returned a server error.");
  }
  return new AppError(502, safeMessage || "Jira request failed.");
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { errorMessages?: unknown; errors?: unknown };
    const messages = Array.isArray(payload.errorMessages)
      ? payload.errorMessages.filter((entry): entry is string => typeof entry === "string")
      : [];
    const fieldErrors =
      payload.errors && typeof payload.errors === "object"
        ? Object.values(payload.errors).filter((entry): entry is string => typeof entry === "string")
        : [];
    return [...messages, ...fieldErrors].join(" ");
  } catch {
    return "";
  }
}

function redact(message: string, config: JiraConfig): string {
  return message.split(config.apiToken).join("[redacted]").split(config.email).join("[redacted]");
}

function readRetryDelaySeconds(header: string | null): number | null {
  if (!header) return null;
  if (!/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
