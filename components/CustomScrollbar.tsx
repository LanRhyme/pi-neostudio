"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CustomScrollbarProps {
	/** 目标滚动容器 */
	containerRef: React.RefObject<HTMLElement | null>;
	/** 距容器右缘的距离 */
	right?: number;
	/** 滚动条宽度 */
	width?: number;
	zIndex?: number;
}

/**
 * 自定义主题滚动条：替代原生 webkit/gecko 滚动条，贴合软件主题。
 * 使用 CSS 变量配色，支持拖拽滑块、点击轨道跳转、悬停高亮。
 * 必须放在滚动容器的兄弟节点（position 相对外层非滚动容器）。
 */
export function CustomScrollbar({
	containerRef,
	right = 0,
	width = 8,
	zIndex = 40,
}: CustomScrollbarProps) {
	const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
		null,
	);
	const [hover, setHover] = useState(false);
	const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(
		null,
	);
	const thumbRef = useRef<{ top: number; height: number } | null>(null);
	thumbRef.current = thumb;

	const update = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const { scrollTop, clientHeight, scrollHeight } = el;
		if (scrollHeight <= clientHeight + 1) {
			setThumb(null);
			return;
		}
		const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
		const maxTop = clientHeight - height;
		const top = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
		setThumb({ top, height });
	}, [containerRef]);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		update();
		let raf = 0;
		const onScroll = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				update();
			});
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		const ro = new ResizeObserver(onScroll);
		ro.observe(el);
		return () => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
			if (raf) cancelAnimationFrame(raf);
		};
	}, [containerRef, update]);

	if (!thumb) return null;

	const trackClick = (e: React.MouseEvent) => {
		const el = containerRef.current;
		if (!el) return;
		if (e.target !== e.currentTarget) return; // 点击滑块由滑块自身处理
		const rect = el.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const ratio =
			(y - thumb.height / 2) / Math.max(1, el.clientHeight - thumb.height);
		el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
	};

	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				bottom: 0,
				right,
				width,
				zIndex,
				pointerEvents: "none",
				opacity: hover ? 1 : 0.7,
				transition: "opacity 0.15s",
			}}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
		>
			{/* 轨道：悬停时显示 */}
			<div
				onMouseDown={trackClick}
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					left: 0,
					width: "100%",
					background: hover
						? "color-mix(in srgb, var(--border) 50%, transparent)"
						: "transparent",
					borderRadius: width / 2,
					transition: "background 0.15s",
					pointerEvents: "auto",
				}}
			/>
			{/* 滑块 */}
			<div
				onMouseDown={(e) => {
					const el = containerRef.current;
					if (!el) return;
					e.preventDefault();
					e.stopPropagation();
					dragRef.current = { startY: e.clientY, startScrollTop: el.scrollTop };
					const onMove = (ev: MouseEvent) => {
						const d = dragRef.current;
						const c = containerRef.current;
						const t = thumbRef.current;
						if (!d || !c || !t) return;
						const ratio =
							(c.scrollHeight - c.clientHeight) /
							Math.max(1, c.clientHeight - t.height);
						c.scrollTop = d.startScrollTop + (ev.clientY - d.startY) * ratio;
					};
					const onUp = () => {
						dragRef.current = null;
						window.removeEventListener("mousemove", onMove);
						window.removeEventListener("mouseup", onUp);
					};
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
				}}
				style={{
					position: "absolute",
					top: thumb.top,
					height: thumb.height,
					left: 0,
					width: "100%",
					borderRadius: width / 2,
					background: hover
						? "color-mix(in srgb, var(--text-muted) 85%, transparent)"
						: "color-mix(in srgb, var(--text-dim) 45%, transparent)",
					cursor: "pointer",
					pointerEvents: "auto",
					transition: "background 0.15s",
				}}
			/>
		</div>
	);
}
