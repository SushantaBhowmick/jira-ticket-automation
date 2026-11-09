export type IssueSnapshot = {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  originalEstimate: string | null;
  timeSpent: string | null;
  remainingEstimate: string | null;
};

export type AvailableTransition = {
  id: string;
  name: string;
  toStatus: string;
};

export type ExistingWorklog = {
  id: string;
  started: string;
  timeSpentSeconds: number;
  commentText: string;
};

export type NewWorklog = {
  timeSpentSeconds: number;
  started: string;
  comment?: string;
};

export interface JiraGateway {
  getIssue(issueKey: string): Promise<IssueSnapshot>;
  getTransitions(issueKey: string): Promise<AvailableTransition[]>;
  transitionIssue(issueKey: string, transitionId: string): Promise<void>;
  findWorklogsOnDate(
    issueKey: string,
    range: { startedAfterMs: number; startedBeforeMs: number },
  ): Promise<ExistingWorklog[]>;
  addWorklog(issueKey: string, entry: NewWorklog): Promise<{ id: string }>;
}
