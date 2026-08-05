"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

// ── Types (mirror lib/usage.ts) ─────────────────────────────────────────────

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
  calls: number;
}

interface UsageDaySummary extends UsageTotals {
  day: string;
}

interface UsageModelSummary extends UsageTotals {
  provider: string;
  model: string;
}

interface UsageSummaryResponse {
  today: UsageTotals;
  last7Days: UsageTotals;
  last30Days: UsageTotals;
  allTime: UsageTotals;
  daily: UsageDaySummary[];
  byModel: UsageModelSummary[];
  storeRecords: number;
  scannedFiles: number;
  scannedAt: number | null;
}

interface UsageRecord {
  id: string;
  sessionFile: string;
  entryId: string;
  timestamp: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  cost: number;
}

interface UsageDetailResponse {
  day: string;
  records: UsageRecord[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const INPUT_COLOR = "rgba(129,140,248,0.85)"; // indigo
const OUTPUT_COLOR = "rgba(52,211,153,0.85)"; // emerald
const CACHE_COLOR = "rgba(251,191,36,0.85)"; // amber

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(day: string, locale: string): string {
  const d = new Date(`${day}T00:00:00`);
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "numeric",
    day: "numeric",
  }).format(d);
}

function shortModel(model: string): string {
  return model.length > 26 ? `${model.slice(0, 24)}…` : model;
}

// ── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, totals }: { label: string; totals: UsageTotals }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
      }}
    >
      <div style={{ color: "var(--text-dim)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        {fmtTokens(totals.total)}
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {fmtCost(totals.cost)} · {totals.calls} <span style={{ color: "var(--text-dim)" }}>calls</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function UsageStats() {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
  const [detail, setDetail] = useState<UsageDetailResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<UsageSummaryResponse | null>(null);

  const loadSummary = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/usage/summary?days=30${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as UsageSummaryResponse;
      summaryRef.current = data;
      setSummary(data);
      setError(null);
      setSelectedDay((prev) => prev ?? data.daily[data.daily.length - 1]?.day ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + light polling while the dialog is open (live updates).
  useEffect(() => {
    void loadSummary();
    const timer = window.setInterval(() => void loadSummary(false), 5000);
    return () => window.clearInterval(timer);
  }, [loadSummary]);

  // Load per-day detail when the selected day changes.
  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    fetch(`/api/usage/detail?day=${encodeURIComponent(selectedDay)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() as Promise<UsageDetailResponse> : null))
      .then((data) => { if (!cancelled && data) setDetail(data); })
      .catch(() => { /* keep previous detail on transient errors */ });
    return () => { cancelled = true; };
  }, [selectedDay]);

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      await loadSummary(true);
    } finally {
      setRescanning(false);
    }
  }, [loadSummary]);

  const maxDaily = useMemo(
    () => Math.max(1, ...(summary?.daily.map((d) => d.total) ?? [1])),
    [summary],
  );

  const stats = summary ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && (
        <div style={{ fontSize: 11.5, color: "var(--danger)", padding: "6px 8px", background: "color-mix(in srgb, var(--danger) 8%, var(--bg-panel))", borderRadius: 6 }}>
          {error}
        </div>
      )}

      {loading && !stats ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "16px 0", textAlign: "center" }}>
          {t("usage.loading")}
        </div>
      ) : stats ? (
        <>
          {/* Stat cards */}
          <div style={{ display: "flex", gap: 6 }}>
            <StatCard label={t("usage.today")} totals={stats.today} />
            <StatCard label={t("usage.last7")} totals={stats.last7Days} />
            <StatCard label={t("usage.last30")} totals={stats.last30Days} />
            <StatCard label={t("usage.allTime")} totals={stats.allTime} />
          </div>

          {/* Daily bar chart */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
                {t("usage.dailyUsage")}
              </span>
              <span style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--text-dim)", alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: INPUT_COLOR, display: "inline-block" }} />
                  {t("usage.input")}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: OUTPUT_COLOR, display: "inline-block" }} />
                  {t("usage.output")}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: CACHE_COLOR, display: "inline-block" }} />
                  {t("usage.cache")}
                </span>
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 2,
                height: 88,
                padding: "6px 4px 0",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              {stats.daily.map((d) => {
                const h = Math.max(d.total > 0 ? 14 : 2, (d.total / maxDaily) * 78);
                const selected = d.day === selectedDay;
                return (
                  <div
                    key={d.day}
                    title={`${d.day}\n${fmtTokens(d.total)} tokens\n${fmtCost(d.cost)}`}
                    onClick={() => setSelectedDay(d.day)}
                    onMouseEnter={() => setHoverDay(d.day)}
                    onMouseLeave={() => setHoverDay(null)}
                    style={{
                      flex: 1,
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      cursor: d.total > 0 ? "pointer" : "default",
                      position: "relative",
                    }}
                  >
                  <div
                    style={{
                      height: h,
                      borderRadius: 3,
                        background: d.total > 0
                          ? `linear-gradient(to top, ${INPUT_COLOR} 0%, ${INPUT_COLOR} ${d.input / Math.max(1, d.total) * 100}%, ${OUTPUT_COLOR} ${d.input / Math.max(1, d.total) * 100}%)`
                          : "var(--border)",
                        opacity: selected ? 1 : 0.72,
                        outline: selected ? `1.5px solid var(--accent)` : "none",
                        outlineOffset: -1,
                        transition: "opacity 0.15s ease",
                      }}
                    />
                    {(hoverDay === d.day || selected) && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "100%",
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "5px 8px",
                          fontSize: 10,
                          color: "var(--text)",
                          whiteSpace: "nowrap",
                          zIndex: 10,
                          boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
                          pointerEvents: "none",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{dayLabel(d.day, locale)}</div>
                        <div>{fmtTokens(d.total)} tokens · {fmtCost(d.cost)}</div>
                        <div style={{ color: "var(--text-muted)" }}>
                          {fmtTokens(d.input)} in · {fmtTokens(d.output)} out · {d.calls} calls
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, color: "var(--text-dim)", fontSize: 9.5 }}>
              <span>{stats.daily.length ? dayLabel(stats.daily[0].day, locale) : ""}</span>
              <span>{stats.daily.length ? dayLabel(stats.daily[stats.daily.length - 1].day, locale) : ""}</span>
            </div>
          </div>

          {/* Day detail */}
          {selectedDay && detail && (
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", marginBottom: 6 }}>
                {t("usage.sessionDetail")} · {dayLabel(selectedDay, locale)}
              </div>
              {detail.records.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 11, padding: "8px 0" }}>{t("usage.noData")}</div>
              ) : (
                <div style={{ maxHeight: 190, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)" }}>
                  {detail.records.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{fmtTime(r.timestamp)}</span>
                      <span
                        style={{
                          color: "var(--text)",
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`${r.provider}/${r.model} · ${r.sessionFile}`}
                      >
                        {shortModel(r.model)}
                      </span>
                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                        {fmtTokens(r.totalTokens)} <span style={{ color: "var(--text-dim)" }}>tok</span>
                      </span>
                      <span style={{ color: "var(--text-dim)", flexShrink: 0, width: 58, textAlign: "right" }}>
                        {fmtCost(r.cost)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Model breakdown */}
          {stats.byModel.length > 0 && (
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", marginBottom: 6 }}>
                {t("usage.modelBreakdown")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {stats.byModel.map((m) => {
                  const pct = Math.max(2, (m.total / Math.max(1, stats.byModel[0].total)) * 100);
                  return (
                    <div key={`${m.provider}::${m.model}`}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}>
                        <span
                          style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}
                          title={`${m.provider}/${m.model}`}
                        >
                          {shortModel(m.model)}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                          {fmtTokens(m.total)} · {fmtCost(m.cost)}
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: "color-mix(in srgb, var(--accent) 70%, transparent)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
              {stats.storeRecords} rec{stats.scannedAt ? ` · ${t("usage.scannedAt")} ${fmtTime(new Date(stats.scannedAt).toISOString())}` : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => void loadSummary(false)}
                style={buttonStyle(false)}
              >
                {t("usage.refresh")}
              </button>
              <button
                type="button"
                disabled={rescanning}
                onClick={() => void handleRescan()}
                style={buttonStyle(rescanning)}
              >
                {rescanning ? t("usage.rescanning") : t("usage.rescan")}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "16px 0", textAlign: "center" }}>
          {t("usage.noData")}
        </div>
      )}
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid var(--border)",
    background: "var(--bg-panel)",
    color: "var(--text-muted)",
    borderRadius: 6,
    padding: "5px 12px",
    fontSize: 11.5,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}
