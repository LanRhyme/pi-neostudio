"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { AssistantMessage, SessionEntry, SessionTreeNode } from "@/lib/types";
import { splitFinalAssistantBlocks } from "@/lib/message-display";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** When inline, use this ref's bounding rect to size/position the dropdown */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state for inline mode */
  open?: boolean;
  /** Called when the button is clicked in inline mode */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** When inline, render icon-only (no text label) to save horizontal space */
  compact?: boolean;
}

// Find the visible entry IDs on the path from root to activeLeafId.
function buildActivePath(nodes: SessionTreeNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();
  const target = targetId;
  function search(nodes: SessionTreeNode[], path: string[]): string[] | null {
    for (const node of nodes) {
      const next = [...path, node.entry.id];
      if (node.entry.id === target || node.compressedEntryIds?.includes(target)) {
        return next;
      }
      const found = search(node.children, next);
      if (found) return found;
    }
    return null;
  }
  return new Set(search(nodes, []) ?? []);
}

// Compress a visible linear chain into the first branching/leaf node.
// Server-side compressed IDs also count as skipped nodes.
function compress(node: SessionTreeNode): { node: SessionTreeNode; skipped: number } {
  let current = node;
  let skipped = current.compressedEntryIds?.length ?? 0;
  // 用户消息是对话导航点：即使整条会话线性无分支，也在每个用户消息处停下，
  // 让分支树能逐段回溯到早期对话
  while (current.children.length === 1 && !isUserMessageNode(current)) {
    current = current.children[0];
    skipped += 1 + (current.compressedEntryIds?.length ?? 0);
  }
  return { node: current, skipped };
}

function getLabel(entry: SessionEntry): string {
  if (entry.type === "message" && "message" in entry) {
    const msg = entry.message as { role: string; content: string | Array<{ type: string; text?: string }> };
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      if (msg.role === "assistant") {
        // 优先取最终回答文本（跳过思考块与工具调用过程）
        const { answerBlocks } = splitFinalAssistantBlocks(entry.message as AssistantMessage);
        text = answerBlocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(" ");
      }
      if (!text.trim()) {
        text = msg.content
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join(" ");
      }
    }
    text = text.trim();
    if (text.length > 40) text = text.slice(0, 40) + "…";
    if (text) return text;
    if (msg.role === "assistant") return "[assistant]";
    if (msg.role === "user") return "[user]";
  }
  return entry.type;
}

function isUserMessageNode(node: SessionTreeNode): boolean {
  return node.entry.type === "message" && "message" in node.entry
    ? (node.entry.message as { role?: string }).role === "user"
    : false;
}

// 对话树分段显示：初始行数、自动展开上限、每页增量
const INITIAL_ROWS = 100;
const MAX_AUTO_EXPAND_ROWS = 500;
const ROWS_PER_PAGE = 100;

/** 按渲染顺序（深度优先，与 TreeNodeView 一致）计算活动叶子所在的行号，单次遍历 */
function findActiveRow(nodes: SessionTreeNode[], targetId: string | null): number | null {
  if (!targetId) return null;
  let row = 0;
  const walk = (list: SessionTreeNode[]): number | null => {
    for (const node of list) {
      if (node.entry.id === targetId || node.compressedEntryIds?.includes(targetId)) {
        return row;
      }
      row += 1;
      const found = walk(node.children);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(nodes);
}

interface TreeNodeProps {
  node: SessionTreeNode;
  activePathIds: Set<string>;
  depth: number;
  isLast: boolean;
  parentLines: boolean[]; // whether ancestor at each depth has more siblings after
  onSelect: (id: string) => void;
  /** 本节点在渲染序列中的行号（用于分段显示） */
  rowIndex: number;
  visibleRows: number;
  onShowMore: () => void;
  showMoreLabel: string;
}

function TreeNodeView({ node, activePathIds, depth, isLast, parentLines, onSelect, rowIndex, visibleRows, onShowMore, showMoreLabel }: TreeNodeProps) {
  const { node: rep, skipped } = compress(node);
  const isActive = activePathIds.has(rep.entry.id);
  const isOnPath = activePathIds.has(node.entry.id) || activePathIds.has(rep.entry.id);
  const label = getLabel(rep.entry);
  const role = rep.entry.type === "message" && "message" in rep.entry
    ? (rep.entry.message as { role: string }).role
    : null;

  return (
    <div>
      {/* This node row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 24,
          cursor: "pointer",
        }}
        onClick={() => onSelect(rep.entry.id)}
      >
        {/* Indent guide lines */}
        {parentLines.map((hasLine, i) => (
          <div key={i} style={{ width: 16, flexShrink: 0, position: "relative", height: "100%", alignSelf: "stretch" }}>
            {hasLine && (
              <div style={{
                position: "absolute",
                left: 7,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--border)",
              }} />
            )}
          </div>
        ))}

        {/* Branch connector */}
        <div style={{ width: 16, flexShrink: 0, position: "relative", height: "100%", alignSelf: "stretch" }}>
          {/* vertical line up (to parent) */}
          <div style={{
            position: "absolute",
            left: 7,
            top: 0,
            bottom: isLast ? "50%" : 0,
            width: 1,
            background: "var(--border)",
          }} />
          {/* horizontal line to node */}
          <div style={{
            position: "absolute",
            left: 7,
            top: "50%",
            width: 9,
            height: 1,
            background: "var(--border)",
          }} />
        </div>

        {/* Node dot */}
        <div style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flexShrink: 0,
          background: isActive ? "var(--accent)" : isOnPath ? "var(--text-muted)" : "var(--border)",
          border: isActive ? "none" : "1px solid var(--text-dim)",
          marginRight: 6,
          transition: "background 0.12s",
        }} />

        {/* Role badge */}
        {role && (
          <span style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: role === "user" ? "var(--accent)" : "var(--text-dim)",
            background: role === "user" ? "rgba(37,99,235,0.08)" : "var(--bg-hover)",
            border: `1px solid ${role === "user" ? "rgba(37,99,235,0.2)" : "var(--border)"}`,
            borderRadius: 3,
            padding: "0 4px",
            marginRight: 5,
            flexShrink: 0,
            lineHeight: "16px",
          }}>
            {role === "user" ? "U" : "A"}
          </span>
        )}

        {/* Skipped indicator */}
        {skipped > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginRight: 5, flexShrink: 0 }}>
            +{skipped}
          </span>
        )}

        {/* Label */}
        <span style={{
          fontSize: 11,
          color: isActive ? "var(--text)" : isOnPath ? "var(--text-muted)" : "var(--text-dim)",
          fontWeight: isActive ? 500 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}>
          {label}
        </span>
      </div>

      {/* Children — 分段渲染：行号超过预算时显示"显示更多"按钮 */}
      {rep.children.length > 0 &&
        (() => {
          const rendered: React.ReactNode[] = [];
          for (let i = 0; i < rep.children.length && rowIndex + 1 + i < visibleRows; i++) {
            rendered.push(
              <TreeNodeView
                key={rep.children[i].entry.id}
                node={rep.children[i]}
                activePathIds={activePathIds}
                depth={depth + 1}
                isLast={i === rep.children.length - 1}
                parentLines={[...parentLines, !isLast]}
                onSelect={onSelect}
                rowIndex={rowIndex + 1 + i}
                visibleRows={visibleRows}
                onShowMore={onShowMore}
                showMoreLabel={showMoreLabel}
              />,
            );
          }
          if (rendered.length < rep.children.length) {
            rendered.push(
              <div key="show-more" style={{ padding: "4px 0 4px 32px" }}>
                <button
                  onClick={onShowMore}
                  style={{
                    fontSize: 11,
                    color: "var(--accent)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "2px 8px",
                    borderRadius: 5,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(37,99,235,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  {showMoreLabel}
                </button>
              </div>,
            );
          }
          return rendered;
        })()}
    </div>
  );
}

export function BranchNavigator({ tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, compact }: Props) {
  const { t } = useI18n();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // 分段显示：行数预算，打开时自动展开到活动节点所在行（完整显示整个会话）
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);

  useEffect(() => {
    const activeRow = findActiveRow(tree, activeLeafId);
    if (activeRow === null) return;
    setVisibleRows((prev) =>
      Math.max(prev, Math.min(activeRow + 1, MAX_AUTO_EXPAND_ROWS)),
    );
  }, [tree, activeLeafId]);

  const showMoreLabel = t("i18n.showMoreRows");
  const handleShowMore = useCallback(() => {
    setVisibleRows((prev) => prev + ROWS_PER_PAGE);
  }, []);

  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? btnRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [open, inline, containerRef]);

  const activePathIds = useMemo(
    () => buildActivePath(tree, activeLeafId),
    [tree, activeLeafId]
  );

  const handleSelect = useCallback((id: string) => {
    onLeafChange(id);
  }, [onLeafChange]);

  const noSessionReason = !hasSession ? t("i18n.noActiveSession") : null;

  // 从根部压缩到第一个导航点（用户消息或分支点），线性会话也能逐段回溯
  const compressed = tree.length > 0 ? compress(tree[0]) : null;
  const firstNode = compressed?.node ?? null;
  const hasContent = !noSessionReason && firstNode !== null;

  const branchIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: hasContent ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );

  const chevron = (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );


  if (inline) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "stretch" }}>
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: "100%",
            padding: "0 12px",
            background: open ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: "pointer",
            color: open ? "var(--text)" : "var(--text-muted)",
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)"; }}
           title={t("i18n.branches")}
           aria-label={t("i18n.branches")}
          aria-pressed={open}
        >
          {branchIcon}
           {!compact && <span>{t("i18n.branches")}</span>}
        </button>
        {open && dropdownPos && typeof document !== "undefined" && createPortal(
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 4900, background: "transparent" }}
              onClick={() => {
                if (openProp === undefined) setOpenInternal(false);
                else onToggle?.();
              }}
            />
            <div className="panel-content-in" style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              background: "var(--bg-panel)",
              borderLeft: "1px solid var(--border)",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              borderBottomLeftRadius: 6,
              borderBottomRightRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              zIndex: 5000,
            }}>
            {hasContent && firstNode ? (
              <div style={{ padding: "4px 12px 8px 12px", maxHeight: 260, overflowY: "auto" }}>
                <TreeNodeView
                  node={firstNode}
                  activePathIds={activePathIds}
                  depth={0}
                  isLast
                  parentLines={[]}
                  onSelect={handleSelect}
                  rowIndex={0}
                  visibleRows={visibleRows}
                  onShowMore={handleShowMore}
                  showMoreLabel={showMoreLabel}
                />
              </div>
            ) : (
              <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                {noSessionReason ?? t("i18n.noBranches")}
              </div>
            )}
          </div>
          </>,
          document.body
        )}
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, position: "relative" }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpenInternal((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          textAlign: "left",
        }}
      >
        {branchIcon}
         <span style={{ color: "var(--text-muted)" }}>{t("i18n.branches")}</span>
        {chevron}
      </button>

      {/* Tree panel - overlay */}
      {open && (
        <div className="panel-content-in" style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 100,
        }}>
          {hasContent && firstNode ? (
            <div style={{ padding: "4px 12px 8px 12px", maxHeight: 260, overflowY: "auto" }}>
              <TreeNodeView
                node={firstNode}
                activePathIds={activePathIds}
                depth={0}
                isLast
                parentLines={[]}
                onSelect={handleSelect}
                rowIndex={0}
                visibleRows={visibleRows}
                onShowMore={handleShowMore}
                showMoreLabel={showMoreLabel}
              />
            </div>
          ) : (
            <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              {noSessionReason ?? t("i18n.noBranches")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
