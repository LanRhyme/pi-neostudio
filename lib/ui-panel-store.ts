"use client";

// 模块级侧边栏/右面板开关 store：
// 打开/关闭不经过 React state，只有订阅的面板组件重渲染，
// 避免 AppShell 整树重渲染导致的点击卡顿

let sidebarOpen = true;
let rightPanelOpen = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export const uiPanelStore = {
  isSidebarOpen: (): boolean => sidebarOpen,
  isRightPanelOpen: (): boolean => rightPanelOpen,
  setSidebarOpen: (v: boolean): void => {
    if (sidebarOpen === v) return;
    sidebarOpen = v;
    notify();
  },
  toggleSidebar: (): void => {
    sidebarOpen = !sidebarOpen;
    notify();
  },
  setRightPanelOpen: (v: boolean): void => {
    if (rightPanelOpen === v) return;
    rightPanelOpen = v;
    notify();
  },
  toggleRightPanel: (): void => {
    rightPanelOpen = !rightPanelOpen;
    notify();
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
