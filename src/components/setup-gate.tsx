"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { stashFlash, ToastStack, useToasts, type ToastItem } from "@/components/toast-stack";
import { loadAccount, saveAccount, type StoredAccount } from "@/lib/browser-account";

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@pactap\.com$/i;
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function SetupGate() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const { toasts, notify, dismiss } = useToasts();

  useEffect(() => {
    const account = loadAccount();
    if (account) {
      router.replace("/dashboard");
      return;
    }
    setReady(true);
  }, [router]);

  return (
    <>
      {!ready ? (
        <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16">
          <p className="text-sm text-[#5c5348]">Opening the automation tool…</p>
        </main>
      ) : (
        <SetupScreen
          onUnlocked={() => notify("Password accepted. Connect your Jira account next.", "ok")}
          onConnected={(next) => {
            saveAccount(next);
            stashFlash(`Jira account saved for ${next.displayName}.`, "ok");
            router.push("/dashboard");
          }}
          onNotify={notify}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function SetupScreen({
  onUnlocked,
  onConnected,
  onNotify,
}: {
  onUnlocked: () => void;
  onConnected: (account: StoredAccount) => void;
  onNotify: (text: string, tone: ToastItem["tone"]) => void;
}) {
  const [step, setStep] = useState<"password" | "account">("password");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (step === "password") {
      setPending(true);
      try {
        const response = await fetch("/api/setup/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const payload = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !payload.success) {
          setError(payload.error ?? "That password does not match.");
          return;
        }
        setPassword("");
        onUnlocked();
        setStep("account");
      } catch {
        setError("The browser could not reach this app.");
      } finally {
        setPending(false);
      }
      return;
    }

    const emailError = validateEmail(email);
    const tokenError = validateToken(apiToken);
    if (emailError || tokenError) {
      setError(emailError ?? tokenError);
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/jira/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), apiToken: apiToken.trim() }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        displayName?: string;
        error?: string;
      };
      if (!response.ok || !payload.success || !payload.displayName) {
        const message = payload.error ?? "Jira did not accept this account.";
        setError(message);
        onNotify(message, "bad");
        return;
      }
      onConnected({
        email: email.trim(),
        apiToken: apiToken.trim(),
        displayName: payload.displayName,
      });
    } catch {
      const message = "The browser could not reach this app.";
      setError(message);
      onNotify(message, "bad");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
      <div className="grid overflow-hidden rounded-3xl border border-[#e4d9c8] bg-[#fffdf8] shadow-[0_16px_50px_rgba(28,25,21,0.06)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="bg-[#143f3c] px-6 py-8 text-[#f3faf8]">
          <p className="font-mono text-xs tracking-[0.16em] uppercase text-[#b7ddd6]">Pactap</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Jira automation</h1>
          <p className="mt-3 text-sm leading-6 text-[#d5ece7]">
            Sign in on this browser, then move tickets and log time for your own Jira account.
          </p>
          <ol className="mt-8 space-y-3 text-sm">
            <li className={step === "password" ? "font-semibold" : "text-[#b7ddd6]"}>1. Unlock the tool</li>
            <li className={step === "account" ? "font-semibold" : "text-[#b7ddd6]"}>2. Connect Jira</li>
          </ol>
        </aside>
        <form className="px-6 py-8 sm:px-8" onSubmit={submit}>
          {step === "password" ? (
            <>
              <h2 className="text-xl font-semibold">Unlock</h2>
              <p className="mt-2 text-sm leading-6 text-[#5c5348]">
                Enter the shared password to open the tool. Each person then connects their own Jira account.
              </p>
              <label className="mt-6 block">
                <span className="mb-1 block text-xs font-medium tracking-wide text-[#5c5348] uppercase">
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="h-11 w-full rounded-xl border border-[#e4d9c8] bg-white px-3 text-sm outline-none focus:border-[#0f5f5a]"
                />
              </label>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Connect your Jira account</h2>
              <p className="mt-2 text-sm leading-6 text-[#5c5348]">
                Use your @pactap.com email and an Atlassian API token. Jira is checked before the account is saved
                in this browser.
              </p>
              <label className="mt-6 block">
                <span className="mb-1 block text-xs font-medium tracking-wide text-[#5c5348] uppercase">
                  Jira email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  placeholder="name@pactap.com"
                  className="h-11 w-full rounded-xl border border-[#e4d9c8] bg-white px-3 text-sm outline-none focus:border-[#0f5f5a]"
                />
              </label>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-medium tracking-wide text-[#5c5348] uppercase">
                  API token
                </span>
                <div className="flex gap-2">
                  <input
                    type={showToken ? "text" : "password"}
                    value={apiToken}
                    onChange={(event) => setApiToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-11 min-w-0 flex-1 rounded-xl border border-[#e4d9c8] bg-white px-3 text-sm outline-none focus:border-[#0f5f5a]"
                  />
                  <button
                    type="button"
                    className="inline-flex h-11 items-center rounded-full border border-[#d9cdb8] px-4 text-sm"
                    onClick={() => setShowToken((current) => !current)}
                  >
                    {showToken ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <p className="mt-3 text-xs leading-5 text-[#8a7d6b]">
                Create a token at  {" "}
                <a className="text-blue-500 underline font-medium" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">Click here</a>. A website session token will
                not work.
              </p>
            </>
          )}

          {error ? (
            <p className="mt-4 rounded-lg bg-[#fff1e8] px-3 py-2 text-sm text-[#9a3412]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {step === "account" ? (
              <button
                type="button"
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#d9cdb8] bg-white px-5 text-sm font-medium"
                onClick={() => {
                  setStep("password");
                  setError(null);
                }}
                disabled={pending}
              >
                Back
              </button>
            ) : null}
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#0f5f5a] px-5 text-sm font-medium text-[#f7fffc] hover:bg-[#0c4c48]"
              disabled={pending}
            >
              {pending ? (step === "password" ? "Checking…" : "Checking Jira…") : step === "password" ? "Continue" : "Check and save"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function validateEmail(email: string): string | null {
  if (!email.trim()) return "Enter your Pactap email.";
  if (!EMAIL_PATTERN.test(email.trim())) return "Use an email ending in @pactap.com.";
  return null;
}

function validateToken(token: string): string | null {
  const value = token.trim();
  if (!value) return "Paste the Jira API token.";
  if (/\s/.test(value)) return "The API token cannot contain spaces.";
  if (JWT_PATTERN.test(value)) {
    return "This looks like a browser session token. Create an API token at id.atlassian.com.";
  }
  if (value.length < 16) return "This API token looks too short.";
  return null;
}
