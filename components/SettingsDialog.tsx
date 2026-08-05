"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useUiSettings } from "@/hooks/useUiSettings";
import { useI18n } from "@/hooks/useI18n";
import { settingsDialogStore } from "@/lib/settings-dialog-store";

interface Props {
	onClose: () => void;
}

function ToggleRow({
	label,
	desc,
	checked,
	onChange,
}: {
	label: string;
	desc: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 16,
				padding: "10px 0",
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
				onClick={() => onChange(!checked)}
				style={{
					flexShrink: 0,
					width: 38,
					height: 22,
					borderRadius: 999,
					border: "none",
					cursor: "pointer",
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

function IntensityOption({
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

export function SettingsDialog({ onClose }: Props) {
	const { settings, update, reset } = useUiSettings();
	const { t } = useI18n();
	const [closing, setClosing] = useState(false);

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
					width: 460,
					maxWidth: "calc(100vw - 32px)",
					maxHeight: "min(78vh, calc(100vh - 32px))",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: 12,
					boxShadow: "0 12px 40px -8px rgba(0,0,0,0.4)",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
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

				<div style={{ padding: "4px 16px 14px", overflowY: "auto" }}>
					<div
						style={{
							color: "var(--text-muted)",
							fontSize: 11,
							fontWeight: 600,
							letterSpacing: "0.06em",
							paddingTop: 10,
						}}
					>
						{t("settings.streaming")}
					</div>
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

					<div
						style={{
							color: "var(--text-muted)",
							fontSize: 11,
							fontWeight: 600,
							letterSpacing: "0.06em",
							paddingTop: 14,
							paddingBottom: 6,
						}}
					>
						{t("settings.animationIntensity")}
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<IntensityOption
							label={t("settings.intensitySmooth")}
							active={settings.animationIntensity === "smooth"}
							onClick={() => update({ animationIntensity: "smooth" })}
						/>
						<IntensityOption
							label={t("settings.intensityStandard")}
							active={settings.animationIntensity === "standard"}
							onClick={() => update({ animationIntensity: "standard" })}
						/>
						<IntensityOption
							label={t("settings.intensityNone")}
							active={settings.animationIntensity === "none"}
							onClick={() => update({ animationIntensity: "none" })}
						/>
					</div>

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
