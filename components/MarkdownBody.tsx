"use client";

import { memo, useMemo, type MouseEvent } from "react";
import { useUiSettings } from "@/hooks/useUiSettings";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

function MarkdownBodyImpl({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  // 所有 hooks 无条件执行（遵守 Rules of Hooks），流式纯文本仅做条件返回
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // 流式纯文本快捷路径：无 markdown 语法时跳过 react-markdown 全量解析，
  // 直接逐字渲染 —— 消除流式期间每帧 markdown 解析的 CPU 开销
  const { settings } = useUiSettings();
  const animateChars = isStreaming && settings.charAnimation;
  const isPlain = useMemo(() => {
    if (!animateChars) return false;
    return children.length <= 400 && !/[#*`\[\]>_~|]/.test(children);
  }, [children, animateChars]);

  const useBlur = children.length <= 150;
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        const handleExternalClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (!href || !href.startsWith("http")) return; // Let mailto/tel pass through normally
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("pi-external-link", { detail: href }));
        };

        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer" onClick={handleExternalClick}>
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
    p({ children }) {
      // 流式输出时逐字渐显上滑（纯文本段落才启用，长文本/大段退化为普通渲染，避免大量 span 拖慢流式）
      if (animateChars && typeof children === "string" && children.length <= 400) {
        const plain = children.length > 150;
        return (
          <p className="char-stream">
            {Array.from(children).map((ch, i) => (
              <span
                key={i}
                className={plain ? "char-in-plain" : "char-in"}
                style={{ animationDelay: `${Math.min(i * 4, 240)}ms` }}
              >
                {ch === " " ? "\u00A0" : ch}
              </span>
            ))}
          </p>
        );
      }
      return <p>{children}</p>;
    },
  }), [cwd, animateChars, onOpenFile, isStreaming]);
  if (isPlain) {
    return (
      <div className={["markdown-body", className].filter(Boolean).join(" ")}>
        <p className="char-stream">
          {Array.from(children).map((ch, i) => (
            <span
              key={i}
              className={useBlur ? "char-in" : "char-in-plain"}
              style={{ animationDelay: `${Math.min(i * 4, 240)}ms` }}
            >
              {ch === " " ? "\u00A0" : ch}
            </span>
          ))}
        </p>
        {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
      </div>
    );
  }


  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
      {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
    </div>
  );
}

export const MarkdownBody = memo(MarkdownBodyImpl);
