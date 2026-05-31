import { apiUrl, normalizeApiBase } from "./api";

/** Per-user tokens and LLM settings — kept in localStorage, never URL query params. */

export type SourceCredentials = {
  github_token?: string;
  notion_api_key?: string;
  slack_token?: string;
  openrouter_api_key?: string;
  openrouter_model?: string;
  use_llm_planner?: boolean;
};

export type SourceStatus = { available?: boolean; configured?: boolean; missing_inputs?: string[] };

export type CapabilitiesSources = Record<string, SourceStatus>;

export type LlmPlannerStatus = {
  enabled?: boolean;
  configured?: boolean;
  model?: string | null;
  source?: "user" | "server" | "off";
};

export const GITHUB_REQUIRED_MESSAGE =
  "GitHub token required — Coral needs GITHUB_TOKEN to read repos (PRs, commits, code search). " +
  "Paste your PAT above, or use a deployment where the server already has GITHUB_TOKEN set.";

export const OPENROUTER_KEY_PLACEHOLDER = "sk-or-v1-…";
export const OPENROUTER_MODEL_PLACEHOLDER = "provider/model:variant";

export const RECOMMENDED_OPENROUTER_MODELS = [
  {
    id: "openai/gpt-oss-120b:free",
    label: "Recommended",
    note: "Free — good for investigation planning",
  },
  {
    id: "qwen/qwen3-235b-a22b:free",
    label: "Recommended",
    note: "Free alternative",
  },
] as const;

const STORAGE_KEY = "harborguard_source_credentials";
const LEGACY_SESSION_KEY = STORAGE_KEY;

function readStorage(store: Storage): SourceCredentials {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SourceCredentials;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(store: Storage, credentials: SourceCredentials): void {
  const trimmed: SourceCredentials = {};
  if (credentials.github_token?.trim()) trimmed.github_token = credentials.github_token.trim();
  if (credentials.notion_api_key?.trim()) trimmed.notion_api_key = credentials.notion_api_key.trim();
  if (credentials.slack_token?.trim()) trimmed.slack_token = credentials.slack_token.trim();
  if (credentials.openrouter_api_key?.trim()) {
    trimmed.openrouter_api_key = credentials.openrouter_api_key.trim();
  }
  if (credentials.openrouter_model?.trim()) {
    trimmed.openrouter_model = credentials.openrouter_model.trim();
  }
  if (credentials.use_llm_planner === true) {
    trimmed.use_llm_planner = true;
  }
  if (Object.keys(trimmed).length === 0) {
    store.removeItem(STORAGE_KEY);
  } else {
    store.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  }
}

export function loadSourceCredentials(): SourceCredentials {
  if (typeof window === "undefined") return {};

  const local = readStorage(localStorage);
  if (Object.keys(local).length > 0) return local;

  const session = readStorage(sessionStorage);
  if (Object.keys(session).length > 0) {
    writeStorage(localStorage, session);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    return session;
  }

  return {};
}

export function saveSourceCredentials(credentials: SourceCredentials): void {
  if (typeof window === "undefined") return;
  writeStorage(localStorage, credentials);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
}

export function credentialsPayload(credentials: SourceCredentials) {
  const body: Record<string, string | boolean> = {};
  if (credentials.github_token) body.github_token = credentials.github_token;
  if (credentials.notion_api_key) body.notion_api_key = credentials.notion_api_key;
  if (credentials.slack_token) body.slack_token = credentials.slack_token;
  if (credentials.openrouter_api_key) body.openrouter_api_key = credentials.openrouter_api_key;
  if (credentials.openrouter_model) body.openrouter_model = credentials.openrouter_model;
  if (credentials.use_llm_planner === true) body.use_llm_planner = true;
  if (credentials.use_llm_planner === false) body.use_llm_planner = false;
  return body;
}

export function hasAnyCredentials(credentials: SourceCredentials): boolean {
  return Boolean(
    credentials.github_token ||
      credentials.notion_api_key ||
      credentials.slack_token ||
      credentials.openrouter_api_key ||
      credentials.openrouter_model ||
      credentials.use_llm_planner,
  );
}

export function isGitHubReady(
  sources: CapabilitiesSources,
  credentials: SourceCredentials = loadSourceCredentials(),
): boolean {
  if (credentials.github_token?.trim()) return true;
  return Boolean(sources.github?.configured);
}

export function isLlmPlannerReady(
  llmStatus: LlmPlannerStatus | undefined,
  credentials: SourceCredentials = loadSourceCredentials(),
): boolean {
  if (!credentials.use_llm_planner) return true;
  if (credentials.openrouter_api_key?.trim() && credentials.openrouter_model?.trim()) return true;
  if (llmStatus?.configured) return true;
  return false;
}

export async function ensureGitHubReady(
  apiBase: string,
  credentials: SourceCredentials = loadSourceCredentials(),
): Promise<{ ok: true; sources: CapabilitiesSources } | { ok: false; message: string }> {
  const base = normalizeApiBase(apiBase);
  if (credentials.github_token?.trim()) {
    return { ok: true, sources: {} };
  }
  try {
    const response = await fetchCapabilities(base, credentials);
    if (!response.ok) {
      return { ok: false, message: `Could not verify GitHub access (${response.status}).` };
    }
    const payload = await response.json();
    const sources = (payload?.capabilities?.sources ?? {}) as CapabilitiesSources;
    if (sources.github?.configured) {
      return { ok: true, sources };
    }
    return { ok: false, message: GITHUB_REQUIRED_MESSAGE };
  } catch {
    return { ok: false, message: "Could not reach the API to verify GitHub credentials." };
  }
}

export async function fetchCapabilities(
  apiBase: string,
  credentials: SourceCredentials,
): Promise<Response> {
  const url = apiUrl("/agent/capabilities", apiBase);
  if (hasAnyCredentials(credentials)) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentialsPayload(credentials)),
    });
  }
  return fetch(url);
}

export type CapabilitiesResponse = {
  capabilities?: { sources?: CapabilitiesSources };
  llm_planner?: LlmPlannerStatus;
};

export async function fetchCapabilitiesJson(
  apiBase: string,
  credentials: SourceCredentials = loadSourceCredentials(),
): Promise<CapabilitiesResponse> {
  const response = await fetchCapabilities(apiBase, credentials);
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}
