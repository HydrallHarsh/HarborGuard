"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { getApiBase } from "./utils/api";
import {
  areSourcesReady,
  connectSources,
  fetchCapabilities,
  GITHUB_CONNECT_MESSAGE,
  hasGitHubToken,
  loadCapabilitiesCache,
  loadSourceCredentials,
  markSourcesConnected,
  OPENROUTER_KEY_PLACEHOLDER,
  OPENROUTER_MODEL_PLACEHOLDER,
  RECOMMENDED_OPENROUTER_MODELS,
  restoreSourceConnection,
  saveCapabilitiesCache,
  saveSourceCredentials,
  SOURCES_REQUIRED_MESSAGE,
  type CapabilitiesResponse,
  type SourceCredentials,
} from "./utils/credentials";
import {
  formatHistoryWhen,
  historyParamsToSearchParams,
  loadInvestigationHistory,
  removeInvestigationFromHistory,
  type InvestigationHistoryEntry,
} from "./utils/investigationHistory";
import {
  DEMO_REPO,
  KONAMI_CODE,
  KONAMI_MESSAGE,
  MODE_META,
  TAGLINE_ROTATION,
  TITLE_EASTER_EGG_MESSAGES,
  detectMode,
  pickRandom,
  type InvestigationMode,
} from "./utils/flavor";

type SourceCapabilities = {
  available?: boolean;
  configured?: boolean;
  optional?: boolean;
  tools?: string[];
};

type InvestigationForm = {
  question: string; owner: string; repo: string; org: string; slack_channel: string;
  policy_query: string; package_system: string; package_ecosystem: string;
  package_name: string; package_version: string;
};

const initialForm: InvestigationForm = {
  question: "Did dependency upgrades introduce risk and require policy review?",
  owner: "withcoral", repo: "coral", org: "withcoral", slack_channel: "",
  policy_query: "dependency security policy",
  package_system: "", package_ecosystem: "", package_name: "", package_version: "",
};

const CASE_PRESETS = [
  { id: "dep", label: "Dependency Risk", desc: "Audit upgrades for CVEs & supply chain threats", question: "Did dependency upgrades introduce risk and require policy review?" },
  { id: "policy", label: "Policy Violation", desc: "Check changes against org security policies", question: "Are there any security policy violations in recent code changes?" },
  { id: "secrets", label: "Secrets Exposure", desc: "Scan for leaked credentials & API keys", question: "Have any secrets or credentials been exposed in recent commits?" },
  { id: "release", label: "Release Safety", desc: "Validate release readiness & risk posture", question: "Is the latest release safe to deploy to production?" },
];

export default function Home() {
  const router = useRouter();
  const [form, setForm] = useState<InvestigationForm>(initialForm);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagline, setTagline] = useState(TAGLINE_ROTATION[0]);
  const [titleClicks, setTitleClicks] = useState(0);
  const [easterEgg, setEasterEgg] = useState<string | null>(null);
  const [konamiIdx, setKonamiIdx] = useState(0);
  const [credentials, setCredentials] = useState<SourceCredentials>({});
  const [selectedCaseId, setSelectedCaseId] = useState<InvestigationMode | null>("dep");
  const [connecting, setConnecting] = useState(false);
  const [restoringSources, setRestoringSources] = useState(true);
  const [history, setHistory] = useState<InvestigationHistoryEntry[]>([]);

  const activeMode: InvestigationMode =
    selectedCaseId &&
    CASE_PRESETS.some(p => p.id === selectedCaseId && p.question === form.question)
      ? selectedCaseId
      : detectMode(form.question);
  const modeLabel = activeMode === "general" ? "Custom" : MODE_META[activeMode].label;

  async function refreshCapabilities(creds: SourceCredentials = credentials) {
    try {
      const r = await fetchCapabilities(getApiBase(), creds);
      if (!r.ok) throw new Error(`${r.status}`);
      const payload = (await r.json()) as CapabilitiesResponse;
      setCapabilities(payload);
      saveCapabilitiesCache(creds, payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load capabilities");
    }
  }

  useEffect(() => {
    setHistory(loadInvestigationHistory());
    const saved = loadSourceCredentials();
    setCredentials(saved);

    const cached = loadCapabilitiesCache(saved);
    if (cached) {
      setCapabilities(cached);
      setRestoringSources(false);
      return;
    }

    void (async () => {
      setRestoringSources(true);
      const restored = await restoreSourceConnection(getApiBase(), saved);
      if (restored) setCapabilities(restored);
      else await refreshCapabilities(saved);
      setRestoringSources(false);
    })();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTagline(pickRandom(TAGLINE_ROTATION)), 6000);
    return () => clearInterval(id);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code === KONAMI_CODE[konamiIdx]) {
      const next = konamiIdx + 1;
      if (next === KONAMI_CODE.length) {
        setEasterEgg(KONAMI_MESSAGE);
        setKonamiIdx(0);
      } else {
        setKonamiIdx(next);
      }
    } else {
      setKonamiIdx(e.code === KONAMI_CODE[0] ? 1 : 0);
    }
  }, [konamiIdx]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function handleTitleClick() {
    const next = titleClicks + 1;
    setTitleClicks(next);
    if (next >= 5) {
      setEasterEgg(pickRandom(TITLE_EASTER_EGG_MESSAGES));
      setTitleClicks(0);
    }
  }

  function loadDemoRepo() {
    setForm({
      ...form,
      owner: DEMO_REPO.owner,
      repo: DEMO_REPO.repo,
      org: DEMO_REPO.org,
    });
  }

  function selectCasePreset(preset: (typeof CASE_PRESETS)[number]) {
    setSelectedCaseId(preset.id as InvestigationMode);
    setForm({ ...form, question: preset.question });
  }

  function handleQuestionChange(question: string) {
    const match = CASE_PRESETS.find(p => p.question === question);
    setSelectedCaseId(match ? (match.id as InvestigationMode) : null);
    setForm({ ...form, question });
  }

  const sources = capabilities?.capabilities?.sources ?? {};
  const githubTokenProvided = hasGitHubToken(credentials);
  const sourcesReady = areSourcesReady(sources, credentials);
  const hasOpenRouterConfig = Boolean(
    credentials.openrouter_api_key?.trim() && credentials.openrouter_model?.trim(),
  );
  const canSubmit = form.question.trim() && sourcesReady;

  async function handleConnectSources() {
    if (!githubTokenProvided) {
      setError(GITHUB_CONNECT_MESSAGE);
      return;
    }
    setConnecting(true);
    setError(null);
    saveSourceCredentials(credentials);
    const result = await connectSources(getApiBase(), credentials);
    setConnecting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCapabilities(result.capabilities);
    if (result.ready) markSourcesConnected();
    if (!result.ready) {
      setError(
        `Required sources not ready${result.missing.length ? `: ${result.missing.join(", ")}` : ""}.`,
      );
    }
  }

  function openHistoryEntry(entry: InvestigationHistoryEntry) {
    router.push(`/dashboard?${historyParamsToSearchParams(entry.params, entry.id).toString()}`);
  }

  function deleteHistoryEntry(id: string) {
    removeInvestigationFromHistory(id);
    setHistory(loadInvestigationHistory());
  }

  function startInvestigation(e: FormEvent) {
    e.preventDefault();
    if (!form.question.trim()) return;
    if (!sourcesReady) {
      setError(SOURCES_REQUIRED_MESSAGE);
      return;
    }
    saveSourceCredentials(credentials);

    const params = new URLSearchParams();
    Object.entries(form).forEach(([key, val]) => {
      if (val) params.append(key, val);
    });

    router.push(`/dashboard?${params.toString()}`);
  }

  function updateCredentials(next: SourceCredentials) {
    setCredentials(next);
    saveSourceCredentials(next);
    void refreshCapabilities(next);
  }

  return (
    <motion.div className="briefing"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <div className="bCenter">
        <motion.span className="bEyebrow"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 20 }}>
          Security Intelligence Platform
        </motion.span>
        <motion.h1 className="bTitle bTitleClickable"
          onClick={handleTitleClick}
          title="Click 5 times… if you dare"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 150, damping: 20 }}>
          HarborGuard
        </motion.h1>
        <p className="bSub">{tagline}</p>

        <AnimatePresence>
          {easterEgg && (
            <motion.div
              className="easterEggToast"
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              onClick={() => setEasterEgg(null)}
            >
              {easterEgg}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="caseGrid">
          {CASE_PRESETS.map((p, i) => (
            <motion.button key={p.id}
              className={`caseFile ${selectedCaseId === p.id ? "active" : ""}`}
              onClick={() => selectCasePreset(p)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.06, type: "spring", stiffness: 200, damping: 20 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}>
              <strong>{p.label}</strong>
              <span>{p.desc}</span>
            </motion.button>
          ))}
        </div>

        <button type="button" className="demoRepoBtn" onClick={loadDemoRepo}>
          <span className="demoRepoIcon">⚓</span>
          <span>
            <strong>{DEMO_REPO.label}</strong>
            <em>{DEMO_REPO.desc}</em>
          </span>
        </button>

        {history.length > 0 && (
          <section className="historyPanel">
            <header className="historyPanelHead">
              <h3 className="historyPanelTitle">Recent investigations</h3>
              <span className="historyPanelBadge">Cached locally</span>
            </header>
            <ul className="historyList">
              {history.map(entry => (
                <li key={entry.id} className="historyItem">
                  <button type="button" className="historyItemMain" onClick={() => openHistoryEntry(entry)}>
                    <span className={`historyRisk historyRisk-${entry.risk_level ?? "low"}`}>
                      {(entry.risk_level ?? "low").toUpperCase()} {entry.score ?? 0}
                    </span>
                    <span className="historyItemBody">
                      <strong>{entry.params.owner}/{entry.params.repo}</strong>
                      <em>{entry.params.question}</em>
                    </span>
                    <span className="historyItemMeta">
                      {formatHistoryWhen(entry.createdAt)} · {entry.findingsCount} finding(s)
                    </span>
                  </button>
                  <button
                    type="button"
                    className="historyItemDelete"
                    title="Remove from history"
                    onClick={() => deleteHistoryEntry(entry.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form className="qForm" onSubmit={startInvestigation}>
          <div className="qArea">
            <div className="qAreaHead">
              <span className={`modeChip mode-${activeMode}`}>{modeLabel}</span>
            </div>
            <textarea className="qInput" value={form.question}
              onChange={e => handleQuestionChange(e.target.value)}
              placeholder="Ask a security question..." rows={3} />
          </div>

          <section className={`credPanel ${sourcesReady ? "credPanelReady" : "credPanelNeedsAuth"}`}>
            <header className="credPanelHead">
              <div>
                <h3 className="credPanelTitle">Source credentials</h3>
                <p className="credPanelSub">
                  GitHub required — Slack &amp; Notion optional. Runs <code>coral source add</code> before investigating.
                </p>
              </div>
              <span className="credPanelBadge">Saved locally</span>
            </header>

            {!sourcesReady && (
              <div className="credAlert" role="status">
                <span className="credAlertIcon" aria-hidden>!</span>
                <p>
                  Paste your GitHub token and click Connect Sources. Add Slack/Notion for discussion
                  and policy context — optional for dependency scans.
                </p>
              </div>
            )}

            <div className="credGrid">
              <TFSecret label="GitHub token" required value={credentials.github_token ?? ""}
                set={v => updateCredentials({ ...credentials, github_token: v })}
                ph="ghp_… or fine-grained PAT" />
              <TFSecret label="Notion API key" optional value={credentials.notion_api_key ?? ""}
                set={v => updateCredentials({ ...credentials, notion_api_key: v })}
                ph="ntn_… integration secret" />
              <TFSecret label="Slack token" optional value={credentials.slack_token ?? ""}
                set={v => updateCredentials({ ...credentials, slack_token: v })}
                ph="xoxp-… or xoxb-…" />
            </div>

            <div className="qFormActions">
              <button
                type="button"
                className="qBtn qBtnSecondary"
                disabled={!githubTokenProvided || connecting}
                onClick={() => void handleConnectSources()}
              >
                {connecting ? "Connecting…" : restoringSources ? "Checking sources…" : sourcesReady ? "Sources connected ✓" : "Connect Sources"}
              </button>
            </div>

            <p className="credFootnote">
              osv &amp; deps_dev register automatically. Required to investigate: GitHub + osv + deps_dev.
            </p>
          </section>

          <section className={`credPanel llmPanel ${credentials.use_llm_planner ? "credPanelReady" : ""}`}>
            <header className="credPanelHead">
              <div>
                <h3 className="credPanelTitle">AI planner (OpenRouter)</h3>
                <p className="credPanelSub">
                  Optional smarter planning with OpenRouter. If no key is provided, HarborGuard falls back to deterministic mode.
                </p>
              </div>
              <span className="credPanelBadge credPanelBadgeRec">Recommended</span>
            </header>

            <label className="llmToggle">
              <input
                type="checkbox"
                checked={Boolean(credentials.use_llm_planner)}
                onChange={e =>
                  updateCredentials({ ...credentials, use_llm_planner: e.target.checked })
                }
              />
              <span>Use AI planner (OpenRouter)</span>
            </label>

            {credentials.use_llm_planner && !hasOpenRouterConfig && (
              <div className="credAlert" role="status">
                <span className="credAlertIcon" aria-hidden>i</span>
                <p>
                  AI planner is selected, but no OpenRouter key/model is set.
                  HarborGuard will fall back to deterministic planning.
                </p>
              </div>
            )}

            <div className="credGrid llmGrid">
              <TFSecret
                label="OpenRouter API key"
                optional
                value={credentials.openrouter_api_key ?? ""}
                set={v => updateCredentials({ ...credentials, openrouter_api_key: v })}
                ph={OPENROUTER_KEY_PLACEHOLDER}
              />
              <TF
                label="OpenRouter model"
                value={credentials.openrouter_model ?? ""}
                set={v => updateCredentials({ ...credentials, openrouter_model: v })}
                ph={OPENROUTER_MODEL_PLACEHOLDER}
              />
            </div>

            <div className="recommendedModels">
              <span className="recommendedLabel">Recommended models</span>
              <div className="recommendedChips">
                {RECOMMENDED_OPENROUTER_MODELS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className="recommendedChip"
                    title={m.note}
                    onClick={() =>
                      updateCredentials({ ...credentials, openrouter_model: m.id })
                    }
                  >
                    <strong>{m.id}</strong>
                    <em>{m.note}</em>
                  </button>
                ))}
              </div>
            </div>

            <p className="credFootnote">
              Get a key at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                openrouter.ai/keys
              </a>
              . Model format: <code>provider/model:variant</code> (e.g.{" "}
              <code>openai/gpt-oss-120b:free</code>). Without a key, HarborGuard uses the
              deterministic planner.
            </p>
          </section>

          <section className="repoPanel">
            <header className="credPanelHead">
              <div>
                <h3 className="credPanelTitle">Repository scan inputs</h3>
                <p className="credPanelSub">Target repo for this investigation.</p>
              </div>
              <span className="repoPreview">{form.owner}/{form.repo}</span>
            </header>
            <div className="cfgGrid">
              <TF label="Owner" value={form.owner} set={v => setForm({ ...form, owner: v })} ph="GitHub org or user" />
              <TF label="Repository" value={form.repo} set={v => setForm({ ...form, repo: v })} ph="repo name" />
              <TF label="Slack channel" value={form.slack_channel} set={v => setForm({ ...form, slack_channel: v })} ph="optional — #channel" />
            </div>
            <details className="advancedDrawer">
              <summary className="cfgSummary small cfgSummaryLeft">Advanced package override</summary>
              <div className="cfgGrid advancedGrid">
                <TF label="Package" value={form.package_name} set={v => setForm({ ...form, package_name: v })} ph="auto-detect" />
                <TF label="Version" value={form.package_version} set={v => setForm({ ...form, package_version: v })} ph="auto-detect" />
                <TF label="System" value={form.package_system} set={v => setForm({ ...form, package_system: v })} ph="NPM, PYPI, GO" />
                <TF label="Ecosystem" value={form.package_ecosystem} set={v => setForm({ ...form, package_ecosystem: v })} ph="npm, PyPI, Go" />
              </div>
            </details>
          </section>

          <div className="qFormActions">
            <button type="submit" className="qBtn" disabled={!canSubmit}>
              Begin Investigation →
            </button>
            {!sourcesReady && form.question.trim() && (
              <p className="qFormHint">Connect GitHub (and wait for osv/deps_dev pills) to continue.</p>
            )}

          </div>
        </form>

        <div className="srcPills">
          {Object.entries(sources).map(([n, s]) => (
            <div key={n} className={`srcPill ${s.configured ? "on" : s.available ? "partial" : "off"}`}
              title={
                s.optional
                  ? s.available
                    ? "Optional — connected"
                    : "Optional — not connected"
                  : s.configured
                    ? "Connected"
                    : s.available
                      ? "Available — connect GitHub"
                      : "Unavailable"
              }>
              <span className="srcDot" />
              {n.replace(/_/g, " ")}
              {s.optional ? " (opt)" : ""}
            </div>
          ))}
          {Object.keys(sources).length === 0 && (
            <span className="srcLoading">{restoringSources ? "Restoring sources…" : "Loading sources…"}</span>
          )}
        </div>

        <p className="bFooterHint">Tip: try the demo repo, or click the title five times. We&apos;re not judging.</p>

        {error && <p className="bError">{error}</p>}
      </div>
    </motion.div>
  );
}

function TF({ label, value, set, ph }: { label: string; value: string; set: (v: string) => void; ph?: string }) {
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      <input value={value} placeholder={ph} onChange={e => set(e.target.value)} />
    </label>
  );
}

function TFSecret({
  label,
  value,
  set,
  ph,
  required,
  optional,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  ph?: string;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <label className={`field ${required ? "fieldRequired" : ""}`}>
      <span className="fieldLabel">
        {label}
        {required && <em className="fieldTag fieldTagReq">Required</em>}
        {optional && <em className="fieldTag">Optional</em>}
      </span>
      <input type="password" autoComplete="off" value={value} placeholder={ph} onChange={e => set(e.target.value)} />
    </label>
  );
}
