export type StoredAccount = {
  email: string;
  apiToken: string;
  displayName: string;
};

const STORAGE_KEY = "pactap.jira.account";

export function loadAccount(): StoredAccount | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccount>;
    if (!parsed.email || !parsed.apiToken || !parsed.displayName) return null;
    return {
      email: parsed.email,
      apiToken: parsed.apiToken,
      displayName: parsed.displayName,
    };
  } catch {
    return null;
  }
}

export function saveAccount(account: StoredAccount): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

export function clearAccount(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function accountHeaders(account: StoredAccount): Record<string, string> {
  return {
    "x-jira-email": account.email,
    "x-jira-api-token": account.apiToken,
  };
}
