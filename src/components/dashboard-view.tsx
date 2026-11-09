"use client";

import { Check, Copy, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TicketConsole } from "@/components/ticket-console";
import { ToastStack, useToasts } from "@/components/toast-stack";
import { accountHeaders, clearAccount, loadAccount, type StoredAccount } from "@/lib/browser-account";
import { cn } from "@/lib/utils";
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState<DashboardTab>("sprint");
  const [focusTicket, setFocusTicket] = useState<{ key: string; nonce: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of sprint?.issues ?? []) {
      counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }, [sprint]);

  const visibleIssues = useMemo(() => {
    const issues = sprint?.issues ?? [];
    const needle = query.trim().toLowerCase();
    return issues.filter((issue) => {
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      if (!needle) return true;
      return `${issue.key} ${issue.summary} ${issue.status} ${issue.issueType}`.toLowerCase().includes(needle);
    });
  }, [sprint, query, statusFilter]);

  function useTicket(key: string) {
    setFocusTicket({ key, nonce: Date.now() });
    setTab("move");
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    notify(`Copied ${key}.`, "ok");
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
  }

  if (!ready || !account) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[#d7e3df] px-4">
        <p className="text-sm text-[#3d534f]">Opening the dashboard…</p>
      </main>
    );
  }

  const headers = accountHeaders(account);

  return (
    <>
      <main className="min-h-full flex-1 bg-[linear-gradient(180deg,#c9ddd8_0%,#dfe8e2_38%,#efe8dc_100%)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-xs tracking-[0.16em] text-[#0f5f5a] uppercase">Pactap · Dashboard</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your tickets</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3d534f]">
                Open work from the active sprint. Stage and production tickets stay off this list.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 shadow-sm backdrop-blur">
              <span className="flex size-9 items-center justify-center rounded-full bg-[#0f5f5a] text-sm font-semibold text-white">
                {initials(account.displayName)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{account.displayName}</p>
                <p className="truncate text-xs text-[#5c5348]">{account.email}</p>
              </div>
              <button
                type="button"
                className="ml-1 rounded-full px-2 py-1 text-xs font-medium text-[#0f5f5a] underline"
                onClick={() => {
                  clearAccount();
                  router.replace("/");
                }}
              >
                Switch
              </button>
            </div>
          </header>

          <div className="flex gap-2" role="tablist" aria-label="Dashboard sections">
            <TabButton active={tab === "sprint"} onClick={() => setTab("sprint")} label="Active sprint" count={sprint?.issues.length} />
            <TabButton active={tab === "move"} onClick={() => setTab("move")} label="Move ticket" />
          </div>

          <section className={tab === "sprint" ? "space-y-4" : "hidden"} role="tabpanel">
            <div className="rounded-3xl border border-white/70 bg-[#fffdf8]/95 p-5 shadow-[0_10px_30px_rgba(28,25,21,0.06)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{sprint?.sprintName ?? "Active sprint"}</h2>
                  <p className="mt-1 text-sm text-[#5c5348]">
                    {sprint
                      ? `${sprint.boardName}${sprint.startDate ? ` · ${formatRange(sprint.startDate, sprint.endDate)}` : ""}`
                      : sprintLoading
                        ? "Loading the active sprint…"
                        : "The active sprint could not be loaded."}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[#d9cdb8] bg-white px-4 text-sm font-medium hover:bg-[#f7f1e6]"
                  onClick={() => loadSprint(account, notify, setSprint, setSprintError, setSprintLoading)}
                  disabled={sprintLoading}
                >
                  <RefreshCw className={cn("size-4", sprintLoading && "animate-spin")} />
                  {sprintLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <label className="relative block w-full lg:max-w-sm">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#8a7d6b]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search key, summary, or status"
                    className="h-11 w-full rounded-xl border border-[#e4d9c8] bg-white pr-3 pl-9 text-sm outline-none focus:border-[#0f5f5a]"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label={`All ${sprint?.issues.length ?? 0}`} />
                  {statusCounts.map(([status, count]) => (
                    <FilterChip
                      key={status}
                      active={statusFilter === status}
                      onClick={() => setStatusFilter(status)}
                      label={`${status} ${count}`}
                    />
                  ))}
                </div>
              </div>

              {sprintLoading ? (
                <p className="mt-4 flex items-center gap-3 rounded-xl bg-[#0f5f5a] px-4 py-3 text-sm font-medium text-white" role="status">
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Loading the active sprint…
                </p>
              ) : null}

              {sprintError ? (
                <p className="mt-4 rounded-lg bg-[#fff1e8] px-3 py-2 text-sm text-[#9a3412]" role="alert">
                  {sprintError}
                </p>
              ) : null}
            </div>

            {visibleIssues.length === 0 && !sprintLoading ? (
              <p className="rounded-3xl border border-dashed border-[#b7c9c4] bg-white/50 px-4 py-10 text-center text-sm text-[#5c5348]">
                No tickets in this view.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {visibleIssues.map((issue) => (
                  <SprintCard
                    key={issue.key}
                    issue={issue}
                    selected={focusTicket?.key === issue.key}
                    copied={copiedKey === issue.key}
                    onCopy={() => copyKey(issue.key)}
                    onUse={() => useTicket(issue.key)}
                  />
                ))}
              </ul>
            )}
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
        </div>
      </main>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function SprintCard({
  issue,
  selected,
  copied,
  onCopy,
  onUse,
}: {
  issue: SprintIssue;
  selected: boolean;
  copied: boolean;
  onCopy: () => void;
  onUse: () => void;
}) {
  return (
    <li
      className={cn(
        "flex flex-col rounded-2xl border bg-[#fffdf8] p-4 shadow-[0_8px_20px_rgba(28,25,21,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,95,90,0.1)]",
        selected ? "border-[#0f5f5a] ring-2 ring-[#0f5f5a]/20" : "border-[#e4d9c8]",
      )}
    >
      <button type="button" className="min-w-0 text-left" onClick={onUse}>
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold text-[#0f5f5a]">{issue.key}</span>
          <span className="rounded-full bg-[#e7f3f1] px-2 py-0.5 text-[11px] font-medium text-[#0f5f5a]">
            {issue.issueType}
          </span>
        </span>
        <span className="mt-2 block text-sm leading-5 font-medium">{issue.summary}</span>
        <span className="mt-3 inline-flex rounded-full bg-[#f3efe6] px-2.5 py-1 text-xs text-[#5c5348]">{issue.status}</span>
      </button>
      <span className="mt-4 flex gap-2">
        <button
          type="button"
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-[#d9cdb8] bg-white text-sm hover:bg-[#f7f1e6]"
          onClick={onCopy}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy key"}
        </button>
        <button
          type="button"
          className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-[#0f5f5a] text-sm text-white hover:bg-[#0c4c48]"
          onClick={onUse}
        >
          Use ticket
        </button>
      </span>
    </li>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
        active ? "bg-[#0f5f5a] text-white shadow-sm" : "border border-white/80 bg-white/70 text-[#3d534f] hover:bg-white",
      )}
    >
      {label}
      {count !== undefined ? (
        <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-[#e7f3f1] text-[#0f5f5a]")}>{count}</span>
      ) : null}
    </button>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium",
        active ? "bg-[#1c1915] text-[#f3efe6]" : "bg-white text-[#5c5348] ring-1 ring-[#e4d9c8] hover:ring-[#0f5f5a]",
      )}
    >
      {label}
    </button>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "P";
}

function formatRange(start: string, end: string | null): string {
  return end ? `${prettyDate(start)} to ${prettyDate(end)}` : prettyDate(start);
}

function prettyDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]}`;
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
