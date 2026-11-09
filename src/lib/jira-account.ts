import { getJiraConfig, type JiraConfig } from "@/config/jira.config";
import { AppError } from "@/lib/errors";
import { assertValidStartTime, assertValidTimeZone } from "@/lib/time";

export function assertPactapEmail(email: string): void {
  if (!/^[A-Z0-9._%+-]+@pactap\.com$/i.test(email.trim())) {
    throw new AppError(400, "Use the Pactap Jira email, ending in @pactap.com.", {
      details: { field: "email" },
    });
  }
}

export function assertApiToken(apiToken: string): void {
  const looksLikeJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(apiToken);
  if (looksLikeJwt) {
    throw new AppError(
      400,
      "This value is a browser session token. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens. The Jira website cookies cannot be used.",
    );
  }
}

export function configForRequest(request: Request): JiraConfig {
  const email = request.headers.get("x-jira-email")?.trim() ?? "";
  const apiToken = request.headers.get("x-jira-api-token")?.trim() ?? "";
  if (!email && !apiToken) return getJiraConfig();
  if (!email || !apiToken) {
    throw new AppError(400, "Send both the Jira email and API token.");
  }
  return configForAccount(email, apiToken);
}

export function configForAccount(email: string, apiToken: string): JiraConfig {
  assertPactapEmail(email);
  assertApiToken(apiToken);
  const baseUrl = normalizeBaseUrl(
    (process.env.JIRA_BASE_URL ?? "https://pactap-ecosystem.atlassian.net").trim(),
  );
  const timeZone = (process.env.JIRA_TIMEZONE ?? "Asia/Kolkata").trim();
  const worklogStartTime = (process.env.JIRA_WORKLOG_START_TIME ?? "09:00:00").trim();
  const timeoutMs = readTimeout(process.env.JIRA_HTTP_TIMEOUT_MS ?? "20000");
  assertValidTimeZone(timeZone);
  assertValidStartTime(worklogStartTime);
  return {
    baseUrl,
    email: email.trim(),
    apiToken: apiToken.trim(),
    timeZone,
    worklogStartTime,
    timeoutMs,
  };
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(503, "JIRA_BASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new AppError(503, "JIRA_BASE_URL must use https.");
  }
  if (parsed.username || parsed.password) {
    throw new AppError(503, "JIRA_BASE_URL must not include credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new AppError(503, "JIRA_BASE_URL must not include a query or hash.");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
}

function readTimeout(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new AppError(503, "JIRA_HTTP_TIMEOUT_MS must be an integer from 1000 to 120000.");
  }
  const timeoutMs = Number(value);
  if (timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new AppError(503, "JIRA_HTTP_TIMEOUT_MS must be an integer from 1000 to 120000.");
  }
  return timeoutMs;
}
