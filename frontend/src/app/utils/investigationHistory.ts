/** Cached investigation results — localStorage, per browser. */

export type InvestigationHistoryParams = {
  question: string;
  owner: string;
  repo: string;
  org: string;
  slack_channel: string;
  policy_query: string;
  package_system: string;
  package_ecosystem: string;
  package_name: string;
  package_version: string;
};

export type InvestigationHistoryEntry = {
  id: string;
  createdAt: number;
  params: InvestigationHistoryParams;
  result: Record<string, unknown>;
  risk_level?: string;
  score?: number;
  findingsCount: number;
};

const STORAGE_KEY = "harborguard_investigation_history";
const MAX_ENTRIES = 25;

function readHistory(): InvestigationHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InvestigationHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: InvestigationHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export function loadInvestigationHistory(): InvestigationHistoryEntry[] {
  return readHistory().sort((a, b) => b.createdAt - a.createdAt);
}

export function getInvestigationById(id: string): InvestigationHistoryEntry | null {
  return readHistory().find(entry => entry.id === id) ?? null;
}

export function saveInvestigationToHistory(
  params: InvestigationHistoryParams,
  result: Record<string, unknown>,
): string {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const entry: InvestigationHistoryEntry = {
    id,
    createdAt: Date.now(),
    params,
    result,
    risk_level: typeof result.risk_level === "string" ? result.risk_level : undefined,
    score: typeof result.score === "number" ? result.score : undefined,
    findingsCount: Array.isArray(result.findings) ? result.findings.length : 0,
  };

  const existing = readHistory();
  writeHistory([entry, ...existing]);
  return id;
}

export function removeInvestigationFromHistory(id: string): void {
  writeHistory(readHistory().filter(entry => entry.id !== id));
}

export function historyParamsToSearchParams(params: InvestigationHistoryParams, historyId: string): URLSearchParams {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) sp.set(key, value);
  });
  sp.set("history", historyId);
  return sp;
}

export function formatHistoryWhen(createdAt: number): string {
  const date = new Date(createdAt);
  const now = Date.now();
  const diffMs = now - createdAt;
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
