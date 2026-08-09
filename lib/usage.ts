import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
} from "fs";
import { join } from "path";

// ============================================================================
// Token usage tracking
//
// Records every assistant message's token usage (the `usage` field of session
// .jsonl entries) into one append-only JSONL store under the pi agent dir
// (`~/.pi/agent/pi-web-usage.jsonl`).
//
// Two ingestion paths feed the store, deduplicated by `sessionFile#entryId`:
//   1. Live: AgentSessionWrapper subscribes to `entry_appended` events and
//      pushes records as messages are persisted (lib/rpc-manager.ts).
//   2. Backfill: `backfillUsage()` scans session files under
//      `~/.pi/agent/sessions/*/*.jsonl`, incrementally (per-file mtime+size).
//
// Plugin integration: pi extensions already receive per-call usage through the
// standard `message_end` event (`message.usage`) — the store below aggregates
// the same persisted data, so third-party counters stay consistent with the
// web UI. The store itself is a plain JSONL file any plugin can read, and the
// aggregation endpoints under /api/usage are available to any client.
// ============================================================================

export interface UsageRecord {
	/** Dedupe key: `${sessionFile}#${entryId}` */
	id: string;
	sessionFile: string;
	entryId: string;
	timestamp: string; // ISO timestamp of the assistant message
	provider: string;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Subset of `output` (provider reports it or 0) */
	reasoning: number;
	totalTokens: number;
	cost: number;
}

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	total: number;
	cost: number;
	calls: number;
}

export interface UsageDaySummary extends UsageTotals {
	day: string; // YYYY-MM-DD (local)
}

export interface UsageModelSummary extends UsageTotals {
	provider: string;
	model: string;
}

export interface UsageSummaryResponse {
	today: UsageTotals;
	last7Days: UsageTotals;
	last30Days: UsageTotals;
	allTime: UsageTotals;
	daily: UsageDaySummary[]; // last N calendar days, ascending, zero-filled
	byModel: UsageModelSummary[]; // sorted by total tokens desc
	storeRecords: number;
	scannedFiles: number;
	scannedAt: number | null;
}

export interface UsageDetailResponse {
	day: string;
	records: UsageRecord[];
}

// ----------------------------------------------------------------------------
// Store state (globalThis so it survives Next.js hot-reload)
// ----------------------------------------------------------------------------

interface UsageState {
	records: Map<string, UsageRecord>;
	loaded: boolean;
	scannedFiles: Map<string, string>; // sessionFile -> "mtimeMs:size"
	lastBackfillAt: number;
	backfillPromise: Promise<number> | null;
	storeRecords: number;
}

declare global {
	var __piUsageState: UsageState | undefined;
}

function getState(): UsageState {
	if (!globalThis.__piUsageState) {
		globalThis.__piUsageState = {
			records: new Map(),
			loaded: false,
			scannedFiles: new Map(),
			lastBackfillAt: 0,
			backfillPromise: null,
			storeRecords: 0,
		};
	}
	return globalThis.__piUsageState;
}

const BACKFILL_THROTTLE_MS = 30_000;

function usageStorePath(): string {
	return join(getAgentDir(), "pi-web-usage.jsonl");
}

function sessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

export function recordKey(sessionFile: string, entryId: string): string {
	return `${sessionFile}#${entryId}`;
}

/** Local-timezone calendar day key (YYYY-MM-DD) for a timestamp. */
export function localDayKey(ts: string | number | Date): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function emptyTotals(): UsageTotals {
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

function addTotals(t: UsageTotals, r: UsageRecord): void {
	t.input += r.input;
	t.output += r.output;
	t.cacheRead += r.cacheRead;
	t.cacheWrite += r.cacheWrite;
	t.reasoning += r.reasoning;
	t.total += r.totalTokens;
	t.cost += r.cost;
	t.calls += 1;
}

function toUsageRecord(
	sessionFile: string,
	entryId: string,
	timestamp: string,
	provider: string,
	model: string,
	usage: {
		input?: unknown;
		output?: unknown;
		cacheRead?: unknown;
		cacheWrite?: unknown;
		reasoning?: unknown;
		totalTokens?: unknown;
		cost?: unknown;
	},
): UsageRecord | null {
	const input = num(usage.input);
	const output = num(usage.output);
	const cacheRead = num(usage.cacheRead);
	const cacheWrite = num(usage.cacheWrite);
	const reasoning = num(usage.reasoning);
	const totalTokens =
		num(usage.totalTokens) || input + output + cacheRead + cacheWrite;
	if (totalTokens <= 0 && costOf(usage.cost) <= 0) return null;

	// In-memory sessions have no file yet: skip so the record is picked up by
	// the backfill scan once the session file is persisted. Fabricating an
	// "(unknown)" key would record the entry twice (live + backfill under the
	// real path) and double-count it in the totals.
	if (!sessionFile) return null;
	const file = sessionFile;
	return {
		id: recordKey(file, entryId),
		sessionFile: file,
		entryId,
		timestamp,
		provider: provider || "unknown",
		model: model || "unknown",
		input,
		output,
		cacheRead,
		cacheWrite,
		reasoning,
		totalTokens,
		cost: costOf(usage.cost),
	};
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function costOf(cost: unknown): number {
	if (typeof cost === "number" && Number.isFinite(cost)) return cost;
	if (cost && typeof cost === "object") {
		const total = (cost as { total?: unknown }).total;
		if (typeof total === "number" && Number.isFinite(total)) return total;
	}
	return 0;
}

/** Extract a UsageRecord from a session entry if it carries usage data. */
export function recordFromEntry(
	sessionFile: string,
	entry: {
		type?: unknown;
		id?: unknown;
		timestamp?: unknown;
		message?: {
			role?: unknown;
			provider?: unknown;
			model?: unknown;
			timestamp?: unknown;
			usage?: unknown;
		} | null;
	},
): UsageRecord | null {
	if (
		entry?.type !== "message" ||
		!entry.message ||
		entry.message.role !== "assistant"
	)
		return null;
	const usage = entry.message.usage;
	if (!usage || typeof usage !== "object") return null;
	const entryId = typeof entry.id === "string" ? entry.id : "";
	if (!entryId) return null;
	const timestamp =
		typeof entry.message.timestamp === "string"
			? entry.message.timestamp
			: typeof entry.timestamp === "string"
				? entry.timestamp
				: new Date().toISOString();
	const provider =
		typeof entry.message.provider === "string" ? entry.message.provider : "";
	const model =
		typeof entry.message.model === "string" ? entry.message.model : "";
	const u = usage as Record<string, unknown>;
	return toUsageRecord(sessionFile, entryId, timestamp, provider, model, {
		input: u.input,
		output: u.output,
		cacheRead: u.cacheRead,
		cacheWrite: u.cacheWrite,
		reasoning: u.reasoning,
		totalTokens: u.totalTokens,
		cost: u.cost,
	});
}

// ----------------------------------------------------------------------------
// Ingestion
// ----------------------------------------------------------------------------

function ensureLoaded(): void {
	const state = getState();
	if (state.loaded) return;
	state.loaded = true;
	const path = usageStorePath();
	if (!existsSync(path)) return;
	let content: string;
	try {
		content = readFileSync(path, "utf8");
	} catch {
		return;
	}
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			const rec = JSON.parse(line) as UsageRecord;
			if (rec && typeof rec.id === "string" && rec.id)
				state.records.set(rec.id, rec);
		} catch {
			// Skip corrupt lines — they are re-created by future backfills.
		}
	}
	state.storeRecords = state.records.size;
}

/**
 * Convenience: extract a UsageRecord from a session entry (if it carries
 * usage) and persist it. Returns true when a new record was stored.
 */
export function recordUsageFromEntry(
	sessionFile: string,
	entry: unknown,
): boolean {
	const rec = recordFromEntry(
		sessionFile,
		entry as Parameters<typeof recordFromEntry>[1],
	);
	return rec ? recordUsage(rec) : false;
}

/**
 * Append a record (deduplicated). Returns true when a new record was stored.
 * Skips records without a session file (in-memory sessions); the backfill
 * scan picks those up once the file is persisted.
 */
export function recordUsage(record: UsageRecord): boolean {
	if (!record.sessionFile) return false;
	ensureLoaded();
	const state = getState();
	if (state.records.has(record.id)) return false;
	state.records.set(record.id, record);
	state.storeRecords = state.records.size;
	try {
		mkdirSync(getAgentDir(), { recursive: true });
		appendFileSync(usageStorePath(), JSON.stringify(record) + "\n", {
			encoding: "utf8",
		});
	} catch (err) {
		console.error(
			"[pi-web] failed to persist usage record:",
			err instanceof Error ? err.message : err,
		);
	}
	return true;
}

/**
 * Scan session files for usage data not yet in the store.
 * Incremental: files whose mtime+size are unchanged since the last scan are skipped.
 * Throttled to once per BACKFILL_THROTTLE_MS unless force is set.
 */
export function backfillUsage(
	options: { force?: boolean } = {},
): Promise<number> {
	const state = getState();

	// Reuse an in-flight scan instead of stacking concurrent ones.
	if (state.backfillPromise) return state.backfillPromise;

	// Throttle non-forced rescans.
	if (
		!options.force &&
		state.lastBackfillAt &&
		Date.now() - state.lastBackfillAt < BACKFILL_THROTTLE_MS
	) {
		return Promise.resolve(0);
	}

	// The scan is fully synchronous (statSync/readFileSync only, no awaits), so
	// the async body runs to completion — including any `finally` — *before* the
	// assignment below executes. Clearing the slot inside that `finally` and then
	// assigning `state.backfillPromise = run` would re-store the already-resolved
	// promise, making the guard above return the stale promise forever: backfill
	// would never run again after the first request (the stats then freeze at the
	// first snapshot). Clear the slot from `.then()` instead: it fires as a
	// microtask — i.e. after the assignment — and only when we still own the slot.
	const run = (async (): Promise<number> => {
		let added = 0;
		try {
			ensureLoaded();
			const dir = sessionsDir();
			if (!existsSync(dir)) return added;
			const cwdDirs = readdirSync(dir, { withFileTypes: true });
			for (const cwdDir of cwdDirs) {
				if (!cwdDir.isDirectory()) continue;
				const sessionDirPath = join(dir, cwdDir.name);
				let files: string[];
				try {
					files = readdirSync(sessionDirPath).filter((f) =>
						f.endsWith(".jsonl"),
					);
				} catch {
					continue;
				}
				for (const file of files) {
					const filePath = join(sessionDirPath, file);
					let mtimeMs: number;
					let size: number;
					try {
						const st = statSync(filePath);
						mtimeMs = st.mtimeMs;
						size = st.size;
					} catch {
						continue;
					}
					// Incremental: skip files whose mtime AND size are unchanged since the
					// last scan (size guards against in-place rewrites with a kept mtime).
					if (
						!options.force &&
						state.scannedFiles.get(filePath) === `${mtimeMs}:${size}`
					)
						continue;
					let content: string;
					try {
						content = readFileSync(filePath, "utf8");
					} catch {
						continue;
					}
					for (const line of content.split("\n")) {
						if (!line.trim()) continue;
						let entry: {
							type?: unknown;
							id?: unknown;
							timestamp?: unknown;
							message?: {
								role?: unknown;
								provider?: unknown;
								model?: unknown;
								timestamp?: unknown;
								usage?: unknown;
							} | null;
						};
						try {
							entry = JSON.parse(line) as typeof entry;
						} catch {
							continue;
						}
						const record = recordFromEntry(filePath, entry);
						if (record && recordUsage(record)) added += 1;
					}
					state.scannedFiles.set(filePath, `${mtimeMs}:${size}`);
				}
			}
		} catch (err) {
			console.error(
				"[pi-web] usage backfill failed:",
				err instanceof Error ? err.message : err,
			);
		} finally {
			state.lastBackfillAt = Date.now();
		}
		return added;
	})();

	state.backfillPromise = run;
	void run.then(
		() => {
			if (state.backfillPromise === run) state.backfillPromise = null;
		},
		(err) => {
			if (state.backfillPromise === run) state.backfillPromise = null;
			console.error(
				"[pi-web] usage backfill failed:",
				err instanceof Error ? err.message : err,
			);
		},
	);
	return run;
}

// ----------------------------------------------------------------------------
// Aggregation
// ----------------------------------------------------------------------------

function dayRange(days: number, now: Date): string[] {
	const out: string[] = [];
	const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(cursor);
		d.setDate(cursor.getDate() - i);
		out.push(localDayKey(d));
	}
	return out;
}

export async function getUsageSummary(
	options: { days?: number; forceBackfill?: boolean } = {},
): Promise<UsageSummaryResponse> {
	await backfillUsage({ force: options.forceBackfill });
	const state = getState();
	// Up to ~1 year so the UI can render a GitHub-style contribution grid.
	const days = Math.min(366, Math.max(1, Math.round(options.days ?? 30)));
	const now = new Date();
	const todayKey = localDayKey(now);

	const all = state.records.values();
	const dailyMap = new Map<string, UsageTotals>();
	const today = emptyTotals();
	const last7 = emptyTotals();
	const last30 = emptyTotals();
	const allTime = emptyTotals();
	const modelMap = new Map<string, UsageModelSummary>();

	const sevenDaysAgo = new Date(now);
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
	const thirtyDaysAgo = new Date(now);
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

	for (const r of all) {
		const day = localDayKey(r.timestamp);
		addTotals(allTime, r);
		if (day === todayKey) addTotals(today, r);
		const rDate = new Date(r.timestamp);
		if (rDate >= sevenDaysAgo) addTotals(last7, r);
		if (rDate >= thirtyDaysAgo) addTotals(last30, r);
		let daily = dailyMap.get(day);
		if (!daily) {
			daily = emptyTotals();
			dailyMap.set(day, daily);
		}
		addTotals(daily, r);

		const mKey = `${r.provider}::${r.model}`;
		let m = modelMap.get(mKey);
		if (!m) {
			m = { ...emptyTotals(), provider: r.provider, model: r.model };
			modelMap.set(mKey, m);
		}
		addTotals(m, r);
	}

	const daily = dayRange(days, now).map((day) => ({
		...(dailyMap.get(day) ?? emptyTotals()),
		day,
	}));

	const byModel = [...modelMap.values()]
		.sort((a, b) => b.total - a.total)
		.slice(0, 12);

	return {
		today,
		last7Days: last7,
		last30Days: last30,
		allTime,
		daily,
		byModel,
		storeRecords: state.storeRecords,
		scannedFiles: state.scannedFiles.size,
		scannedAt: state.lastBackfillAt || null,
	};
}

export async function getUsageDetail(
	day: string,
): Promise<UsageDetailResponse> {
	await backfillUsage();
	const state = getState();
	const records = [...state.records.values()]
		.filter((r) => localDayKey(r.timestamp) === day)
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	return { day, records };
}
