const DEVELOPMENT_STATUSES = [
  "Marked for Development",
  "In Progress",
  "DONE - CODED & MERGED",
  "Build Created - Dev. Env",
  "Build Deployed - Dev. Env.",
  "Under Testing - DEV. ENV",
  "Testing Completed - DEV. ENV",
  "Live - DEV. ENV",
  "Build Created - STAGE ENV.",
  "Build Deployed - Stage ENV.",
] as const;

export const BUG_LOGGED_STATUS = "BUG LOGGED";
export const REOPEN_STATUS = "Re - Open";

export type WorkflowKey = "NORMAL" | "REOPEN" | "BUG_LOGGED";

export type WorkflowDefinition = {
  key: WorkflowKey;
  label: string;
  statuses: string[];
};

const AFTER_IN_PROGRESS = DEVELOPMENT_STATUSES.slice(1);

export const WORKFLOWS: Record<WorkflowKey, WorkflowDefinition> = {
  NORMAL: {
    key: "NORMAL",
    label: "Development",
    statuses: [...DEVELOPMENT_STATUSES],
  },
  REOPEN: {
    key: "REOPEN",
    label: "Re-Open",
    statuses: [REOPEN_STATUS, ...AFTER_IN_PROGRESS],
  },
  BUG_LOGGED: {
    key: "BUG_LOGGED",
    label: "Bug logged",
    statuses: [BUG_LOGGED_STATUS, REOPEN_STATUS, ...AFTER_IN_PROGRESS],
  },
};

export const NORMAL_WORKFLOW = WORKFLOWS.NORMAL;

const STATUS_ALIASES: Record<string, string> = {
  "in progres": "In Progress",
  "done codded & merged": "DONE - CODED & MERGED",
  "build created - dev. env": "Build Created - Dev. Env",
  "build depllyed - dev. env": "Build Deployed - Dev. Env.",
  "build deployed - dev. env": "Build Deployed - Dev. Env.",
  "testing initiated - dev.": "Under Testing - DEV. ENV",
  "testing initiated - dev. env": "Under Testing - DEV. ENV",
  "testing completed - dev.": "Testing Completed - DEV. ENV",
  "testing completed - dev. env": "Testing Completed - DEV. ENV",
  "live - dev. env": "Live - DEV. ENV",
  "build created - stage env.": "Build Created - STAGE ENV.",
  "build deployed - stage env.": "Build Deployed - Stage ENV.",
  "build deployed - stagging. env": "Build Deployed - Stage ENV.",
  "build deployed- stagging. env": "Build Deployed - Stage ENV.",
  "re-open": REOPEN_STATUS,
  "re - open": REOPEN_STATUS,
  "bug logged": BUG_LOGGED_STATUS,
};

const KNOWN_STATUSES = new Set(
  Object.values(WORKFLOWS).flatMap((workflow) => workflow.statuses),
);

export function canonicalStatus(status: string): string {
  const trimmed = status.trim();
  if (KNOWN_STATUSES.has(trimmed)) return trimmed;
  return STATUS_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function isKnownStatus(status: string): boolean {
  return KNOWN_STATUSES.has(canonicalStatus(status));
}

export function selectWorkflow(issueType: string, currentStatus: string): WorkflowDefinition | null {
  const status = canonicalStatus(currentStatus);
  const bug = /\bbug\b/i.test(issueType);

  if (status === BUG_LOGGED_STATUS) return WORKFLOWS.BUG_LOGGED;
  if (status === REOPEN_STATUS) return bug ? WORKFLOWS.BUG_LOGGED : WORKFLOWS.REOPEN;
  if (status === "Marked for Development") return WORKFLOWS.NORMAL;
  if ((DEVELOPMENT_STATUSES as readonly string[]).includes(status)) {
    return bug ? WORKFLOWS.BUG_LOGGED : WORKFLOWS.NORMAL;
  }
  return null;
}

export function statusesAfter(workflow: WorkflowDefinition, currentStatus: string): string[] {
  const index = workflow.statuses.indexOf(canonicalStatus(currentStatus));
  if (index < 0) return [];
  return workflow.statuses.slice(index + 1);
}

export const DRY_RUN_LIMITATION =
  "Only the next transition can be checked. Later steps appear only after Jira exposes them, so this preview does not prove the rest of the path.";

export const WORKLOG_POLICY = {
  afterSuccessfulWorkflow: "after_successful_workflow",
  worklogOnly: "worklog_only",
} as const;
