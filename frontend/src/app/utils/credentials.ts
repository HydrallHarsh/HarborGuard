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

export type SourceStatus = {
  available?: boolean;
  configured?: boolean;
  optional?: boolean;
  required_for_investigation?: boolean;
  missing_inputs?: string[];
};

export type CapabilitiesPayload = {
  sources?: CapabilitiesSources;
  summary?: { missing_for_investigation?: string[] };
};

export type CapabilitiesSources = Record<string, SourceStatus>;

export type LlmPlannerStatus = {
  enabled?: boolean;
  configured?: boolean;
  model?: string | null;
  source?: "user" | "server" | "off";
};

export const GITHUB_REQUIRED_MESSAGE =
  "GitHub token required — run `coral source add github` with GITHUB_TOKEN to read repos.";

export const SOURCES_REQUIRED_MESSAGE =
  "Connect sources first — GitHub token is required. Slack and Notion are optional.";

export const GITHUB_CONNECT_MESSAGE =
  "Paste a GitHub token and click Connect Sources before investigating.";

export const TOKEN_SOURCE_KEYS = ["github_token", "notion_api_key", "slack_token"] as const;

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
const SOURCES_CONNECTED_AT_KEY = "harborguard_sources_connected_at";
const CAPABILITIES_CACHE_KEY = "harborguard_capabilities_cache";

/** Use cached source status on home — avoid re-running Coral connect every visit. */
const CAPABILITIES_CACHE_TTL_MS = 15 * 60 * 1000;
/** After a successful Connect, skip auto-reconnect for this long unless user clicks Connect again. */
const SOURCES_AUTO_RECONNECT_COOLDOWN_MS = 30 * 60 * 1000;

type CapabilitiesCacheEntry = {
  at: number;
  fingerprint: string;
  payload: CapabilitiesResponse;
};

function credentialsFingerprint(credentials: SourceCredentials): string {
  const parts = [
    credentials.github_token ?? "",
    credentials.notion_api_key ?? "",
    credentials.slack_token ?? "",
  ];
  return parts.map(p => (p ? "1" : "0")).join("");
}

export function loadSourcesConnectedAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SOURCES_CONNECTED_AT_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function loadCapabilitiesCache(
  credentials: SourceCredentials = loadSourceCredentials(),
): CapabilitiesResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CAPABILITIES_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CapabilitiesCacheEntry;
    if (!entry?.payload || entry.fingerprint !== credentialsFingerprint(credentials)) {
      return null;
    }
    if (Date.now() - entry.at > CAPABILITIES_CACHE_TTL_MS) {
      return null;
    }
    return entry.payload;
  } catch {
    return null;
  }
}

export function saveCapabilitiesCache(
  credentials: SourceCredentials,
  payload: CapabilitiesResponse,
): void {
  if (typeof window === "undefined") return;
  const entry: CapabilitiesCacheEntry = {
    at: Date.now(),
    fingerprint: credentialsFingerprint(credentials),
    payload,
  };
  localStorage.setItem(CAPABILITIES_CACHE_KEY, JSON.stringify(entry));
}

export function clearCapabilitiesCache(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CAPABILITIES_CACHE_KEY);
}

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

export function hasGitHubToken(credentials: SourceCredentials): boolean {
  return Boolean(credentials.github_token?.trim());
}

export function hasAllSourceTokens(credentials: SourceCredentials): boolean {
  return hasGitHubToken(credentials);
}

export function isGitHubReady(
  sources: CapabilitiesSources,
  credentials: SourceCredentials = loadSourceCredentials(),
): boolean {
  if (credentials.github_token?.trim()) {
    return Boolean(sources.github?.available && sources.github?.configured);
  }
  return Boolean(sources.github?.configured && sources.github?.available);
}

export function areCommunitySourcesAvailable(sources: CapabilitiesSources): boolean {
  return Boolean(sources.osv?.available) && Boolean(sources.deps_dev?.available);
}

/** GitHub + osv + deps_dev — Slack/Notion optional. */
export function areSourcesReady(
  sources: CapabilitiesSources,
  _credentials: SourceCredentials = loadSourceCredentials(),
): boolean {
  return isGitHubReady(sources, _credentials) && areCommunitySourcesAvailable(sources);
}

export function markSourcesConnected(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SOURCES_CONNECTED_AT_KEY, String(Date.now()));
}

export function clearSourcesConnectedMark(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SOURCES_CONNECTED_AT_KEY);
  clearCapabilitiesCache();
}

function sourcesRecentlyConnected(): boolean {
  const at = loadSourcesConnectedAt();
  if (!at) return false;
  return Date.now() - at < SOURCES_AUTO_RECONNECT_COOLDOWN_MS;
}

/** Fast path for home: use cache when valid; only hit API or reconnect when needed. */
export async function restoreSourceConnection(
  apiBase: string,
  credentials: SourceCredentials = loadSourceCredentials(),
): Promise<CapabilitiesResponse | null> {
  const base = normalizeApiBase(apiBase);
  const cached = loadCapabilitiesCache(credentials);
  const cachedSources = cached?.capabilities?.sources ?? {};

  if (cached && areSourcesReady(cachedSources, credentials)) {
    return cached;
  }

  async function fetchCapabilitiesPayload(): Promise<CapabilitiesResponse | null> {
    try {
      const response = await fetchCapabilities(base, credentials);
      if (!response.ok) return null;
      const payload = (await response.json()) as CapabilitiesResponse;
      saveCapabilitiesCache(credentials, payload);
      const sources = payload?.capabilities?.sources ?? {};
      if (areSourcesReady(sources, credentials)) {
        markSourcesConnected();
      }
      return payload;
    } catch {
      return null;
    }
  }

  const current = await fetchCapabilitiesPayload();
  if (current && areSourcesReady(current.capabilities?.sources ?? {}, credentials)) {
    return current;
  }

  if (!hasGitHubToken(credentials)) {
    return current ?? cached;
  }

  if (sourcesRecentlyConnected() && current) {
    return current;
  }

  const connect = await connectSources(base, credentials);
  if (connect.ok) {
    if (connect.ready) markSourcesConnected();
    saveCapabilitiesCache(credentials, connect.capabilities);
    return connect.capabilities;
  }
  return current ?? cached;
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

export async function connectSources(
  apiBase: string,
  credentials: SourceCredentials = loadSourceCredentials(),
): Promise<
  | {
      ok: true;
      ready: boolean;
      missing: string[];
      capabilities: CapabilitiesResponse;
    }
  | { ok: false; message: string }
> {
  if (!hasGitHubToken(credentials)) {
    return { ok: false, message: GITHUB_CONNECT_MESSAGE };
  }
  const base = normalizeApiBase(apiBase);
  try {
    const response = await fetch(apiUrl("/agent/sources/connect", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentialsPayload(credentials)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail?.message ?? `Source connect failed (${response.status})`;
      return { ok: false, message };
    }
    if (data.ready) markSourcesConnected();
    const capabilities: CapabilitiesResponse = {
      capabilities: data.capabilities,
      required_sources: data.required_sources,
      optional_sources: data.optional_sources,
    };
    saveCapabilitiesCache(credentials, capabilities);
    return {
      ok: true,
      ready: Boolean(data.ready),
      missing: Array.isArray(data.missing_sources) ? data.missing_sources : [],
      capabilities,
    };
  } catch {
    return { ok: false, message: "Could not reach the API to connect Coral sources." };
  }
}

export async function ensureSourcesReady(
  apiBase: string,
  credentials: SourceCredentials = loadSourceCredentials(),
): Promise<
  | { ok: true; sources: CapabilitiesSources }
  | { ok: false; message: string }
> {
  const cached = loadCapabilitiesCache(credentials);
  if (cached && areSourcesReady(cached.capabilities?.sources ?? {}, credentials)) {
    return { ok: true, sources: cached.capabilities?.sources ?? {} };
  }

  const restored = await restoreSourceConnection(apiBase, credentials);
  if (restored && areSourcesReady(restored.capabilities?.sources ?? {}, credentials)) {
    return { ok: true, sources: restored.capabilities?.sources ?? {} };
  }

  return {
    ok: false,
    message:
      "Sources not ready. Go home, click Connect Sources, then try again.",
  };
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
  capabilities?: { sources?: CapabilitiesSources; summary?: { missing_for_investigation?: string[] } };
  required_sources?: string[];
  optional_sources?: string[];
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
