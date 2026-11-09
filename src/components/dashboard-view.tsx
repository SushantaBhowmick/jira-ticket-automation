"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TicketConsole } from "@/components/ticket-console";
import { ToastStack, useToasts } from "@/components/toast-stack";
import { accountHeaders, clearAccount, loadAccount, type StoredAccount } from "@/lib/browser-account";
import type { ActiveSprintSnapshot, SprintIssue } from "@/services/jira.client";

type DashboardTab = "sprint" | "move";

export function DashboardView() {
  const router = useRouter();
  const { toasts, notify, dismiss } = useToasts();
  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [sprint, setSprint] = useState<ActiveSprintSnapshot | null>(null);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [sprintLoading, setSprintLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<DashboardTab>("sprint");
  const [focusTicket, setFocusTicket] = useState<{ key: string; nonce: number } | null>(null);

  useEffect(() => {
    const stored = loadAccount();
    if (!stored) {
      router.replace("/");
      return;
    }
    setAccount(stored);
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!account) return;
    void loadSprint(account, notify, setSprint, setSprintError, setSprintLoading);
  }, [account, notify]);

  const visibleIssues = useMemo(() => {
    const issues = sprint?.issues ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return issues;
    return issues.filter((issue) =>
      `${issue.key} ${issue.summary} ${issue.status} ${issue.assignee ?? ""}`.toLowerCase().includes(needle),
    );
  }, [sprint, query]);

  function useTicket(key: string) {
    setFocusTicket({ key, nonce: Date.now() });
    setTab("move");
  }

  if (!ready || !account) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16">
        <p className="text-sm text-[#5c5348]">Opening the dashboard…</p>
      </main>
    );
  }

  const headers = accountHeaders(account);

  return (
    <>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-3 border-b border-[#e4d9c8] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs tracking-[0.16em] text-[#0f5f5a] uppercase">Pactap · Dashboard</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your tickets</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5c5348]">
              The sprint list is only your open tickets. Stage and production tickets are left out.
            </p>
          </div>
          <div className="rounded-xl border border-[#cfe3df] bg-[#f3faf8] px-3 py-2 text-sm text-[#0f5f5a]">
            <p className="font-medium">{account.displayName}</p>
            <p className="mt-1 text-xs">{account.email}</p>
            <button
              type="button"
              className="mt-2 text-xs font-medium underline"
              onClick={() => {
                clearAccount();
                router.replace("/");
              }}
            >
              Switch account
            </button>
          </div>
        </header>

        <div className="flex gap-2" role="tablist" aria-label="Dashboard sections">
          <TabButton active={tab === "sprint"} onClick={() => setTab("sprint")} label="Active sprint" />
          <TabButton active={tab === "move"} onClick={() => setTab("move")} label="Move ticket" />
        </div>

        <section className={tab === "sprint" ? "rounded-2xl border border-[#e4d9c8] bg-[#fffdf8] p-5" : "hidden"} role="tabpanel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{sprint?.sprintName ?? "Active sprint"}</h2>
              <p className="mt-1 text-sm text-[#5c5348]">
                {sprint
                  ? `${sprint.boardName}${sprint.startDate ? ` · ${sprint.startDate}` : ""}${sprint.endDate ? ` to ${sprint.endDate}` : ""}`
                  : sprintLoading
                    ? "Loading the active sprint…"
                    : "The active sprint could not be loaded."}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#d9cdb8] bg-white px-4 text-sm font-medium"
              onClick={() => loadSprint(account, notify, setSprint, setSprintError, setSprintLoading)}
              disabled={sprintLoading}
            >
              {sprintLoading ? "Refreshing…" : "Refresh sprint"}
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-[#5c5348]">{sprint ? `${sprint.issues.length} open tickets` : ""}</p>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search key, summary, or status"
              className="h-10 w-full rounded-xl border border-[#e4d9c8] bg-white px-3 text-sm outline-none focus:border-[#0f5f5a] sm:max-w-xs"
            />
          </div>

          {sprintLoading ? <p className="mt-4 flex items-center gap-3 rounded-xl bg-[#0f5f5a] px-4 py-3 text-sm font-medium text-white" role="status"><span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Loading the active sprint…</p> : null}

          {sprintError ? (
            <p className="mt-4 rounded-lg bg-[#fff1e8] px-3 py-2 text-sm text-[#9a3412]" role="alert">
              {sprintError}
            </p>
          ) : null}

          <ul className="mt-4 divide-y divide-[#efe6d8] border-y border-[#efe6d8]">
            {visibleIssues.length === 0 && !sprintLoading ? (
              <li className="py-4 text-sm text-[#5c5348]">No tickets in this view.</li>
            ) : (
              visibleIssues.map((issue) => (
                <SprintRow
                  key={issue.key}
                  issue={issue}
                  onCopy={async () => {
                    await navigator.clipboard.writeText(issue.key);
                    notify(`Copied ${issue.key}.`, "ok");
                  }}
                  onUse={() => useTicket(issue.key)}
                />
              ))
            )}
          </ul>
        </section>

        <section className={tab === "move" ? "" : "hidden"} role="tabpanel">
          <TicketConsole
            account={account}
            authHeaders={headers}
            onSignOut={() => {
              clearAccount();
              router.replace("/");
            }}
            onNotify={notify}
            focusTicket={focusTicket}
            embedded
          />
        </section>
      </main>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function SprintRow({
  issue,
  onCopy,
  onUse,
}: {
  issue: SprintIssue;
  onCopy: () => void;
  onUse: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" className="min-w-0 text-left" onClick={onUse}>
        <p className="font-mono text-sm font-semibold text-[#0f5f5a]">{issue.key}</p>
        <p className="mt-1 text-sm">{issue.summary}</p>
        <p className="mt-1 text-xs text-[#5c5348]">
          {issue.issueType} · {issue.status}
          {issue.assignee ? ` · ${issue.assignee}` : ""}
        </p>
      </button>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-full border border-[#d9cdb8] bg-white px-3 text-sm"
          onClick={onCopy}
        >
          Copy key
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-full bg-[#0f5f5a] px-3 text-sm text-white"
          onClick={onUse}
        >
          Use ticket
        </button>
      </div>
    </li>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium ${active ? "bg-[#0f5f5a] text-white" : "border border-[#d9cdb8] bg-white text-[#5c5348]"}`}
    >
      {label}
    </button>
  );
}

async function loadSprint(
  account: StoredAccount,
  notify: (text: string, tone: "ok" | "bad") => void,
  setSprint: (sprint: ActiveSprintSnapshot) => void,
  setSprintError: (message: string | null) => void,
  setSprintLoading: (loading: boolean) => void,
) {
  setSprintLoading(true);
  setSprintError(null);
  try {
    const response = await fetch("/api/jira/sprint", { headers: accountHeaders(account) });
    const payload = (await response.json()) as ActiveSprintSnapshot & { error?: string };
    if (!response.ok || !payload.sprintName) {
      const message = payload.error ?? "The active sprint could not be loaded.";
      setSprintError(message);
      notify(message, "bad");
      return;
    }
    setSprint(payload);
    notify(`Loaded ${payload.sprintName}. ${payload.issues.length} tickets.`, "ok");
  } catch {
    const message = "The browser could not reach this app.";
    setSprintError(message);
    notify(message, "bad");
  } finally {
    setSprintLoading(false);
  }
}
