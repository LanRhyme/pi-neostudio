"use client";

import { useState, useRef, useCallback, useEffect } from "react";

function playTone(ctx: AudioContext) {
	const now = ctx.currentTime;
	const freqs = [523.25, 659.25];
	freqs.forEach((freq, i) => {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.type = "sine";
		osc.frequency.value = freq;
		const t = now + i * 0.18;
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
		osc.start(t);
		osc.stop(t + 0.45);
	});
}

export const SOUND_STORAGE_KEY = "pi-sound-enabled";

function readSoundEnabled(): boolean {
	if (typeof window === "undefined") return true;
	const stored = localStorage.getItem(SOUND_STORAGE_KEY);
	return stored === null ? true : stored === "true";
}

/** 通知其他 useAudio 实例（设置面板 ↔ 输入栏按钮）同步状态 */
export function notifySoundChanged(): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new Event("pi-sound-changed"));
}

export function useAudio() {
	const [enabled, setEnabled] = useState<boolean>(readSoundEnabled);

	// 同步来自其他实例（如设置面板）的开关变化
	useEffect(() => {
		const handler = () => setEnabled(readSoundEnabled());
		window.addEventListener("pi-sound-changed", handler);
		return () => window.removeEventListener("pi-sound-changed", handler);
	}, []);

	const enabledRef = useRef(enabled);
	useEffect(() => {
		enabledRef.current = enabled;
	}, [enabled]);

	// Reuse a single AudioContext so it can be resumed if the browser
	// autoplay policy suspends it (contexts created outside user gestures
	// start in "suspended" state and produce no sound).
	const ctxRef = useRef<AudioContext | null>(null);
	const getCtx = useCallback((): AudioContext | null => {
		if (ctxRef.current && ctxRef.current.state !== "closed")
			return ctxRef.current;
		try {
			ctxRef.current = new AudioContext();
		} catch {
			return null;
		}
		return ctxRef.current;
	}, []);

	const unlockAudio = useCallback(
		(force = false) => {
			if (!force && !enabledRef.current) return;
			const ctx = getCtx();
			if (!ctx || ctx.state !== "suspended") return;
			ctx.resume().catch(() => {});
		},
		[getCtx],
	);

	const toggle = useCallback(() => {
		const next = !enabledRef.current;
		if (next) unlockAudio(true);
		enabledRef.current = next;
		localStorage.setItem(SOUND_STORAGE_KEY, String(next));
		setEnabled(next);
		notifySoundChanged();
	}, [unlockAudio]);

	const playDone = useCallback(() => {
		if (!enabledRef.current) return;
		const ctx = getCtx();
		if (!ctx) return;
		const play = () => {
			try {
				playTone(ctx);
			} catch {
				// AudioContext not available
			}
		};
		if (ctx.state === "suspended") {
			ctx
				.resume()
				.then(play)
				.catch(() => {});
			return;
		}
		play();
	}, [getCtx]);

	return {
		soundEnabled: enabled,
		onSoundToggle: toggle,
		playDoneSound: playDone,
		unlockAudio,
		soundEnabledRef: enabledRef,
	};
}
