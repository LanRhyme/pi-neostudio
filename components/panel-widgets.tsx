"use client";

import { useSyncExternalStore, useEffect, type ReactNode } from "react";
import { uiPanelStore } from "@/lib/ui-panel-store";
import { useI18n } from "@/hooks/useI18n";

// 面板开关订阅组件：各自通过 useSyncExternalStore 订阅模块级 store，
// 开关时只有这些轻量组件重渲染，AppShell 整树不动（消除点击卡顿）

export function SidebarToggleButton({ size }: { size: number }) {
	const open = useSyncExternalStore(
		uiPanelStore.subscribe,
		uiPanelStore.isSidebarOpen,
		uiPanelStore.isSidebarOpen,
	);
	const { t } = useI18n();
	return (
		<button
			onClick={() => uiPanelStore.toggleSidebar()}
			title={open ? t("sidebar.hide") : t("sidebar.show")}
			aria-label={open ? t("sidebar.hide") : t("sidebar.show")}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: size,
				height: size,
				padding: 0,
				background: "none",
				border: "none",
				borderRight: "1px solid var(--border)",
				color: "var(--text-muted)",
				cursor: "pointer",
				flexShrink: 0,
				transition: "color 0.12s",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.color = "var(--text)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.color = "var(--text-muted)";
			}}
		>
			{open ? (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<line x1="9" y1="3" x2="9" y2="21" />
				</svg>
			) : (
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				>
					<line x1="3" y1="6" x2="21" y2="6" />
					<line x1="3" y1="12" x2="21" y2="12" />
					<line x1="3" y1="18" x2="21" y2="18" />
				</svg>
			)}
		</button>
	);
}

export function SidebarOverlay({ mobilePending }: { mobilePending: boolean }) {
	const open = useSyncExternalStore(
		uiPanelStore.subscribe,
		uiPanelStore.isSidebarOpen,
		uiPanelStore.isSidebarOpen,
	);
	return (
		<div
			className={`sidebar-overlay-backdrop${mobilePending ? "" : " sidebar-mobile-pending"}`}
			onClick={() => uiPanelStore.setSidebarOpen(false)}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 199,
				background: "rgba(0,0,0,0.4)",
				opacity: open ? 1 : 0,
				pointerEvents: open ? "auto" : "none",
				transition: "opacity 280ms cubic-bezier(0.2, 0, 0, 1)",
			}}
		/>
	);
}

export function SidebarPanel({
	mobilePending,
	resizing,
	panelRef,
	separatorProps,
	width,
	separatorTitle,
	className,
	children,
}: {
	mobilePending: boolean;
	resizing: boolean;
	panelRef: React.Ref<HTMLDivElement>;
	separatorProps: React.HTMLAttributes<HTMLDivElement> & {
		ref?: React.Ref<HTMLDivElement>;
	};
	width: number;
	separatorTitle: string;
	className?: string;
	children: ReactNode;
}) {
	const open = useSyncExternalStore(
		uiPanelStore.subscribe,
		uiPanelStore.isSidebarOpen,
		uiPanelStore.isSidebarOpen,
	);
	return (
		<>
			<div
				ref={panelRef}
				id="session-sidebar"
				className={`sidebar-container${open ? " sidebar-open" : " sidebar-closed"}${mobilePending ? "" : " sidebar-mobile-pending"}${resizing ? " sidebar-resizing" : ""}${className ? ` ${className}` : ""}`}
				style={
					{
						"--sidebar-width": `${width}px`,
						background: "var(--bg-panel)",
						display: "flex",
						flexDirection: "column",
						flexShrink: 0,
						paddingTop: "env(safe-area-inset-top)",
						paddingBottom: "env(safe-area-inset-bottom)",
						zIndex: 200,
					} as React.CSSProperties
				}
			>
				{children}
			</div>
			<div
				{...separatorProps}
				suppressHydrationWarning
				aria-controls="session-sidebar"
				className={`panel-resize-handle sidebar-resize-handle${resizing ? " is-resizing" : ""}`}
				data-resize-handle="sidebar"
				title={separatorTitle}
				style={{
					flexShrink: 0,
					opacity: open ? 1 : 0,
					pointerEvents: open ? "auto" : "none",
					transition: "opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)",
				}}
			/>
		</>
	);
}

export function RightPanelSeparator({
  resizing,
  separatorProps,
  separatorTitle,
}: {
  resizing: boolean;
  separatorProps: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
  separatorTitle: string;
}) {
  const open = useSyncExternalStore(uiPanelStore.subscribe, uiPanelStore.isRightPanelOpen, uiPanelStore.isRightPanelOpen);
  return (
    <div
      {...separatorProps}
      suppressHydrationWarning
      aria-controls="file-panel"
      className={`panel-resize-handle right-panel-resize-handle${resizing ? " is-resizing" : ""}`}
      data-resize-handle="right-panel"
      title={separatorTitle}
      style={{
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition: "opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    />
  );
}

export function RightPanelOverlay() {
	const open = useSyncExternalStore(
		uiPanelStore.subscribe,
		uiPanelStore.isRightPanelOpen,
		uiPanelStore.isRightPanelOpen,
	);
	return (
		<div
			aria-hidden="true"
			className={`right-panel-overlay-backdrop${open ? " is-open" : ""}`}
			onClick={() => uiPanelStore.setRightPanelOpen(false)}
		/>
	);
}

export function RightPanelContainer({
	resizing,
	panelRef,
	children,
}: {
	resizing: boolean;
	panelRef: React.Ref<HTMLDivElement>;
	children: ReactNode;
}) {
	const open = useSyncExternalStore(
		uiPanelStore.subscribe,
		uiPanelStore.isRightPanelOpen,
		uiPanelStore.isRightPanelOpen,
	);
	// 同步 data 属性供 CSS/其他组件读取（如顶栏按钮 padding）
	useEffect(() => {
		document.documentElement.dataset.rightPanelOpen = open ? "true" : "false";
	}, [open]);
	return (
		<div
			ref={panelRef}
			id="file-panel"
			className={`right-panel-container${open ? " right-panel-open" : " right-panel-closed"}${resizing ? " right-panel-resizing" : ""}`}
			style={{
				display: "flex",
				flexDirection: "column",
				background: "var(--bg)",
			}}
		>
			{children}
		</div>
	);
}

export function RightPanelToggleButton() {
	const open = useSyncExternalStore(
		uiPanelStore.subscribe,
		uiPanelStore.isRightPanelOpen,
		uiPanelStore.isRightPanelOpen,
	);
	const { t } = useI18n();
	return (
		<button
			onClick={() => uiPanelStore.toggleRightPanel()}
			aria-controls="file-panel"
			aria-expanded={open}
			title={open ? t("files.hidePanel") : t("files.showPanel")}
			aria-label={open ? t("files.hidePanel") : t("files.showPanel")}
			style={{
				position: "fixed",
				top: "env(safe-area-inset-top)",
				right: "env(safe-area-inset-right)",
				zIndex: 300,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: 36,
				height: 36,
				padding: 0,
				background: "var(--bg-panel)",
				border: "none",
				borderLeft: "1px solid var(--border)",
				borderBottom: "1px solid var(--border)",
				color: open ? "var(--text)" : "var(--text-muted)",
				cursor: "pointer",
				transition: "color 0.12s",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.color = "var(--text)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.color = open
					? "var(--text)"
					: "var(--text-muted)";
			}}
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<line x1="15" y1="3" x2="15" y2="21" />
			</svg>
		</button>
	);
}
