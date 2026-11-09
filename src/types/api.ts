export type ExecuteTicketInput = {
  ticketKey: string;
  hours?: number;
  workDate?: string;
  worklogComment?: string;
  executeWorkflow: boolean;
  dryRun: boolean;
  targetStatus?: string;
};

export type WorkflowStepResult = {
  status: string;
  success: boolean;
  transitionId?: string;
  transitionName?: string;
};

export type WorklogResult = {
  success: boolean;
  hours?: number;
  workDate?: string;
  timeSpent?: string;
  timeSpentSeconds?: number;
  started?: string;
  jiraWorklogId?: string;
  skipped?: boolean;
  wouldCreate?: boolean;
  uncertain?: boolean;
  reason?: string;
  message?: string;
  error?: string;
};

export type WorkflowExecutionResult = {
  success: boolean;
  completedSteps: WorkflowStepResult[];
  finalStatus?: string;
  plannedSteps?: string[];
  verifiedNextStep?: string | null;
  failedAt?: string;
  currentStatus?: string;
  availableTransitions?: string[];
  noop?: boolean;
  skipped?: boolean;
  uncertain?: boolean;
  message?: string;
  limitation?: string;
  error?: string;
};

export type ExecuteResponse = {
  success: boolean;
  dryRun: boolean;
  ticketKey: string;
  workflow: "NORMAL" | "REOPEN" | "BUG_LOGGED" | null;
  executionOrder: "workflow_then_worklog";
  worklogPolicy: "after_successful_workflow" | "worklog_only";
  issue: {
    summary: string;
    issueType: string;
    currentStatus: string;
  };
  worklog: WorklogResult;
  workflowExecution: WorkflowExecutionResult;
};

export type InspectResponse = {
  ticketKey: string;
  summary: string;
  issueType: string;
  currentStatus: string;
  originalEstimate: string | null;
  timeSpent: string | null;
  remainingEstimate: string | null;
  workflow: "NORMAL" | "REOPEN" | "BUG_LOGGED" | null;
  workflowLabel: string | null;
  statusInWorkflow: boolean;
  workflowIndex: number | null;
  workflowStatuses: string[];
  nextStatuses: string[];
  transitions: Array<{ id: string; name: string; toStatus: string }>;
  note: string;
};
