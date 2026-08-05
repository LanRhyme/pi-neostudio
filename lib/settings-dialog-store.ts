"use client";

// 模块级设置对话框开关 store：
// 打开/关闭不经过 React state，避免触发 AppShell 整树重渲染导致的点击卡顿

let isOpen = false;
const listeners = new Set<() => void>();

export const settingsDialogStore = {
  isOpen: (): boolean => isOpen,
  open: (): void => {
    isOpen = true;
    listeners.forEach((l) => l());
  },
  close: (): void => {
    isOpen = false;
    listeners.forEach((l) => l());
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
