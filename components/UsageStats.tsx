"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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

function emptyTotals(): UsageTotals {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		total: 0,
		cost: 0,
		calls: 0,
	};
}

function localDayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function fmtTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
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

function shortModel(model: string): string {
	return model.length > 26 ? `${model.slice(0, 24)}…` : model;
}

/** Full date for a YYYY-MM-DD key. */
function dateFromDay(day: string): Date {
	return new Date(`${day}T00:00:00`);
}

// ── Contribution grid (GitHub style) ────────────────────────────────────────

const GRID_WEEKS = 26; // ~6 months

interface GridCell {
	day: string;
	date: Date;
	totals: UsageTotals;
}

interface GridLayout {
	cells: GridCell[];
	weeks: number;
	monthLabels: { index: number; label: string }[];
}

function buildGrid(daily: UsageDaySummary[], locale: string): GridLayout {
	const map = new Map<string, UsageTotals>(daily.map((d) => [d.day, d]));
	const now = new Date();
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	// Start of the week (Sunday) containing the first cell of the range.
	let start = new Date(end);
	start.setDate(end.getDate() - (GRID_WEEKS * 7 - 1));
	start = new Date(
		start.getFullYear(),
		start.getMonth(),
		start.getDate() - start.getDay(),
	);

	const cells: GridCell[] = [];
	const cursor = new Date(start);
	const monthLabels: { index: number; label: string }[] = [];

	const monthFmt = new Intl.DateTimeFormat(
		locale === "zh-CN" ? "zh-CN" : "en",
		{ month: "short" },
	);
	const monthKeyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
	let prevMonthKey: string | null = null;

	while (cursor <= end) {
		const key = localDayKey(cursor);
		const mKey = monthKeyOf(cursor);
		if (mKey !== prevMonthKey) {
			prevMonthKey = mKey;
			// Attach the label to the column (week) containing the month's first day,
			// even when it starts mid-week.
			const columnStart = cells.length - (cells.length % 7);
			monthLabels.push({ index: columnStart, label: monthFmt.format(cursor) });
		}
		cells.push({
			day: key,
			date: new Date(cursor),
			totals: map.get(key) ?? emptyTotals(),
		});
		cursor.setDate(cursor.getDate() + 1);
	}

	return { cells, weeks: Math.ceil(cells.length / 7), monthLabels };
}

/** Quantile thresholds (q25/q50/q75/max) over non-zero day totals. */
function computeLevels(daily: UsageDaySummary[]): number[] {
	const vals = daily
		.filter((d) => d.total > 0)
		.map((d) => d.total)
		.sort((a, b) => a - b);
	if (vals.length === 0) return [0, 0, 0, 0];
	const q = (p: number) =>
		vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
	return [q(0.25), q(0.5), q(0.75), q(1)];
}

const CELL_LEVEL_ALPHA = [0, 24, 42, 64, 88];

function cellColor(total: number, levels: number[]): string {
	if (total <= 0) return "transparent";
	let level = 4;
	if (total <= levels[0]) level = 1;
	else if (total <= levels[1]) level = 2;
	else if (total <= levels[2]) level = 3;
	return `color-mix(in srgb, var(--accent) ${CELL_LEVEL_ALPHA[level]}%, var(--bg-panel))`;
}

// ── Tooltip (portal, fixed position — never clipped by scroll containers) ───

const TOOLTIP_W = 170;
const TOOLTIP_H = 64;

function tooltipStyle(pos: { x: number; y: number }): React.CSSProperties {
	const vw = typeof window !== "undefined" ? window.innerWidth : 800;
	const left = Math.max(8, Math.min(pos.x + 14, vw - TOOLTIP_W - 8));
	const placeBelow = pos.y - TOOLTIP_H - 24 < 8;
	const top = placeBelow ? pos.y + 16 : pos.y - 14 - TOOLTIP_H;
	return { position: "fixed", left, top, zIndex: 6000 };
}

// ── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
	label,
	totals,
	callsLabel,
}: {
	label: string;
	totals: UsageTotals;
	callsLabel: string;
}) {
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
			<div
				style={{
					color: "var(--text-dim)",
					fontSize: 10.5,
					fontWeight: 600,
					letterSpacing: "0.04em",
				}}
			>
				{label}
			</div>
			<div
				style={{
					color: "var(--text)",
					fontSize: 15,
					fontWeight: 700,
					marginTop: 3,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{fmtTokens(totals.total)}
			</div>
			<div
				style={{
					color: "var(--text-muted)",
					fontSize: 10.5,
					marginTop: 2,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{fmtCost(totals.cost)} · {totals.calls}{" "}
				<span style={{ color: "var(--text-dim)" }}>{callsLabel}</span>
			</div>
		</div>
	);
}

// ── Section label ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				color: "var(--text-muted)",
				fontSize: 11,
				fontWeight: 600,
				letterSpacing: "0.04em",
				marginBottom: 6,
			}}
		>
			{children}
		</div>
	);
}

// ── Main component ──────────────────────────────────────────────────────────

export function UsageStats() {
	const { t, locale } = useI18n();
	const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
	const [detail, setDetail] = useState<UsageDetailResponse | null>(null);
	const [selectedDay, setSelectedDay] = useState<string | null>(null);
	const [tooltip, setTooltip] = useState<{
		cell: GridCell;
		x: number;
		y: number;
	} | null>(null);
	const [loading, setLoading] = useState(true);
	const [rescanning, setRescanning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const dateFmt = useMemo(
		() =>
			new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
				year: "numeric",
				month: "short",
				day: "numeric",
				weekday: "short",
			}),
		[locale],
	);

	const loadSummary = useCallback(async (refresh = false) => {
		try {
			const res = await fetch(
				`/api/usage/summary?days=${GRID_WEEKS * 7}${refresh ? "&refresh=1" : ""}`,
				{ cache: "no-store" },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as UsageSummaryResponse;
			setSummary(data);
			setError(null);
			setSelectedDay(
				(prev) => prev ?? data.daily[data.daily.length - 1]?.day ?? null,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial load + light polling while the tab is visible (live updates).
	useEffect(() => {
		void loadSummary();
		const timer = window.setInterval(() => void loadSummary(false), 5000);
		return () => window.clearInterval(timer);
	}, [loadSummary]);

	// Load per-day detail when the selected day changes.
	useEffect(() => {
		if (!selectedDay) return;
		let cancelled = false;
		fetch(`/api/usage/detail?day=${encodeURIComponent(selectedDay)}`, {
			cache: "no-store",
		})
			.then((res) =>
				res.ok ? (res.json() as Promise<UsageDetailResponse>) : null,
			)
			.then((data) => {
				if (!cancelled && data) setDetail(data);
			})
			.catch(() => {
				/* keep previous detail on transient errors */
			});
		return () => {
			cancelled = true;
		};
	}, [selectedDay]);

	const handleRescan = useCallback(async () => {
		setRescanning(true);
		try {
			await loadSummary(true);
		} finally {
			setRescanning(false);
		}
	}, [loadSummary]);

	const grid = useMemo(
		() => (summary ? buildGrid(summary.daily, locale) : null),
		[summary, locale],
	);
	const levels = useMemo(
		() => (summary ? computeLevels(summary.daily) : [0, 0, 0, 0]),
		[summary],
	);

	const handleCellEnter = useCallback((cell: GridCell, e: React.MouseEvent) => {
		setTooltip({ cell, x: e.clientX, y: e.clientY });
	}, []);

	const handleCellMove = useCallback((e: React.MouseEvent) => {
		setTooltip((prev) =>
			prev ? { ...prev, x: e.clientX, y: e.clientY } : prev,
		);
	}, []);

	const handleCellLeave = useCallback(() => setTooltip(null), []);

	// Per-day totals derived from the selected day's records.
	const dayTotals = useMemo(() => {
		if (!detail || !selectedDay) return null;
		const t0 = emptyTotals();
		for (const r of detail.records) {
			t0.total += r.totalTokens;
			t0.cost += r.cost;
			t0.calls += 1;
		}
		return t0;
	}, [detail, selectedDay]);

	const stats = summary;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			{error && (
				<div
					style={{
						fontSize: 11.5,
						color: "var(--danger)",
						padding: "6px 8px",
						background: "color-mix(in srgb, var(--danger) 8%, var(--bg-panel))",
						borderRadius: 6,
					}}
				>
					{error}
				</div>
			)}

			{loading && !stats ? (
				<div
					style={{
						color: "var(--text-dim)",
						fontSize: 12,
						padding: "16px 0",
						textAlign: "center",
					}}
				>
					{t("usage.loading")}
				</div>
			) : stats ? (
				<>
					{/* Stat cards */}
					<div style={{ display: "flex", gap: 6 }}>
						<StatCard
							label={t("usage.today")}
							totals={stats.today}
							callsLabel={t("usage.calls")}
						/>
						<StatCard
							label={t("usage.last7")}
							totals={stats.last7Days}
							callsLabel={t("usage.calls")}
						/>
						<StatCard
							label={t("usage.last30")}
							totals={stats.last30Days}
							callsLabel={t("usage.calls")}
						/>
						<StatCard
							label={t("usage.allTime")}
							totals={stats.allTime}
							callsLabel={t("usage.calls")}
						/>
					</div>

					{/* Contribution grid */}
					<div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								marginBottom: 8,
							}}
						>
							<SectionLabel>{t("usage.dailyUsage")}</SectionLabel>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 3,
									fontSize: 9.5,
									color: "var(--text-dim)",
								}}
							>
								{t("usage.less")}
								{[0, 1, 2, 3, 4].map((lvl) => (
									<span
										key={lvl}
										style={{
											width: 10,
											height: 10,
											borderRadius: 2,
											background:
												lvl === 0
													? "transparent"
													: `color-mix(in srgb, var(--accent) ${CELL_LEVEL_ALPHA[lvl]}%, var(--bg-panel))`,
											border: "1px solid var(--border)",
										}}
									/>
								))}
								{t("usage.more")}
							</span>
						</div>

						<div
							style={{
								background: "var(--bg-panel)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								padding: "10px 12px",
								overflowX: "auto",
							}}
						>
							{grid && (
								<div style={{ display: "flex", gap: 3 }}>
									{/* Weekday labels (aligned with the month-label row above the cells) */}
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: 3,
											paddingRight: 4,
											paddingTop: 19,
										}}
									>
										{[1, 3, 5].map((wd) => (
											<div
												key={wd}
												style={{
													height: 11,
													fontSize: 8.5,
													color: "var(--text-dim)",
													lineHeight: "11px",
												}}
											>
												{new Intl.DateTimeFormat(
													locale === "zh-CN" ? "zh-CN" : "en",
													{ weekday: "narrow" },
												).format(new Date(2024, 0, wd))}
											</div>
										))}
									</div>

									<div style={{ flex: 1, overflow: "hidden" }}>
										{/* Month labels */}
										<div
											style={{
												display: "flex",
												gap: 3,
												height: 16,
												marginBottom: 3,
											}}
										>
											{Array.from({ length: grid.weeks }, (_, w) => {
												const label = grid.monthLabels.find(
													(m) => m.index === w * 7,
												)?.label;
												return (
													<div
														key={w}
														style={{
															width: 11,
															fontSize: 8.5,
															color: "var(--text-dim)",
															whiteSpace: "nowrap",
															overflow: "visible",
														}}
													>
														{label ?? ""}
													</div>
												);
											})}
										</div>

										{/* Cells */}
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: 3,
											}}
										>
											{Array.from({ length: 7 }, (_, row) => (
												<div key={row} style={{ display: "flex", gap: 3 }}>
													{Array.from({ length: grid.weeks }, (_, w) => {
														const cell = grid.cells[w * 7 + row];
														if (!cell || cell.date > new Date()) {
															return (
																<div
																	key={`${w}-${row}`}
																	style={{ width: 11, height: 11 }}
																/>
															);
														}
														const isSelected = cell.day === selectedDay;
														return (
															<div
																key={`${w}-${row}`}
																onClick={() => setSelectedDay(cell.day)}
																onMouseEnter={(e) => handleCellEnter(cell, e)}
																onMouseMove={handleCellMove}
																onMouseLeave={handleCellLeave}
																style={{
																	width: 11,
																	height: 11,
																	borderRadius: 2.5,
																	background: cellColor(
																		cell.totals.total,
																		levels,
																	),
																	border: isSelected
																		? "1.5px solid var(--accent)"
																		: cell.totals.total > 0
																			? "1px solid color-mix(in srgb, var(--accent) 35%, transparent)"
																			: "1px solid var(--border)",
																	cursor:
																		cell.totals.total > 0
																			? "pointer"
																			: "default",
																	transition: "transform 0.1s ease",
																	boxSizing: "border-box",
																}}
															/>
														);
													})}
												</div>
											))}
										</div>
									</div>
								</div>
							)}
						</div>
					</div>

					{/* Day detail */}
					{selectedDay && detail && (
						<div>
							<SectionLabel>
								{t("usage.sessionDetail")} ·{" "}
								{dateFromDay(selectedDay).toLocaleDateString(
									locale === "zh-CN" ? "zh-CN" : "en",
									{ month: "short", day: "numeric" },
								)}
								{dayTotals && dayTotals.total > 0 && (
									<span
										style={{
											color: "var(--text-dim)",
											fontWeight: 400,
											fontVariantNumeric: "tabular-nums",
										}}
									>
										{" "}
										· {fmtTokens(dayTotals.total)} tokens ·{" "}
										{fmtCost(dayTotals.cost)} · {dayTotals.calls}{" "}
										{t("usage.calls")}
									</span>
								)}
							</SectionLabel>
							{detail.records.length === 0 ? (
								<div
									style={{
										color: "var(--text-dim)",
										fontSize: 11,
										padding: "8px 0",
									}}
								>
									{t("usage.noData")}
								</div>
							) : (
								<div
									style={{
										maxHeight: 190,
										overflowY: "auto",
										border: "1px solid var(--border)",
										borderRadius: 8,
										background: "var(--bg-panel)",
									}}
								>
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
											<span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
												{fmtTime(r.timestamp)}
											</span>
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
											<span
												style={{ color: "var(--text-muted)", flexShrink: 0 }}
											>
												{fmtTokens(r.totalTokens)}{" "}
												<span style={{ color: "var(--text-dim)" }}>tok</span>
											</span>
											<span
												style={{
													color: "var(--text-dim)",
													flexShrink: 0,
													width: 58,
													textAlign: "right",
												}}
											>
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
							<SectionLabel>{t("usage.modelBreakdown")}</SectionLabel>
							<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
								{stats.byModel.map((m) => {
									const pct = Math.max(
										2,
										(m.total / Math.max(1, stats.byModel[0].total)) * 100,
									);
									return (
										<div key={`${m.provider}::${m.model}`}>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													fontSize: 10.5,
													marginBottom: 2,
												}}
											>
												<span
													style={{
														color: "var(--text)",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														maxWidth: "62%",
													}}
													title={`${m.provider}/${m.model}`}
												>
													{shortModel(m.model)}
												</span>
												<span
													style={{
														color: "var(--text-muted)",
														fontVariantNumeric: "tabular-nums",
														flexShrink: 0,
													}}
												>
													{fmtTokens(m.total)} · {fmtCost(m.cost)}
												</span>
											</div>
											<div
												style={{
													height: 5,
													borderRadius: 3,
													background: "var(--border)",
													overflow: "hidden",
												}}
											>
												<div
													style={{
														width: `${pct}%`,
														height: "100%",
														borderRadius: 3,
														background:
															"color-mix(in srgb, var(--accent) 70%, transparent)",
													}}
												/>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* Footer actions */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 8,
							borderTop: "1px solid var(--border)",
							paddingTop: 10,
						}}
					>
						<span style={{ color: "var(--text-dim)", fontSize: 10 }}>
							{t("usage.records", { count: stats.storeRecords })}
							{stats.scannedAt
								? ` · ${t("usage.sessionFiles", { count: stats.scannedFiles })}`
								: ""}
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
				<div
					style={{
						color: "var(--text-dim)",
						fontSize: 12,
						padding: "16px 0",
						textAlign: "center",
					}}
				>
					{t("usage.noData")}
				</div>
			)}

			{/* Tooltip rendered through a portal: fixed position, never clipped */}
			{tooltip &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						style={{
							...tooltipStyle({ x: tooltip.x, y: tooltip.y }),
							background: "var(--bg-panel)",
							border: "1px solid var(--border)",
							borderRadius: 6,
							padding: "6px 9px",
							fontSize: 10.5,
							color: "var(--text)",
							whiteSpace: "nowrap",
							pointerEvents: "none",
							boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
							minWidth: 132,
						}}
					>
						<div style={{ fontWeight: 700, marginBottom: 2 }}>
							{dateFmt.format(tooltip.cell.date)}
						</div>
						<div>
							{tooltip.cell.totals.total > 0
								? `${fmtTokens(tooltip.cell.totals.total)} tokens · ${fmtCost(tooltip.cell.totals.cost)}`
								: t("usage.noData")}
						</div>
						{tooltip.cell.totals.total > 0 && (
							<div style={{ color: "var(--text-muted)" }}>
								{fmtTokens(tooltip.cell.totals.input)} in ·{" "}
								{fmtTokens(tooltip.cell.totals.output)} out ·{" "}
								{tooltip.cell.totals.calls} {t("usage.calls")}
							</div>
						)}
					</div>,
					document.body,
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
