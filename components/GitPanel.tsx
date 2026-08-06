import { useState, useEffect, useCallback, useRef } from "react";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import { useUiSettings } from "@/hooks/useUiSettings";
import type { GitFileStatus, GitStatusResponse } from "@/lib/git-types";

// porcelain 状态字符 → 颜色（X: index, Y: worktree）
const STATUS_CHAR_COLOR: Record<string, string> = {
	A: "var(--success)",
	M: "var(--warning)",
	D: "var(--danger)",
	R: "var(--warning)",
	C: "var(--warning)",
	U: "var(--danger)",
	"?": "var(--success)",
	untracked: "var(--success)",
};

interface Commit {
	hash: string;
	shortHash: string;
	author: string;
	time: string;
	message: string;
}

interface Props {
	cwd: string;
	onOpenFile: (filePath: string, fileName: string) => void;
	onInsertText?: (text: string) => void;
}

export function GitPanel({ cwd, onOpenFile, onInsertText }: Props) {
	const { t } = useI18n();
	const { settings } = useUiSettings();
	const [status, setStatus] = useState<GitStatusResponse | null>(null);
	const [commits, setCommits] = useState<Commit[]>([]);
	const [loading, setLoading] = useState(false);
	const [commitMsg, setCommitMsg] = useState("");
	const [isCommitting, setIsCommitting] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isPulling, setIsPulling] = useState(false);
	const [isPushing, setIsPushing] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [genModel, setGenModel] = useState<string | null>(null);
	const prevCwd = useRef(cwd);
	const [historyOpen, setHistoryOpen] = useState(false);

	// Context Menu State
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		file: GitFileStatus;
		isStaged: boolean;
	} | null>(null);

	const fetchStatus = useCallback(async () => {
		setLoading(true);
		try {
			const res = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`);
			if (!res.ok) throw new Error("Failed to fetch git status");
			const data = await res.json();
			setStatus(data);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	const fetchHistory = useCallback(async () => {
		try {
			const res = await fetch(`/api/git/log?cwd=${encodeURIComponent(cwd)}`);
			if (!res.ok) return;
			const data = await res.json();
			setCommits(data.commits || []);
		} catch (err: unknown) {
			console.error(err);
		}
	}, [cwd]);

	useEffect(() => {
		if (cwd !== prevCwd.current) {
			setCommitMsg("");
			prevCwd.current = cwd;
		}
		void fetchStatus();
		void fetchHistory();
	}, [cwd, fetchStatus, fetchHistory]);

	const handleAction = async (action: string, paths?: string[]) => {
		try {
			setContextMenu(null);
			const res = await fetch("/api/git/action", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					cwd,
					action,
					paths,
					message: action === "commit" ? commitMsg : undefined,
				}),
			});
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error || "Action failed");
			if (action === "commit") {
				setCommitMsg("");
				void fetchHistory();
			}
			await fetchStatus();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleGenerate = async () => {
		setIsGenerating(true);
		setError(null);
		setGenModel(null);
		try {
			const res = await fetch("/api/git/ai-commit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					cwd,
					prompt: settings.gitAiPrompt,
					model: settings.gitAiModel,
					maxTokens: settings.gitAiMaxTokens,
				}),
			});
			const data = await res.json();
			if (!res.ok || data.error)
				throw new Error(data.error || "Generation failed");
			setCommitMsg(data.message);
			if (data.model) setGenModel(data.model);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsGenerating(false);
		}
	};

	useEffect(() => {
		const handleGlobalClick = () => setContextMenu(null);
		window.addEventListener("click", handleGlobalClick);
		return () => window.removeEventListener("click", handleGlobalClick);
	}, []);

	if (!status?.isGitRepository) {
		return (
			<div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
				{t("git.noChanges") || "Not a git repository"}
			</div>
		);
	}

	// porcelain 状态字符：" "=未修改，"?"=未跟踪，"!"=忽略。
	// 旧代码与语义字符串（"unmodified" 等）比较永不匹配，
	// 导致所有未暂存文件都出现在“已暂存”列表里。
	const staged = status.files.filter(
		(f) =>
			f.indexStatus !== " " && f.indexStatus !== "?" && f.indexStatus !== "!",
	);
	const unstaged = status.files.filter(
		(f) => f.worktreeStatus !== " " && f.worktreeStatus !== "!",
	);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflowY: "auto",
				position: "relative",
			}}
		>
			<div
				style={{
					padding: "10px",
					display: "flex",
					flexDirection: "column",
					gap: 8,
					borderBottom: "1px solid var(--border)",
				}}
			>
				{/* Source Control Toolbar */}
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: -2 }}>
					<span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
						{t("git.sourceControl") || "Source Control"}
						{status?.branch && (
							<span style={{ fontSize: 9, background: "var(--bg-hover)", padding: "2px 6px", borderRadius: 4, textTransform: "none", letterSpacing: "normal" }}>
								<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: "inline-block", marginRight: 3, verticalAlign: "middle", marginTop: -2 }}><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
								{status.branch}
							</span>
						)}
					</span>
					<div style={{ display: "flex", gap: 6 }}>
						<button
							title={t("sidebar.refresh") || "Refresh"}
							disabled={loading}
							onClick={() => {
								fetchStatus();
								fetchHistory();
							}}
							style={{ background: "none", border: "none", color: loading ? "var(--border)" : "var(--text-muted)", cursor: loading ? "not-allowed" : "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
						</button>
						<button
							title={t("git.pull") || "Pull"}
							disabled={isPulling || isSyncing}
							onClick={() => {
								setIsPulling(true);
								handleAction("pull").finally(() => setIsPulling(false));
							}}
							style={{ background: "none", border: "none", color: (isPulling || isSyncing) ? "var(--border)" : "var(--text-muted)", cursor: (isPulling || isSyncing) ? "not-allowed" : "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
						</button>
						<button
							title={t("git.push") || "Push"}
							disabled={isPushing || isSyncing}
							onClick={() => {
								setIsPushing(true);
								handleAction("push").finally(() => setIsPushing(false));
							}}
							style={{ background: "none", border: "none", color: (isPushing || isSyncing) ? "var(--border)" : "var(--text-muted)", cursor: (isPushing || isSyncing) ? "not-allowed" : "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
						</button>
						<button
							title={t("git.sync") || "Sync Changes"}
							disabled={isPulling || isPushing || isSyncing}
							onClick={() => {
								setIsSyncing(true);
								handleAction("pull").then(() => handleAction("push")).finally(() => setIsSyncing(false));
							}}
							style={{ background: "none", border: "none", color: (isPulling || isPushing || isSyncing) ? "var(--border)" : "var(--text-muted)", cursor: (isPulling || isPushing || isSyncing) ? "not-allowed" : "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
						</button>
					</div>
				</div>
				<textarea
					value={commitMsg}
					onChange={(e) => setCommitMsg(e.target.value)}
					placeholder={t("git.commitPlaceholder")}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							if (commitMsg && staged.length > 0 && !isCommitting) {
								setIsCommitting(true);
								handleAction("commit").finally(() => setIsCommitting(false));
							}
						}
					}}
					style={{
						width: "100%",
						height: 64,
						padding: 8,
						fontSize: 12,
						borderRadius: 4,
						border: "1px solid var(--border)",
						background: "var(--bg)",
						color: "var(--text)",
						resize: "vertical",
					}}
				/>
				<div style={{ display: "flex", gap: 6 }}>
					<button
						onClick={() => {
							setIsCommitting(true);
							handleAction("commit").finally(() => setIsCommitting(false));
						}}
						disabled={isCommitting || !commitMsg || staged.length === 0}
						style={{
							flex: 1,
							padding: "6px 0",
							background: "var(--accent)",
							color: "#fff",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							opacity:
								isCommitting || !commitMsg || staged.length === 0 ? 0.5 : 1,
							fontSize: 11,
							fontWeight: 500,
						}}
					>
						{t("git.commit")}
					</button>
					<button
						onClick={handleGenerate}
						disabled={isGenerating || staged.length === 0}
						style={{
							padding: "6px 12px",
							background: "var(--bg-selected)",
							color: "var(--text)",
							border: "1px solid var(--border)",
							borderRadius: 4,
							cursor: "pointer",
							opacity: isGenerating || staged.length === 0 ? 0.5 : 1,
							fontSize: 11,
							fontWeight: 500,
							display: "flex",
							alignItems: "center",
							gap: 4,
						}}
						title={t("git.generateAI")}
					>
						{isGenerating ? (
							t("git.generating")
						) : (
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
							</svg>
						)}
					</button>
				</div>
				{error && (
					<div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>
						{error}
					</div>
				)}
				{genModel && !error && (
					<div
						style={{
							color: "var(--text-dim)",
							fontSize: 10.5,
							marginTop: 4,
							fontVariantNumeric: "tabular-nums",
						}}
					>
						{t("git.generatedBy")} {genModel}
					</div>
				)}
			</div>

			<div style={{ flex: 1, overflowY: "auto", paddingBottom: 20 }}>
				{staged.length > 0 && (
					<div style={{ marginTop: 8 }}>
						<div
							style={{
								fontSize: 10,
								fontWeight: 600,
								color: "var(--text-dim)",
								padding: "4px 10px",
								display: "flex",
								justifyContent: "space-between",
								textTransform: "uppercase",
								letterSpacing: "0.05em",
							}}
						>
							<span>{t("git.stagedChanges")}</span>
							<button
								style={{
									background: "none",
									border: "none",
									color: "var(--text-dim)",
									cursor: "pointer",
								}}
								onClick={() =>
									handleAction(
										"unstage",
										staged.map((f) => f.filePath),
									)
								}
								title={t("git.unstageAll")}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<line x1="5" y1="12" x2="19" y2="12"></line>
								</svg>
							</button>
						</div>
						{staged.map((f) => (
							<FileRow
								key={f.filePath}
								f={f}
								isStaged={true}
								t={t}
								onOpenFile={onOpenFile}
								handleAction={handleAction}
								setContextMenu={setContextMenu}
							/>
						))}
					</div>
				)}

				{unstaged.length > 0 && (
					<div style={{ marginTop: 8 }}>
						<div
							style={{
								fontSize: 10,
								fontWeight: 600,
								color: "var(--text-dim)",
								padding: "4px 10px",
								display: "flex",
								justifyContent: "space-between",
								textTransform: "uppercase",
								letterSpacing: "0.05em",
							}}
						>
							<span>{t("git.changes")}</span>
							<button
								style={{
									background: "none",
									border: "none",
									color: "var(--text-dim)",
									cursor: "pointer",
								}}
								onClick={() =>
									handleAction(
										"add",
										unstaged.map((f) => f.filePath),
									)
								}
								title={t("git.stageAll")}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<line x1="12" y1="5" x2="12" y2="19"></line>
									<line x1="5" y1="12" x2="19" y2="12"></line>
								</svg>
							</button>
						</div>
						{unstaged.map((f) => (
							<FileRow
								key={f.filePath}
								f={f}
								isStaged={false}
								t={t}
								onOpenFile={onOpenFile}
								handleAction={handleAction}
								setContextMenu={setContextMenu}
							/>
						))}
					</div>
				)}

				{staged.length === 0 && unstaged.length === 0 && !loading && (
					<div
						style={{
							padding: "20px 10px",
							color: "var(--text-dim)",
							fontSize: 12,
							textAlign: "center",
						}}
					>
						{t("git.noChanges")}
					</div>
				)}

				<div style={{ marginTop: 12 }}>
					<div
						style={{
							fontSize: 10,
							fontWeight: 600,
							color: "var(--text-dim)",
							padding: "4px 10px",
							display: "flex",
							alignItems: "center",
							gap: 4,
							cursor: "pointer",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
						}}
						onClick={() => setHistoryOpen(!historyOpen)}
					>
						<svg
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							style={{
								transform: historyOpen ? "rotate(90deg)" : "none",
								transition: "transform 0.15s",
							}}
						>
							<polyline points="9 18 15 12 9 6"></polyline>
						</svg>
						{t("git.history")}
					</div>
					{historyOpen &&
						commits.map((commit) => (
							<div
								key={commit.hash}
								style={{
									padding: "6px 10px",
									fontSize: 11,
									borderBottom: "1px solid var(--border)",
									cursor: "pointer",
								}}
								className="panel-content-in hover:bg-[var(--bg-hover)]"
								onClick={() => {
									if (onInsertText) {
										onInsertText(
											`Commit: ${commit.hash}\nAuthor: ${commit.author}\nDate: ${commit.time}\n\n${commit.message}`,
										);
									}
								}}
								title={t("git.insertCommit")}
							>
								<div
									style={{
										color: "var(--text)",
										fontWeight: 500,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{commit.message}
								</div>
								<div
									style={{
										color: "var(--text-dim)",
										display: "flex",
										gap: 8,
										marginTop: 4,
										alignItems: "center",
									}}
								>
									<span
										style={{
											fontFamily: "var(--font-mono)",
											cursor: "pointer",
											color: "var(--accent)",
										}}
										onClick={(e) => {
											e.stopPropagation();
											navigator.clipboard.writeText(commit.hash);
										}}
										title={t("git.copyHash")}
									>
										{commit.shortHash}
									</span>
									<div
										style={{ display: "flex", alignItems: "center", gap: 4 }}
									>
										<div
											style={{
												width: 14,
												height: 14,
												borderRadius: "50%",
												background:
													"color-mix(in srgb, var(--accent) 30%, transparent)",
												color: "var(--accent)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: 9,
												fontWeight: 600,
											}}
										>
											{commit.author.charAt(0).toUpperCase()}
										</div>
										<span>{commit.author}</span>
									</div>
									<span>{commit.time}</span>
								</div>
							</div>
						))}
				</div>
			</div>

			{contextMenu && (
				<div
					style={{
						position: "fixed",
						top: contextMenu.y,
						left: contextMenu.x,
						background: "var(--bg-panel)",
						border: "1px solid var(--border)",
						borderRadius: 6,
						boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
						padding: 4,
						zIndex: 1000,
						minWidth: 120,
					}}
					className="panel-content-in"
					onClick={(e) => e.stopPropagation()}
				>
					<button
						onClick={() =>
							handleAction(contextMenu.isStaged ? "unstage" : "add", [
								contextMenu.file.filePath,
							])
						}
						style={{
							display: "block",
							width: "100%",
							textAlign: "left",
							padding: "6px 10px",
							background: "none",
							border: "none",
							color: "var(--text)",
							fontSize: 12,
							cursor: "pointer",
							borderRadius: 4,
						}}
						className="hover:bg-[var(--bg-hover)]"
					>
						{contextMenu.isStaged ? t("git.unstage") : t("git.stage")}
					</button>
					{!contextMenu.isStaged && (
						<button
							onClick={() =>
								handleAction("restore", [contextMenu.file.filePath])
							}
							style={{
								display: "block",
								width: "100%",
								textAlign: "left",
								padding: "6px 10px",
								background: "none",
								border: "none",
								color: "var(--danger)",
								fontSize: 12,
								cursor: "pointer",
								borderRadius: 4,
							}}
							className="hover:bg-[var(--bg-hover)]"
						>
							{t("git.discard")}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function FileRow({
	f,
	isStaged,
	t,
	onOpenFile,
	handleAction,
	setContextMenu,
}: {
	f: GitFileStatus;
	isStaged: boolean;
	t: (key: string) => string;
	onOpenFile: (path: string, name: string) => void;
	handleAction: (action: string, paths?: string[]) => void;
	setContextMenu: (
		ctx: {
			x: number;
			y: number;
			file: GitFileStatus;
			isStaged: boolean;
		} | null,
	) => void;
}) {
	const name = f.filePath.split("/").pop() || "";
	const displayStatus = isStaged
		? f.indexStatus
		: f.status === "untracked"
			? "untracked"
			: f.worktreeStatus;
	const color = STATUS_CHAR_COLOR[displayStatus] ?? "var(--text-dim)";
	const [hovered, setHovered] = useState(false);

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "4px 10px",
				fontSize: 12,
				cursor: "pointer",
				background: hovered ? "var(--bg-hover)" : "transparent",
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onClick={() => onOpenFile(f.filePath, name)}
			onContextMenu={(e) => {
				e.preventDefault();
				setContextMenu({ x: e.clientX, y: e.clientY, file: f, isStaged });
			}}
			className="panel-content-in"
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					overflow: "hidden",
					opacity: displayStatus === "deleted" ? 0.6 : 1,
				}}
			>
				{getFileIcon(name, 14)}
				<span
					style={{
						color: "var(--text)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						textDecoration:
							displayStatus === "deleted" ? "line-through" : "none",
					}}
				>
					{name}
				</span>
				<span style={{ color, fontSize: 10, fontWeight: 500 }}>
					{displayStatus.charAt(0).toUpperCase()}
				</span>
			</div>

			{hovered && (
				<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
					{!isStaged && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								handleAction("restore", [f.filePath]);
							}}
							style={{
								background: "none",
								border: "none",
								color: "var(--text-muted)",
								cursor: "pointer",
								display: "flex",
								padding: 2,
							}}
							title={t("git.discard")}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
								<polyline points="9 22 9 12 15 12 15 22"></polyline>
							</svg>
						</button>
					)}
					<button
						onClick={(e) => {
							e.stopPropagation();
							handleAction(isStaged ? "unstage" : "add", [f.filePath]);
						}}
						style={{
							background: "none",
							border: "none",
							color: "var(--text)",
							cursor: "pointer",
							display: "flex",
							padding: 2,
						}}
						title={isStaged ? t("git.unstage") : t("git.stage")}
					>
						{isStaged ? (
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<line x1="5" y1="12" x2="19" y2="12"></line>
							</svg>
						) : (
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<line x1="12" y1="5" x2="12" y2="19"></line>
								<line x1="5" y1="12" x2="19" y2="12"></line>
							</svg>
						)}
					</button>
				</div>
			)}
		</div>
	);
}
