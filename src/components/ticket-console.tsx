"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/dialog";
import type { StoredAccount } from "@/lib/browser-account";
import type { ExecuteResponse, InspectResponse } from "@/types/api";

type Health = {
  configured: boolean;
  missing: string[];
  baseUrl?: string;
  timeZone: string;
  worklogStartTime: string;
};

type ApiError = {
  success: false;
  error: string;
  uncertain?: boolean;
  details?: unknown;
};

type ResultState = {
  status: number;
  payload: ExecuteResponse | InspectResponse | ApiError;
};

const TICKET_PATTERN = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

export function TicketConsole({
  account,
  authHeaders,
  onSignOut,
  onNotify,
  focusTicket = null,
  embedded = false,
}: {
  account: StoredAccount;
  authHeaders: Record<string, string>;
  onSignOut: () => void;
  onNotify: (text: string, tone: "ok" | "bad") => void;
  focusTicket?: { key: string; nonce: number } | null;
  embedded?: boolean;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [ticketKey, setTicketKey] = useState("");
  const [ticket, setTicket] = useState<InspectResponse | null>(null);
  const [hours, setHours] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [comment, setComment] = useState("");
  const [executeWorkflow, setExecuteWorkflow] = useState(true);
  const [targetStatus, setTargetStatus] = useState("");
  const [loading, setLoading] = useState<"inspect" | "preview" | "execute" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [dialog, setDialog] = useState<"execute" | "signout" | null>(null);

  useEffect(() => {
    setWorkDate(todayIso());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jira/health")
      .then((response) => response.json())
      .then((payload: Health) => {
        if (!cancelled) setHealth(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setHealth({
            configured: false,
            missing: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
            timeZone: "Asia/Kolkata",
            worklogStartTime: "09:00:00",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetWorklogInputs() {
    setHours("");
    setWorkDate(todayIso());
  }

  useEffect(() => {
    if (!focusTicket) return;
    setTicketKey(focusTicket.key);
    resetWorklogInputs();
    void loadTicket(focusTicket.key);
  }, [focusTicket]);

  async function loadTicket(key: string) {
    const keyError = validateKey(key);
    if (keyError) {
      setFormError(keyError);
      return;
    }
    setFormError(null);
    setLoading("inspect");
    try {
      const response = await fetch(`/api/jira/tickets/${encodeURIComponent(key.trim())}/inspect`, {
        headers: authHeaders,
      });
      const payload = (await response.json()) as InspectResponse | ApiError;
      if (response.ok && isInspectResponse(payload)) {
        setTicket(payload);
        setTargetStatus("");
        setResult(null);
        setFormError(null);
        onNotify(`Fetched ${payload.ticketKey}. It is on ${payload.currentStatus}.`, "ok");
      } else {
        setTicket(null);
        setResult({ status: response.status, payload });
        onNotify(isApiError(payload) ? payload.error : "The ticket could not be fetched.", "bad");
      }
    } catch {
      const message = "The browser could not reach this app.";
      setResult({ status: 0, payload: { success: false, error: message } });
      onNotify(message, "bad");
    } finally {
      setLoading(null);
    }
  }

  function inspect(event: FormEvent) {
    event.preventDefault();
    void loadTicket(ticketKey);
  }

  function requestExecute() {
    if (!ticket) {
      setFormError("Fetch the ticket before previewing or executing.");
      return;
    }
    const validationError = validateAction({ hours, workDate });
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setDialog("execute");
  }

  async function run(dryRun: boolean) {
    if (!ticket) {
      setFormError("Fetch the ticket before previewing or executing.");
      return;
    }
    const validationError = validateAction({ hours, workDate });
    if (validationError) {
      setFormError(validationError);
      return;
    }
    const logWork = hours.trim() !== "";
    if (!dryRun) {
      requestExecute();
      return;
    }

    await submit(true, logWork);
  }

  async function submit(dryRun: boolean, logWork = hours.trim() !== "") {
    if (!ticket) return;
    setDialog(null);
    setFormError(null);
    setLoading(dryRun ? "preview" : "execute");
    try {
      const response = await fetch("/api/jira/tickets/normal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          ticketKey: ticket.ticketKey,
          ...(logWork ? { hours: Number(hours), workDate } : {}),
          ...(comment.trim() && logWork ? { worklogComment: comment.trim() } : {}),
          executeWorkflow,
          dryRun,
          ...(executeWorkflow && targetStatus ? { targetStatus } : {}),
        }),
      });
      const payload = (await response.json()) as ExecuteResponse | ApiError;
      setResult({ status: response.status, payload });
      if (isExecuteResponse(payload)) {
        if (!dryRun && payload.success) {
          const statusName = payload.workflowExecution.finalStatus ?? payload.issue.currentStatus;
          resetWorklogInputs();
          onNotify(`${payload.ticketKey} updated. Current status is ${statusName}.`, "ok");
        } else if (!payload.success) {
          onNotify(
            payload.workflowExecution.error ?? payload.worklog.error ?? "Jira did not finish the update.",
            "bad",
          );
        }
      } else if (isApiError(payload)) {
        onNotify(payload.error, "bad");
      }
      try {
        const refreshed = await fetch(
          `/api/jira/tickets/${encodeURIComponent(ticket.ticketKey)}/inspect`,
          { headers: authHeaders },
        );
        const inspected = (await refreshed.json()) as InspectResponse | ApiError;
        if (refreshed.ok && isInspectResponse(inspected)) {
          setTicket(inspected);
          setTargetStatus((current) =>
            current && inspected.nextStatuses.includes(current) ? current : "",
          );
        }
      } catch {
        // The execute result is already shown. A failed refresh does not undo it.
      }
    } catch {
      const message = "The browser could not reach this app.";
      setResult({ status: 0, payload: { success: false, error: message } });
      onNotify(message, "bad");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      id="workflow"
      className={embedded ? "flex w-full flex-col" : "mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6"}
    >
      {embedded ? (
        <h2 className="text-xl font-semibold tracking-tight">Move a ticket</h2>
      ) : (
      <header className="mb-6 flex flex-col gap-3 border-b border-[#e4d9c8] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.16em] text-[#0f5f5a] uppercase">
            Pactap · Jira Cloud
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Ticket workflow</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5c5348]">
            Fetch a ticket first. The next statuses come from its type and current status. Hours are optional.
          </p>
        </div>
        <AccountBadge account={account} health={health} onSignOut={() => setDialog("signout")} />
      </header>
      )}

      <div className={`grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] ${embedded ? "mt-4" : ""}`}>
        <form
          className="rounded-2xl border border-[#e4d9c8] bg-[#fffdf8] p-5 shadow-[0_1px_0_rgba(28,25,21,0.04)]"
          onSubmit={inspect}
        >
          {loading ? <BusyNotice label={loadingLabel(loading)} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <FieldLabel>Ticket key</FieldLabel>
              <input
                value={ticketKey}
                onChange={(event) => {
                  setTicketKey(event.target.value);
                  setTicket(null);
                }}
                placeholder="PP3-3174"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
            </label>
            {ticket ? (
              <div className="rounded-xl border border-[#cfe3df] bg-[#f3faf8] p-4 sm:col-span-2">
                <p className="font-mono text-xs text-[#0f5f5a]">{ticket.ticketKey}</p>
                <p className="mt-1 text-sm font-medium">{ticket.summary}</p>
                <p className="mt-2 text-sm text-[#5c5348]">
                  {ticket.issueType} · {ticket.currentStatus}
                  {ticket.statusInWorkflow
                    ? ` · ${ticket.workflowLabel} · step ${(ticket.workflowIndex ?? 0) + 1} of ${ticket.workflowStatuses.length}`
                    : " · this status is not in a configured workflow"}
                </p>
                {ticket.nextStatuses.length > 0 ? (
                  <p className="mt-2 text-sm">
                    Next configured statuses: {ticket.nextStatuses.join(", ")}.
                  </p>
                ) : ticket.statusInWorkflow ? (
                  <p className="mt-2 text-sm">This ticket is already at the last configured status.</p>
                ) : null}
                <p className="mt-3 text-sm font-bold">
                  Estimate {showTime(ticket.originalEstimate)} · Logged {showTime(ticket.timeSpent)} · Remaining{" "}
                  {showTime(ticket.remainingEstimate)}
                </p>
                {ticket.transitions.length > 0 ? (
                  <p className="mt-2 text-sm">
                    Jira can move this to{" "}
                    {ticket.transitions.map((transition) => transition.toStatus).join(", ")}.
                  </p>
                ) : (
                  <p className="mt-2 text-sm">Jira did not return a transition from this status.</p>
                )}
              </div>
            ) : null}
            <label className="block">
              <FieldLabel>Hours, optional</FieldLabel>
              <input
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                inputMode="decimal"
                placeholder="Leave empty to skip the worklog"
                disabled={!ticket}
                className={inputClass}
              />
              {ticket ? (
                <p className="mt-2 text-xs leading-5 text-[#5c5348]">
                  Already logged {showTime(ticket.timeSpent)}. Estimate is {showTime(ticket.originalEstimate)}. Logged hours are subtracted from the remaining estimate.
                </p>
              ) : null}
            </label>
            <label className="block">
              <FieldLabel>Work date</FieldLabel>
              <input
                type="date"
                value={workDate}
                onChange={(event) => setWorkDate(event.target.value)}
                disabled={!ticket}
                className={inputClass}
              />
            </label>
            <label className="block sm:col-span-2">
              <FieldLabel>Worklog comment</FieldLabel>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={5000}
                rows={3}
                placeholder="Optional, and only used when hours are entered"
                disabled={!ticket}
                className={`${fieldClass} min-h-24 resize-y py-2`}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={executeWorkflow}
                onChange={(event) => setExecuteWorkflow(event.target.checked)}
                disabled={!ticket}
                className="size-4 accent-[#0f5f5a]"
              />
              Move this ticket forward
            </label>
            <label className="block">
              <FieldLabel>Stop at</FieldLabel>
              <select
                value={targetStatus}
                disabled={!ticket || !executeWorkflow || ticket.nextStatuses.length === 0}
                onChange={(event) => setTargetStatus(event.target.value)}
                className={inputClass}
              >
                <option value="">
                  {ticket && ticket.nextStatuses.length === 0
                    ? "Already at the last status"
                    : `End of the ${ticket?.workflowLabel ?? "workflow"}`}
                </option>
                {(ticket?.nextStatuses ?? []).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-4 text-sm leading-6 text-[#5c5348]">
            Fetch the ticket, then preview or execute. The stop-at list starts after the current
            status. The status you pick is the last stop, and each status between the current one
            and that stop is applied in order. Logged hours are added to time spent and
            subtracted from the remaining estimate. Leave hours empty to move the ticket without
            logging work. When hours are
            entered, the worklog is written only after every requested transition succeeds.
            {health ? ` The worklog time is ${health.worklogStartTime} in ${health.timeZone}.` : ""}
          </p>

          {formError ? (
            <p className="mt-3 rounded-lg bg-[#fff1e8] px-3 py-2 text-sm text-[#9a3412]" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="submit" className={secondaryButton} disabled={loading !== null}>
              {loading === "inspect" ? "Fetching…" : "Fetch ticket"}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={loading !== null || !ticket}
              onClick={() => run(true)}
            >
              {loading === "preview" ? "Previewing…" : "Preview"}
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#9a3412] px-5 text-sm font-medium text-[#fff7ed] hover:bg-[#7c2d12]"
              disabled={loading !== null || !ticket}
              onClick={() => run(false)}
            >
              {loading === "execute" ? "Updating Jira…" : "Execute"}
            </button>
          </div>
        </form>

        <aside className="rounded-2xl border border-[#e4d9c8] bg-[#fffdf8] p-5">
          <h2 className="text-sm font-semibold">{ticket?.workflowLabel ?? "Workflow"}</h2>
          <p className="mt-1 text-xs leading-5 text-[#5c5348]">
            {ticket
              ? "The highlighted status is where this ticket is now. Later rows are the only stops offered."
              : "Fetch a ticket to see its current status and the statuses that come after it."}
          </p>
          {ticket && ticket.workflowStatuses.length > 0 ? (
            <ol className="mt-4 space-y-2">
              {ticket.workflowStatuses.map((status, index) => {
                const current = ticket.workflowIndex === index;
                const passed = ticket.workflowIndex !== null && index < ticket.workflowIndex;
                return (
                  <li
                    key={status}
                    className={`flex gap-3 text-sm ${current ? "font-semibold text-[#0f5f5a]" : passed ? "text-[#8a7d6b]" : ""}`}
                  >
                    <span className="mt-0.5 font-mono text-xs text-[#8a7d6b]">{index + 1}</span>
                    <span>{status}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-[#5c5348]">
              A task starts at Marked for Development. A reopen starts at Re - Open, then In Progress.
              A bug starts at BUG LOGGED, then Re - Open, then In Progress.
            </p>
          )}
        </aside>
      </div>

      <section className="mt-6" aria-live="polite">
        {result ? <ResultPanel result={result} /> : null}
      </section>
      <ConfirmDialog
        open={dialog === "execute"}
        title={`Update ${ticket?.ticketKey ?? "this ticket"}`}
        confirmLabel="Update Jira"
        pending={loading === "execute"}
        onClose={() => setDialog(null)}
        onConfirm={() => submit(false)}
      >
        <p>This writes to Jira with {account.displayName}&apos;s account.</p>
        <p>
          {executeWorkflow
            ? `Each status is applied in order, stopping at ${
                targetStatus || `the end of the ${ticket?.workflowLabel ?? "workflow"}`
              }.`
            : "The workflow will be skipped."}
        </p>
        <p>
          {hours.trim()
            ? `${hours}h on ${workDate} is added to time spent after the workflow succeeds, and the remaining estimate is reduced by that time.`
            : "No worklog will be created."}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "signout"}
        title="Switch Jira account"
        confirmLabel="Sign out"
        tone="neutral"
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          onSignOut();
        }}
      >
        <p>This browser will forget {account.email}. The next person unlocks the tool and connects their own token.</p>
      </ConfirmDialog>
    </div>
  );
}

function AccountBadge({
  account,
  health,
  onSignOut,
}: {
  account: StoredAccount;
  health: Health | null;
  onSignOut: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#cfe3df] bg-[#f3faf8] px-3 py-2 text-sm text-[#0f5f5a]">
      <p className="font-medium">{account.displayName}</p>
      <p className="mt-1 text-xs">{account.email}</p>
      {health?.baseUrl ? <p className="mt-1 font-mono text-xs break-all">{health.baseUrl}</p> : null}
      <button type="button" className="mt-2 text-xs font-medium underline" onClick={onSignOut}>
        Switch account
      </button>
    </div>
  );
}

function ResultPanel({ result }: { result: ResultState }) {
  const payload = result.payload;
  if (isExecuteResponse(payload)) return <ExecuteResult status={result.status} payload={payload} />;
  if (isInspectResponse(payload)) return <InspectResult payload={payload} />;
  return (
    <article className="rounded-2xl border border-[#f0c9b0] bg-[#fff7ed] p-5">
      <h2 className="text-lg font-semibold text-[#9a3412]">Request failed</h2>
      <p className="mt-2 text-sm leading-6">{payload.error}</p>
      {payload.uncertain ? (
        <p className="mt-2 text-sm">Jira may have applied the last change. Check the ticket before retrying.</p>
      ) : null}
      <p className="mt-3 font-mono text-xs text-[#8a7d6b]">HTTP {result.status}</p>
    </article>
  );
}

function InspectResult({ payload }: { payload: InspectResponse }) {
  return (
    <article className="rounded-2xl border border-[#e4d9c8] bg-[#fffdf8] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{payload.ticketKey}</h2>
        <p className="font-mono text-xs text-[#8a7d6b]">Read only</p>
      </div>
      <p className="mt-2 text-sm text-[#5c5348]">{payload.summary}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Info label="Issue type" value={payload.issueType} />
        <Info label="Current status" value={payload.currentStatus} />
        <Info
          label="Workflow"
          value={
            payload.statusInWorkflow
              ? `${payload.workflowLabel}, step ${(payload.workflowIndex ?? 0) + 1}`
              : "Not configured"
          }
        />
      </dl>
      <h3 className="mt-5 text-sm font-semibold">Available transitions</h3>
      {payload.transitions.length === 0 ? (
        <p className="mt-2 text-sm text-[#5c5348]">Jira did not return any transitions.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#efe6d8] border-y border-[#efe6d8]">
          {payload.transitions.map((transition) => (
            <li key={transition.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between">
              <span>
                {transition.toStatus}
                {transition.name !== transition.toStatus ? (
                  <span className="text-[#5c5348]"> via {transition.name}</span>
                ) : null}
              </span>
              <span className="font-mono text-xs text-[#8a7d6b]">id {transition.id}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ExecuteResult({ status, payload }: { status: number; payload: ExecuteResponse }) {
  const tone = payload.success ? "ok" : payload.workflowExecution.uncertain || payload.worklog.uncertain ? "warn" : "bad";
  const shell =
    tone === "ok"
      ? "border-[#cfe3df] bg-[#f3faf8]"
      : tone === "warn"
        ? "border-[#ead79a] bg-[#fffbeb]"
        : "border-[#f0c9b0] bg-[#fff7ed]";

  return (
    <article className={`rounded-2xl border p-5 ${shell}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {payload.dryRun ? "Preview" : "Execution"} {payload.success ? "succeeded" : "stopped"}
        </h2>
        <p className="font-mono text-xs text-[#8a7d6b]">
          HTTP {status} · {payload.ticketKey}
        </p>
      </div>
      <p className="mt-2 text-sm text-[#5c5348]">
        {payload.issue.issueType} · {payload.issue.summary}
      </p>
      <p className="mt-1 text-sm">
        Current status: <span className="font-medium">{payload.issue.currentStatus}</span>
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Workflow</h3>
          {payload.workflowExecution.message ? (
            <p className="mt-2 text-sm leading-6">{payload.workflowExecution.message}</p>
          ) : null}
          {payload.workflowExecution.error ? (
            <p className="mt-2 text-sm leading-6">{payload.workflowExecution.error}</p>
          ) : null}
          {payload.workflowExecution.limitation ? (
            <p className="mt-2 text-sm leading-6 text-[#5c5348]">{payload.workflowExecution.limitation}</p>
          ) : null}
          {payload.workflowExecution.plannedSteps && payload.workflowExecution.plannedSteps.length > 0 ? (
            <StepList
              title="Planned"
              steps={payload.workflowExecution.plannedSteps.map((statusName) => ({
                label: statusName,
                state: statusName === payload.workflowExecution.verifiedNextStep ? "Next, available now" : "Not checked yet",
              }))}
            />
          ) : null}
          {payload.workflowExecution.completedSteps.length > 0 ? (
            <StepList
              title="Completed"
              steps={payload.workflowExecution.completedSteps.map((step) => ({
                label: step.status,
                state: step.transitionId ? `transition ${step.transitionId}` : "done",
              }))}
            />
          ) : null}
          {payload.workflowExecution.finalStatus ? (
            <p className="mt-3 text-sm">
              Final status: <span className="font-medium">{payload.workflowExecution.finalStatus}</span>
            </p>
          ) : null}
          {payload.workflowExecution.failedAt ? (
            <p className="mt-2 text-sm">
              Failed at: <span className="font-medium">{payload.workflowExecution.failedAt}</span>
            </p>
          ) : null}
          {payload.workflowExecution.availableTransitions ? (
            <div className="mt-3">
              <p className="text-xs font-medium tracking-wide text-[#5c5348] uppercase">Available now</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {payload.workflowExecution.availableTransitions.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Worklog</h3>
          <dl className="mt-2 space-y-1 text-sm">
            {payload.worklog.hours !== undefined ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#5c5348]">Hours</dt>
                <dd>{payload.worklog.hours}</dd>
              </div>
            ) : null}
            {payload.worklog.workDate ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#5c5348]">Date</dt>
                <dd>{payload.worklog.workDate}</dd>
              </div>
            ) : null}
            {payload.worklog.started ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#5c5348]">Started</dt>
                <dd className="font-mono text-xs">{payload.worklog.started}</dd>
              </div>
            ) : null}
            {payload.worklog.timeSpent ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#5c5348]">Duration</dt>
                <dd>{payload.worklog.timeSpent}</dd>
              </div>
            ) : null}
            {payload.worklog.jiraWorklogId ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#5c5348]">Worklog id</dt>
                <dd className="font-mono text-xs">{payload.worklog.jiraWorklogId}</dd>
              </div>
            ) : null}
          </dl>
          {payload.worklog.message ? <p className="mt-3 text-sm leading-6">{payload.worklog.message}</p> : null}
          {payload.worklog.error ? <p className="mt-3 text-sm leading-6">{payload.worklog.error}</p> : null}
          {payload.worklog.wouldCreate ? (
            <p className="mt-3 text-sm">Preview only. This worklog was not created.</p>
          ) : null}
        </div>
      </div>
      <details className="mt-5">
        <summary className="cursor-pointer text-sm font-medium">Response JSON</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-[#1c1915] p-3 text-xs leading-5 text-[#f3efe6]">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </article>
  );
}

function StepList({ steps, title }: { title: string; steps: Array<{ label: string; state: string }> }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium tracking-wide text-[#5c5348] uppercase">{title}</p>
      <ul className="mt-1 space-y-1">
        {steps.map((step) => (
          <li key={`${title}-${step.label}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span>{step.label}</span>
            <span className="font-mono text-[11px] text-[#8a7d6b]">{step.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-[#8a7d6b] uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-medium tracking-wide text-[#5c5348] uppercase">{children}</span>;
}

function showTime(value: string | null): string {
  return value && value.trim() ? value : "Not set";
}

function loadingLabel(loading: "inspect" | "preview" | "execute"): string {
  if (loading === "inspect") return "Fetching the ticket…";
  if (loading === "preview") return "Checking the next step…";
  return "Updating the ticket…";
}

function BusyNotice({ label }: { label: string }) {
  return (
    <p className="mb-4 flex items-center gap-3 rounded-xl bg-[#0f5f5a] px-4 py-3 text-sm font-medium text-white" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      {label}
    </p>
  );
}

function isExecuteResponse(payload: ResultState["payload"]): payload is ExecuteResponse {
  return "workflowExecution" in payload && "worklog" in payload;
}

function isApiError(payload: ResultState["payload"]): payload is ApiError {
  return "error" in payload && !("workflowExecution" in payload) && !("transitions" in payload);
}

function isInspectResponse(payload: ResultState["payload"]): payload is InspectResponse {
  return "transitions" in payload && "currentStatus" in payload && !("workflowExecution" in payload);
}

function validateKey(ticketKey: string): string | null {
  if (!TICKET_PATTERN.test(ticketKey.trim())) return "Enter a ticket key like PP3-3198.";
  return null;
}

function validateAction(input: { hours: string; workDate: string }): string | null {
  if (input.hours.trim() === "") return null;
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return "Enter hours greater than zero, or leave hours empty.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) return "Choose a work date for the worklog.";
  return null;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const fieldClass =
  "w-full rounded-xl border border-[#e4d9c8] bg-white px-3 text-sm outline-none focus:border-[#0f5f5a]";

const inputClass = `h-11 ${fieldClass} disabled:opacity-60`;

const secondaryButton =
  "inline-flex h-11 items-center justify-center rounded-full border border-[#d9cdb8] bg-white px-5 text-sm font-medium hover:bg-[#f7f1e6]";
