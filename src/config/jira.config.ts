import { AppError } from "@/lib/errors";
import { assertValidStartTime, assertValidTimeZone } from "@/lib/time";

export type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  timeZone: string;
  worklogStartTime: string;
  timeoutMs: number;
};

const REQUIRED_VARIABLES = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"] as const;

export function getJiraConfig(): JiraConfig {
  const missing = REQUIRED_VARIABLES.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new AppError(
      503,
      `Jira is not configured. Set ${missing.join(", ")} in .env.local.`,
      { details: { missing } },
    );
  }

  const email = process.env.JIRA_EMAIL!.trim();
  const apiToken = process.env.JIRA_API_TOKEN!.trim();
  assertApiToken(apiToken);
  return { ...siteSettings(), email, apiToken };
}

export function getPublicJiraConfig(): {
  configured: boolean;
  missing: string[];
  baseUrl?: string;
  timeZone: string;
  worklogStartTime: string;
} {
  try {
    const site = siteSettings();
    return {
      configured: true,
      missing: [],
      baseUrl: site.baseUrl,
      timeZone: site.timeZone,
      worklogStartTime: site.worklogStartTime,
    };
  } catch {
    return {
      configured: false,
      missing: ["JIRA_BASE_URL"],
      timeZone: "Asia/Kolkata",
      worklogStartTime: "09:00:00",
    };
  }
}

function siteSettings(): Omit<JiraConfig, "email" | "apiToken"> {
  const baseUrl = normalizeBaseUrl(
    (process.env.JIRA_BASE_URL ?? "https://pactap-ecosystem.atlassian.net").trim(),
  );
  const timeZone = (process.env.JIRA_TIMEZONE ?? "Asia/Kolkata").trim();
  const worklogStartTime = (process.env.JIRA_WORKLOG_START_TIME ?? "09:00:00").trim();
  const timeoutMs = readTimeout(process.env.JIRA_HTTP_TIMEOUT_MS ?? "20000");
  assertValidTimeZone(timeZone);
  assertValidStartTime(worklogStartTime);
  return { baseUrl, timeZone, worklogStartTime, timeoutMs };
}

function assertApiToken(apiToken: string): void {
  const looksLikeJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(apiToken);
  if (!looksLikeJwt) return;
  throw new AppError(
    503,
    "JIRA_API_TOKEN is a browser session token. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens and put that value in .env.local. The Jira website cookies cannot be used for the REST API.",
  );
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
