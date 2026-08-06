"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useUiSettings, type FontSize } from "@/hooks/useUiSettings";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, ACCENTS, type Accent } from "@/hooks/useTheme";
import { useAudio } from "@/hooks/useAudio";
import { settingsDialogStore } from "@/lib/settings-dialog-store";
import { UsageStats } from "./UsageStats";

interface Props {
	onClose: () => void;
}

type SettingsTab = "general" | "appearance" | "git" | "usage";

// ── 基础控件 ────────────────────────────────────────────────────────────────

function ToggleRow({
	label,
	desc,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	desc: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 16,
				padding: "10px 0",
				opacity: disabled ? 0.5 : 1,
			}}
		>
			<div style={{ minWidth: 0 }}>
				<div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
					{label}
				</div>
				<div style={{ color: "var(--text-dim)", fontSize: 11.5, marginTop: 2 }}>
					{desc}
				</div>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				style={{
					flexShrink: 0,
					width: 38,
					height: 22,
					borderRadius: 999,
					border: "none",
					cursor: disabled ? "default" : "pointer",
					position: "relative",
					background: checked ? "var(--accent)" : "var(--border)",
					transition: "background 0.15s ease",
				}}
			>
				<span
					style={{
						position: "absolute",
						top: 2,
						left: checked ? 18 : 2,
						width: 18,
						height: 18,
						borderRadius: "50%",
						background: "#fff",
						transition: "left 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
					}}
				/>
			</button>
		</div>
	);
}

function OptionButton({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				flex: 1,
				padding: "7px 0",
				borderRadius: 7,
				border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
				background: active
					? "color-mix(in srgb, var(--accent) 10%, var(--bg))"
					: "var(--bg-panel)",
				color: active ? "var(--accent)" : "var(--text-muted)",
				fontSize: 12,
				cursor: "pointer",
				transition: "all 0.15s ease",
			}}
		>
			{label}
		</button>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				color: "var(--text-muted)",
				fontSize: 11,
				fontWeight: 600,
				letterSpacing: "0.06em",
				paddingTop: 12,
				paddingBottom: 2,
			}}
		>
			{children}
		</div>
	);
}

function TabButton({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			style={{
				position: "relative",
				background: "none",
				border: "none",
				padding: "9px 14px 8px",
				fontSize: 12.5,
				fontWeight: active ? 600 : 400,
				color: active ? "var(--text)" : "var(--text-muted)",
				cursor: "pointer",
				transition: "color 0.15s ease",
				borderRadius: 0,
			}}
			onMouseEnter={(e) => {
				if (!active) e.currentTarget.style.color = "var(--text)";
			}}
			onMouseLeave={(e) => {
				if (!active) e.currentTarget.style.color = "var(--text-muted)";
			}}
		>
			{label}
			<span
				style={{
					position: "absolute",
					left: 10,
					right: 10,
					bottom: 0,
					height: 2,
					borderRadius: "2px 2px 0 0",
					background: active ? "var(--accent)" : "transparent",
					transition: "background 0.15s ease",
				}}
			/>
		</button>
	);
}

// ── 外观：主题色选择 ─────────────────────────────────────────────────────────

function AccentSwatches({
	accent,
	onPick,
	customLabel,
}: {
	accent: Accent;
	onPick: (id: Accent, customHex?: string) => void;
	customLabel: string;
}) {
	const [customHex, setCustomHex] = useState<string>(() => {
		if (typeof document === "undefined") return "#888888";
		return (
			getComputedStyle(document.documentElement)
				.getPropertyValue("--accent-custom")
				.trim() || "#888888"
		);
	});

	return (
		<div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{ACCENTS.map((a) => {
					const active = accent === a.id;
					return (
						<button
							key={a.id}
							type="button"
							title={a.name}
							onClick={() => onPick(a.id)}
							style={{
								width: 26,
								height: 26,
								borderRadius: 999,
								border: "none",
								cursor: "pointer",
								background:
									a.id === "custom"
										? "conic-gradient(#e11d48, #ea580c, #eab308, #22c55e, #0d9488, #3b82f6, #7c3aed, #e11d48)"
										: a.color,
								outline: active
									? "2px solid var(--accent)"
									: "1px solid var(--border)",
								outlineOffset: active ? 2 : 0,
								transition: "transform 0.1s ease",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.transform = "scale(1.1)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.transform = "scale(1)";
							}}
						/>
					);
				})}
			</div>
			{accent === "custom" && (
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginTop: 10,
						padding: "6px 10px",
						borderRadius: 7,
						border: "1px solid var(--border)",
						background: "var(--bg-panel)",
						cursor: "pointer",
						fontSize: 12,
						color: "var(--text-muted)",
					}}
				>
					<input
						type="color"
						value={customHex}
						onChange={(e) => {
							setCustomHex(e.target.value);
							onPick("custom", e.target.value);
						}}
						style={{
							width: 20,
							height: 20,
							padding: 0,
							border: "none",
							background: "none",
							cursor: "pointer",
							flexShrink: 0,
						}}
					/>
					<span style={{ flex: 1 }}>{customLabel}</span>
				</label>
			)}
		</div>
	);
}

// ── 主对话框 ─────────────────────────────────────────────────────────────────

export function SettingsDialog({ onClose }: Props) {
	const { settings, update, reset } = useUiSettings();
	const { t } = useI18n();
	const { theme, accent, toggleTheme, setAccent } = useTheme();
	const { soundEnabled, onSoundToggle } = useAudio();
	const [tab, setTab] = useState<SettingsTab>("general");
	const [closing, setClosing] = useState(false);
	// AI 提交信息模型候选列表（来自 /api/models）
	const [models, setModels] = useState<{ value: string; label: string }[]>([]);
	const [modelsError, setModelsError] = useState<string | null>(null);

	// 打开设置时加载模型列表（默认 cwd = 服务端工作目录）
	useEffect(() => {
		let cancelled = false;
		fetch("/api/models", { cache: "no-store" })
			.then((res) =>
				res.ok
					? (res.json() as Promise<{
							modelList?: { id: string; name: string; provider: string }[];
							defaultModel?: { provider: string; modelId: string } | null;
						}>)
					: null,
			)
			.then((data) => {
				if (cancelled || !data?.modelList) {
					if (!cancelled) setModelsError("HTTP error");
					return;
				}
				setModelsError(null);
				setModels(
					data.modelList.map((m) => ({
						value: `${m.provider}/${m.id}`,
						label: `${m.provider} · ${m.name || m.id}`,
					})),
				);
			})
			.catch(() => {
				if (!cancelled) setModelsError("Network error");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// 关闭时先播放退出动画再真正卸载（动画强度为 none 时直接关闭）
	const requestClose = useCallback(() => {
		if (settings.animationIntensity === "none") {
			onClose();
			return;
		}
		setClosing(true);
		setTimeout(onClose, settings.animationIntensity === "smooth" ? 220 : 170);
	}, [onClose, settings.animationIntensity]);

	const popDuration =
		settings.animationIntensity === "smooth" ? "190ms" : "130ms";

	// 桌面通知开关：开启时先请求浏览器权限
	const handleNotificationsToggle = useCallback(
		(v: boolean) => {
			if (!v) {
				update({ desktopNotifications: false });
				return;
			}
			if (typeof Notification === "undefined") {
				update({ desktopNotifications: false });
				return;
			}
			if (Notification.permission === "granted") {
				update({ desktopNotifications: true });
				return;
			}
			if (Notification.permission === "denied") {
				update({ desktopNotifications: false });
				return;
			}
			void Notification.requestPermission().then((perm) => {
				update({ desktopNotifications: perm === "granted" });
			});
		},
		[update],
	);

	const notifPermission =
		typeof Notification === "undefined"
			? "unsupported"
			: Notification.permission;

	const handleFontSize = useCallback(
		(size: FontSize) => update({ fontSize: size }),
		[update],
	);

	const handleTheme = useCallback(
		(target: "light" | "dark") => {
			if (theme !== target) toggleTheme();
		},
		[theme, toggleTheme],
	);

	return (
		<div
			className={`dialog-backdrop${closing ? " closing" : ""}`}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 4900,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0,0,0,0.4)",
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) requestClose();
			}}
		>
			<div
				className={`dialog-pop${closing ? " dialog-pop-out" : ""}`}
				style={{
					animationDuration: popDuration,
					width: 500,
					maxWidth: "calc(100vw - 32px)",
					maxHeight: "min(80vh, calc(100vh - 32px))",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: 12,
					boxShadow: "0 12px 40px -8px rgba(0,0,0,0.4)",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				{/* Header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "12px 16px",
						borderBottom: "1px solid var(--border)",
						flexShrink: 0,
					}}
				>
					<div style={{ color: "var(--text)", fontWeight: 700, fontSize: 14 }}>
						{t("settings.title")}
					</div>
					<button
						type="button"
						onClick={requestClose}
						style={{
							border: "none",
							background: "none",
							color: "var(--text-dim)",
							cursor: "pointer",
							fontSize: 16,
							lineHeight: 1,
							padding: 4,
						}}
						aria-label={t("settings.close")}
					>
						✕
					</button>
				</div>

				{/* Tab bar */}
				<div
					role="tablist"
					style={{
						display: "flex",
						gap: 2,
						padding: "0 8px",
						borderBottom: "1px solid var(--border)",
						background: "var(--bg-panel)",
						flexShrink: 0,
					}}
				>
					<TabButton
						label={t("settings.tabGeneral")}
						active={tab === "general"}
						onClick={() => setTab("general")}
					/>
					<TabButton
						label={t("settings.tabAppearance")}
						active={tab === "appearance"}
						onClick={() => setTab("appearance")}
					/>
					<TabButton
						label={t("settings.tabUsage")}
						active={tab === "usage"}
						onClick={() => setTab("usage")}
					/>
					<TabButton
						label={t("settings.tabGit")}
						active={tab === "git"}
						onClick={() => setTab("git")}
					/>
				</div>

				{/* Content */}
				{tab === "general" && (
					<div style={{ padding: "4px 16px 14px", overflowY: "auto" }}>
						<SectionTitle>{t("settings.streaming")}</SectionTitle>
						<ToggleRow
							label={t("settings.autoScroll")}
							desc={t("settings.autoScrollDesc")}
							checked={settings.autoScroll}
							onChange={(v) => update({ autoScroll: v })}
						/>
						<ToggleRow
							label={t("settings.charAnimation")}
							desc={t("settings.charAnimationDesc")}
							checked={settings.charAnimation}
							onChange={(v) => update({ charAnimation: v })}
						/>
						<ToggleRow
							label={t("settings.thinkingAutoExpand")}
							desc={t("settings.thinkingAutoExpandDesc")}
							checked={settings.thinkingAutoExpand}
							onChange={(v) => update({ thinkingAutoExpand: v })}
						/>

						<SectionTitle>{t("settings.animationIntensity")}</SectionTitle>
						<div style={{ display: "flex", gap: 8 }}>
							<OptionButton
								label={t("settings.intensitySmooth")}
								active={settings.animationIntensity === "smooth"}
								onClick={() => update({ animationIntensity: "smooth" })}
							/>
							<OptionButton
								label={t("settings.intensityStandard")}
								active={settings.animationIntensity === "standard"}
								onClick={() => update({ animationIntensity: "standard" })}
							/>
							<OptionButton
								label={t("settings.intensityNone")}
								active={settings.animationIntensity === "none"}
								onClick={() => update({ animationIntensity: "none" })}
							/>
						</div>

						<SectionTitle>{t("settings.notifications")}</SectionTitle>
						<ToggleRow
							label={t("settings.completionSound")}
							desc={t("settings.completionSoundDesc")}
							checked={soundEnabled}
							onChange={() => onSoundToggle()}
						/>
						<ToggleRow
							label={t("settings.desktopNotifications")}
							desc={
								notifPermission === "denied"
									? t("settings.notificationsDenied")
									: notifPermission === "default"
										? t("settings.notificationsPrompt")
										: t("settings.desktopNotificationsDesc")
							}
							checked={settings.desktopNotifications}
							onChange={handleNotificationsToggle}
							disabled={notifPermission === "denied"}
						/>

						<div
							style={{
								paddingTop: 14,
								display: "flex",
								justifyContent: "flex-end",
							}}
						>
							<button
								type="button"
								onClick={reset}
								style={{
									border: "1px solid var(--border)",
									background: "var(--bg-panel)",
									color: "var(--text-muted)",
									borderRadius: 7,
									padding: "6px 14px",
									fontSize: 12,
									cursor: "pointer",
								}}
							>
								{t("settings.reset")}
							</button>
						</div>
					</div>
				)}

				{tab === "appearance" && (
					<div style={{ padding: "4px 16px 14px", overflowY: "auto" }}>
						<SectionTitle>{t("settings.theme")}</SectionTitle>
						<div style={{ display: "flex", gap: 8 }}>
							<OptionButton
								label={t("settings.themeLight")}
								active={theme === "light"}
								onClick={() => handleTheme("light")}
							/>
							<OptionButton
								label={t("settings.themeDark")}
								active={theme === "dark"}
								onClick={() => handleTheme("dark")}
							/>
						</div>

						<SectionTitle>{t("settings.accent")}</SectionTitle>
						<AccentSwatches
							accent={accent}
							onPick={setAccent}
							customLabel={t("settings.accentCustom")}
						/>

						<SectionTitle>{t("settings.fontSize")}</SectionTitle>
						<div style={{ display: "flex", gap: 8 }}>
							<OptionButton
								label={t("settings.fontSizeCompact")}
								active={settings.fontSize === "compact"}
								onClick={() => handleFontSize("compact")}
							/>
							<OptionButton
								label={t("settings.fontSizeNormal")}
								active={settings.fontSize === "normal"}
								onClick={() => handleFontSize("normal")}
							/>
							<OptionButton
								label={t("settings.fontSizeComfortable")}
								active={settings.fontSize === "comfortable"}
								onClick={() => handleFontSize("comfortable")}
							/>
						</div>
					</div>
				)}

				{tab === "usage" && (
					<div
						style={{
							padding: "12px 16px 14px",
							overflowY: "auto",
							flex: 1,
							minHeight: 0,
						}}
					>
						<UsageStats />
					</div>
				)}

				{tab === "git" && (
					<div style={{ padding: "4px 16px 14px", overflowY: "auto" }}>
						<SectionTitle>{t("git.aiCommit")}</SectionTitle>

						<div
							style={{ fontSize: 12.5, color: "var(--text)", paddingTop: 8 }}
						>
							{t("git.aiModel")}
						</div>
						<div
							style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}
						>
							{t("git.aiModelDesc")}
						</div>
						<select
							value={settings.gitAiModel}
							onChange={(e) => update({ gitAiModel: e.target.value })}
							style={{
								width: "100%",
								marginTop: 8,
								padding: "7px 10px",
								borderRadius: 7,
								border: "1px solid var(--border)",
								background: "var(--bg-panel)",
								color: "var(--text)",
								fontSize: 12,
							}}
						>
							<option value="">{t("git.aiModelDefault")}</option>
							{models.map((m) => (
								<option key={m.value} value={m.value}>
									{m.label}
								</option>
							))}
						</select>
						{modelsError && models.length === 0 && (
							<div
								style={{
									color: "var(--warning)",
									fontSize: 11,
									marginTop: 6,
								}}
							>
								{t("git.aiModelLoadError")}
							</div>
						)}

						<div
							style={{ fontSize: 12.5, color: "var(--text)", paddingTop: 14 }}
						>
							{t("git.aiMaxTokens")}
						</div>
						<div
							style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}
						>
							{t("git.aiMaxTokensDesc")}
						</div>
						<input
							type="number"
							min={1}
							step={10000}
							value={settings.gitAiMaxTokens}
							onChange={(e) => {
								const n = Number(e.target.value);
								update({
									gitAiMaxTokens:
										Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
								});
							}}
							style={{
								width: "100%",
								marginTop: 8,
								padding: "7px 10px",
								borderRadius: 7,
								border: "1px solid var(--border)",
								background: "var(--bg-panel)",
								color: "var(--text)",
								fontSize: 12,
							}}
						/>

						<div
							style={{ fontSize: 12.5, color: "var(--text)", paddingTop: 14 }}
						>
							{t("git.aiPrompt")}
						</div>
						<div
							style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}
						>
							{t("git.aiPromptDesc")}
						</div>
						<textarea
							value={settings.gitAiPrompt}
							onChange={(e) => update({ gitAiPrompt: e.target.value })}
							placeholder={t("git.aiPromptPlaceholder")}
							style={{
								width: "100%",
								minHeight: 96,
								marginTop: 8,
								padding: "8px 10px",
								borderRadius: 7,
								border: "1px solid var(--border)",
								background: "var(--bg-panel)",
								color: "var(--text)",
								fontSize: 11.5,
								fontFamily: "var(--font-mono)",
								resize: "vertical",
								lineHeight: 1.5,
							}}
						/>
						<div
							style={{
								paddingTop: 8,
								display: "flex",
								justifyContent: "flex-end",
							}}
						>
							<button
								type="button"
								onClick={() => update({ gitAiPrompt: "", gitAiModel: "" })}
								style={{
									border: "1px solid var(--border)",
									background: "var(--bg-panel)",
									color: "var(--text-muted)",
									borderRadius: 7,
									padding: "6px 14px",
									fontSize: 12,
									cursor: "pointer",
								}}
							>
								{t("git.aiPromptReset")}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * 订阅模块级 store 的宿主组件：只有它自己重渲染，
 * 打开/关闭不会触发 AppShell 整树重渲染（消除点击卡顿）
 */
export function SettingsDialogHost() {
	const [, force] = useReducer((x: number) => x + 1, 0);
	useEffect(() => settingsDialogStore.subscribe(() => force()), []);
	return settingsDialogStore.isOpen() ? (
		<SettingsDialog onClose={() => settingsDialogStore.close()} />
	) : null;
}
