"use client";

import {
	createContext,
	useCallback,
	useContext,
	useState,
	type ReactNode,
} from "react";

export interface UiSettings {
	/** 思考内容流式时自动展开，结束后自动收起 */
	thinkingAutoExpand: boolean;
	/** 流式输出逐字渐显动画 */
	charAnimation: boolean;
	/** 流式输出自动滚动跟随 */
	autoScroll: boolean;
	/** 动画强度：smooth 柔和 / standard 标准 / none 关闭 */
	animationIntensity: "smooth" | "standard" | "none";
}

const DEFAULT_SETTINGS: UiSettings = {
	thinkingAutoExpand: true,
	charAnimation: true,
	autoScroll: true,
	animationIntensity: "standard",
};

const STORAGE_KEY = "pi-ui-settings";

interface UiSettingsContextValue {
	settings: UiSettings;
	update: (patch: Partial<UiSettings>) => void;
	reset: () => void;
}

const UiSettingsContext = createContext<UiSettingsContextValue>({
	settings: DEFAULT_SETTINGS,
	update: () => {},
	reset: () => {},
});

function loadSettings(): UiSettings {
	if (typeof window === "undefined") return DEFAULT_SETTINGS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_SETTINGS;
		const parsed = JSON.parse(raw) as Partial<UiSettings>;
		return { ...DEFAULT_SETTINGS, ...parsed };
	} catch {
		return DEFAULT_SETTINGS;
	}
}

export function UiSettingsProvider({ children }: { children: ReactNode }) {
	const [settings, setSettings] = useState<UiSettings>(loadSettings);

	const update = useCallback((patch: Partial<UiSettings>) => {
		setSettings((prev) => {
			const next = { ...prev, ...patch };
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				/* ignore */
			}
			return next;
		});
	}, []);

	const reset = useCallback(() => {
		setSettings(DEFAULT_SETTINGS);
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* ignore */
		}
	}, []);

	return (
		<UiSettingsContext.Provider value={{ settings, update, reset }}>
			{children}
		</UiSettingsContext.Provider>
	);
}

export function useUiSettings(): UiSettingsContextValue {
	return useContext(UiSettingsContext);
}
