"use client";

import { useState, useRef, FormEvent, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";

interface SimpleBrowserProps {
  initialUrl: string;
  onInsertText?: (text: string) => void;
}

export function SimpleBrowser({ initialUrl, onInsertText }: SimpleBrowserProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState(initialUrl || "");
  const [inputUrl, setInputUrl] = useState(initialUrl || "");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
      setInputUrl(initialUrl);
    }
  }, [initialUrl]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    let finalUrl = inputUrl.trim();
    if (!finalUrl) return;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = "http://" + finalUrl;
    }
    setUrl(finalUrl);
    setInputUrl(finalUrl);
    setError(null);
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleBack = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.back();
      } catch (e) {
        // Cross origin
      }
    }
  };

  const handleForward = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.forward();
      } catch (e) {
        // Cross origin
      }
    }
  };

  const toggleInspector = useCallback(() => {
    if (!iframeRef.current) return;
    const iframe = iframeRef.current;
    
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error("No document");

      if (isInspecting) {
        // Clean up
        doc.body.removeAttribute("data-pi-inspecting");
        setIsInspecting(false);
        return;
      }

      setIsInspecting(true);
      setError(null);

      // Inject inspector script
      if (!doc.getElementById("pi-inspector-script")) {
        const script = doc.createElement("script");
        script.id = "pi-inspector-script";
        script.textContent = `
          (function() {
            let highlightedEl = null;
            let originalOutline = '';
            
            function clearHighlight() {
              if (highlightedEl) {
                highlightedEl.style.outline = originalOutline;
                highlightedEl.style.cursor = '';
                highlightedEl = null;
              }
            }
            
            function onMouseOver(e) {
              clearHighlight();
              if (e.target && e.target !== document.body && e.target !== document.documentElement) {
                highlightedEl = e.target;
                originalOutline = highlightedEl.style.outline;
                highlightedEl.style.outline = '2px dashed #007acc';
                highlightedEl.style.outlineOffset = '2px';
                highlightedEl.style.cursor = 'crosshair';
              }
            }

            function onMouseOut(e) {
              clearHighlight();
            }

            function getSelectorPath(el) {
              const path = [];
              let current = el;
              while (current && current.tagName && current.tagName.toLowerCase() !== 'html') {
                let s = current.tagName.toLowerCase();
                if (current.id) {
                  s += '#' + current.id;
                  path.unshift(s);
                  break; // ID is unique enough
                }
                if (current.className && typeof current.className === 'string') {
                  s += '.' + current.className.trim().replace(/\s+/g, '.');
                }
                path.unshift(s);
                current = current.parentNode;
              }
              return path.join(' > ');
            }

            function onClick(e) {
              e.preventDefault();
              e.stopPropagation();
              
              if (highlightedEl) {
                highlightedEl.style.outline = originalOutline;
                highlightedEl.style.cursor = '';
                
                let selector = getSelectorPath(highlightedEl);
                let html = highlightedEl.outerHTML;
                if (html.length > 800) {
                  html = html.substring(0, 800) + '\\n<!-- ... truncated ... -->';
                }
                
                window.parent.postMessage({ type: 'PI_INSPECT_RESULT', html: html, selector: selector }, '*');
              }
              
              cleanup();
            }

            function cleanup() {
              clearHighlight();
              document.removeEventListener('mouseover', onMouseOver, true);
              document.removeEventListener('mouseout', onMouseOut, true);
              document.removeEventListener('click', onClick, true);
            }

            // Expose setup to be called repeatedly
            window.__piSetupInspector = function() {
              document.addEventListener('mouseover', onMouseOver, true);
              document.addEventListener('mouseout', onMouseOut, true);
              document.addEventListener('click', onClick, true);
            };
          })();
        `;
        doc.head.appendChild(script);
      }

      // Execute setup
      const win = iframe.contentWindow as any;
      if (win.__piSetupInspector) {
        win.__piSetupInspector();
      }
      
    } catch (e) {
      setError("跨域限制：无法在 iframe 内直接拾取元素。如需解锁此功能，请在被调试项目的 <body> 标签内临时插入以下代码： <script>window.addEventListener('message', e => { if(e.data==='PI_INSPECT_START') window.__piSetupInspector && window.__piSetupInspector(); })</script>");
      setIsInspecting(false);
    }
  }, [isInspecting]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'PI_INSPECT_RESULT') {
        setIsInspecting(false);
        if (onInsertText) {
          const { html, selector } = e.data;
          const formattedHtml = html.split('\n').map((line: string) => '> ' + line).join('\n');
          const content = "> [!NOTE]\n> **[🎯 UI 元素拾取]**\n> DOM路径: `" + selector + "`\n> \n> ```html\n" + formattedHtml + "\n> ```\n\n";
          onInsertText(content);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onInsertText]);

  const buttonStyle = {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    padding: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    transition: "background 0.2s, color 0.2s"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)", color: "var(--text)" }}>
      {/* Browser Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}>
        {/* Navigation Controls */}
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" onClick={handleBack} title="Back" style={buttonStyle} onMouseEnter={(e) => {e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color="var(--text)";}} onMouseLeave={(e) => {e.currentTarget.style.background = "none"; e.currentTarget.style.color="var(--text-muted)";}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button type="button" onClick={handleForward} title="Forward" style={buttonStyle} onMouseEnter={(e) => {e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color="var(--text)";}} onMouseLeave={(e) => {e.currentTarget.style.background = "none"; e.currentTarget.style.color="var(--text-muted)";}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button type="button" onClick={handleRefresh} title="Refresh" style={buttonStyle} onMouseEnter={(e) => {e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color="var(--text)";}} onMouseLeave={(e) => {e.currentTarget.style.background = "none"; e.currentTarget.style.color="var(--text-muted)";}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"></path><path d="M21 13a9 9 0 1 1-3-7.7L21 8"></path></svg>
          </button>
        </div>

        {/* Address Bar */}
        <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex" }}>
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "0 12px",
            height: 28,
            transition: "border-color 0.2s"
          }}
          onFocus={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
          onBlur={(e) => e.currentTarget.style.borderColor = "var(--border)"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" style={{ marginRight: 8 }}>
              <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                color: "var(--text)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                outline: "none",
                width: "100%"
              }}
              placeholder="输入网址，例如 http://localhost:3000"
            />
          </div>
        </form>

        {/* DOM Picker Tool */}
        <button 
          type="button" 
          onClick={toggleInspector} 
          title="选取元素发送给 AI"
          style={{
            ...buttonStyle,
            color: isInspecting ? "var(--accent)" : "var(--text-muted)",
            background: isInspecting ? "rgba(0, 122, 204, 0.1)" : "none"
          }}
          onMouseEnter={(e) => { if(!isInspecting) e.currentTarget.style.background = "var(--bg-hover)"; }} 
          onMouseLeave={(e) => { if(!isInspecting) e.currentTarget.style.background = "none"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      </div>

      {error && (
        <div style={{
          padding: "6px 12px",
          background: "var(--danger)",
          color: "white",
          fontSize: 11,
          display: "flex",
          justifyContent: "space-between"
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "white", cursor: "pointer", opacity: 0.8 }}>✕</button>
        </div>
      )}

      {isInspecting && !error && (
        <div style={{
          padding: "6px 12px",
          background: "var(--accent)",
          color: "white",
          fontSize: 11,
          textAlign: "center"
        }}>
          拾取模式已开启：点击网页上的任意元素即可将它插入到聊天框中与 AI 对话。
        </div>
      )}

      {/* Browser Viewport / Home */}
      <div style={{ flex: 1, backgroundColor: url ? "#fff" : "var(--bg)", position: "relative" }}>
        {!url ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text)' }}>
            <h2 style={{ fontSize: 28, fontWeight: 500, marginBottom: 48, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              内嵌浏览器
            </h2>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 600 }}>
              {[
                { name: "Next.js", port: "3000", icon: <path d="M9 18l6-6-6-6"></path> },
                { name: "Vite / React", port: "5173", icon: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon> },
                { name: "Vue / Webpack", port: "8080", icon: <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path> }
              ].map(item => (
                <button 
                  key={item.port} 
                  onClick={() => { const target = `http://localhost:${item.port}`; setInputUrl(target); setUrl(target); }} 
                  style={{ padding: '20px 24px', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, transition: 'all 0.2s', width: 150 }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{item.icon}</svg>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{item.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>localhost:{item.port}</span>
                  </div>
                </button>
              ))}
            </div>
            <p style={{ marginTop: 48, fontSize: 13, color: 'var(--text-muted)' }}>
              在上方地址栏输入你要预览的网页地址
            </p>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={url}
            title="Simple Browser"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
            }}
          />
        )}
      </div>
    </div>
  );
}
