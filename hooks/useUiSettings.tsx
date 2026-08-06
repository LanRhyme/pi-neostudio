"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

export type FontSize = "compact" | "normal" | "comfortable";

export interface UiSettings {
	/** 思考内容流式时自动展开，结束后自动收起 */
	thinkingAutoExpand: boolean;
	/** 流式输出逐字渐显动画 */
	charAnimation: boolean;
	/** 流式输出自动滚动跟随 */
	autoScroll: boolean;
	/** 动画强度：smooth 柔和 / standard 标准 / none 关闭 */
	animationIntensity: "smooth" | "standard" | "none";
	/** 消息区字体大小：compact 紧凑 / normal 标准 / comfortable 舒适 */
	fontSize: FontSize;
	/** Agent 完成时发送桌面通知（仅窗口不可见时） */
	desktopNotifications: boolean;
	/** AI 生成提交信息的自定义提示词模板，可用 {diff} 占位符；空 = 使用内置默认 */
	gitAiPrompt: string;
	/** AI 生成提交信息使用的模型 "provider/modelId"；空 = 使用默认模型 */
	gitAiModel: string;
	/** AI 生成提交信息的 maxTokens 上限；默认 1000000（思考型模型推理需要大预算） */
	gitAiMaxTokens: number;
}

const DEFAULT_SETTINGS: UiSettings = {
	thinkingAutoExpand: true,
	charAnimation: true,
	autoScroll: true,
	animationIntensity: "standard",
	fontSize: "normal",
	desktopNotifications: false,
	gitAiPrompt: "",
	gitAiModel: "",
	gitAiMaxTokens: 1_000_000,
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

	// 把字体大小同步到根元素，CSS 通过 data-font-size 调整消息字号
	useEffect(() => {
		document.documentElement.setAttribute("data-font-size", settings.fontSize);
	}, [settings.fontSize]);

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
