"use client";

import { useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

export type Accent = "sage" | "mist" | "mauve" | "clay" | "rose" | "olive" | "slate" | "custom";

// 莫兰迪低饱和色系（light 主色 / 深色模式用更亮的变体）
export const ACCENTS: { id: Accent; name: string; color: string }[] = [
  { id: "sage", name: "鼠尾草绿", color: "#6e7f5a" },
  { id: "mist", name: "雾蓝", color: "#5d7a8c" },
  { id: "mauve", name: "灰紫", color: "#7a6a8f" },
  { id: "clay", name: "陶土", color: "#a06a55" },
  { id: "rose", name: "干玫瑰", color: "#9d6b6b" },
  { id: "olive", name: "橄榄绿", color: "#74775a" },
  { id: "slate", name: "灰青", color: "#587a74" },
  { id: "custom", name: "自定义", color: "#888888" },
];

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function getAccentSnapshot(): Accent {
  if (typeof document === "undefined") return "sage";
  const stored = document.documentElement.dataset.accent as Accent | undefined;
  if (stored && ACCENTS.some((a) => a.id === stored)) return stored;
  return "sage";
}

function getServerAccentSnapshot(): Accent {
  return "sage";
}

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const accent = useSyncExternalStore(subscribe, getAccentSnapshot, getServerAccentSnapshot);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";

    const apply = () => {
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      try {
        localStorage.setItem("pi-theme", next);
      } catch {
        // ignore storage errors (private mode, quota, etc.)
      }
      listeners.forEach((cb) => cb());
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  const setAccent = useCallback((next: Accent, customHex?: string) => {
    document.documentElement.dataset.accent = next;
    if (next === "custom" && customHex) {
      document.documentElement.style.setProperty("--accent-custom", customHex);
      try {
        localStorage.setItem("pi-accent-custom", customHex);
      } catch {
        // ignore storage errors
      }
    }
    try {
      localStorage.setItem("pi-accent", next);
    } catch {
      // ignore storage errors
    }
    listeners.forEach((cb) => cb());
  }, []);

  return { theme, accent, toggleTheme, setAccent, isDark: theme === "dark" };
}
