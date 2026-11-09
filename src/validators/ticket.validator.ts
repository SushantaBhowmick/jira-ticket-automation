import { hoursToSeconds } from "@/lib/duration";
import { AppError } from "@/lib/errors";
import { assertValidWorkDate } from "@/lib/time";
import { canonicalStatus, isKnownStatus } from "@/workflows/normal.workflow";
import type { ExecuteTicketInput } from "@/types/api";

const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;
const MAX_COMMENT_LENGTH = 5000;

export function validateTicketKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError(400, "ticketKey must be a string like PP3-3198.", {
      details: { field: "ticketKey" },
    });
  }
  const ticketKey = value.trim().toUpperCase();
  if (!TICKET_KEY_PATTERN.test(ticketKey)) {
    throw new AppError(400, "ticketKey must be a string like PP3-3198.", {
      details: { field: "ticketKey" },
    });
  }
  return ticketKey;
}

export function validateExecuteRequest(body: unknown): ExecuteTicketInput {
  const record = asObject(body);
  const ticketKey = validateTicketKey(record.ticketKey);
  const hours = readHours(record.hours);
  const workDate = readWorkDate(record.workDate, hours !== undefined);
  if (hours !== undefined) hoursToSeconds(hours);
  const worklogComment = readComment(record.worklogComment);
  const executeWorkflow = readBoolean(record.executeWorkflow, "executeWorkflow", true);
  const dryRun = readBoolean(record.dryRun, "dryRun", false);
  const targetStatus = readTargetStatus(record.targetStatus);

  if (hours === undefined && !executeWorkflow) {
    throw new AppError(400, "Provide hours to log work, or set executeWorkflow to true.", {
      details: { field: "hours" },
    });
  }

  return {
    ticketKey,
    ...(hours !== undefined ? { hours, workDate } : {}),
    ...(worklogComment !== undefined ? { worklogComment } : {}),
    executeWorkflow,
    dryRun,
    ...(targetStatus ? { targetStatus } : {}),
  };
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function readHours(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number") {
    throw new AppError(400, "hours must be a number greater than zero.", {
      details: { field: "hours" },
    });
  }
  return value;
}

function readWorkDate(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (!required) return undefined;
    throw new AppError(400, "workDate is required when hours are provided.", {
      details: { field: "workDate" },
    });
  }
  if (typeof value !== "string") {
    throw new AppError(400, "workDate must be a real calendar date in YYYY-MM-DD format.", {
      details: { field: "workDate" },
    });
  }
  const workDate = value.trim();
  assertValidWorkDate(workDate);
  return workDate;
}

function readComment(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new AppError(400, "worklogComment must be a string.", {
      details: { field: "worklogComment" },
    });
  }
  const comment = value.trim();
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new AppError(400, `worklogComment must be ${MAX_COMMENT_LENGTH} characters or less.`, {
      details: { field: "worklogComment" },
    });
  }
  return comment.length > 0 ? comment : undefined;
}

function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new AppError(400, `${field} must be true or false.`, { details: { field } });
  }
  return value;
}

function readTargetStatus(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !isKnownStatus(value)) {
    throw new AppError(400, "targetStatus must be one of the configured workflow statuses.", {
      details: { field: "targetStatus" },
    });
  }
  return canonicalStatus(value.trim());
}
