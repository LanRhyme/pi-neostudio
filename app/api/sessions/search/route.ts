import { NextResponse } from "next/server";
import { listAllSessions, getSessionEntries } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export interface SearchMatchSnippet {
  entryId: string;
  role: string;
  snippet: string;
  timestamp?: string;
}

export interface SessionSearchResult {
  sessionId: string;
  name?: string;
  cwd?: string;
  firstMessage: string;
  created: string;
  modified: string;
  matchCount: number;
  snippets: SearchMatchSnippet[];
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
    } else if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (b.type === "thinking" && typeof b.thinking === "string") {
        parts.push(b.thinking);
      } else if (b.type === "toolCall" && typeof b.name === "string") {
        parts.push(`[Tool: ${b.name}] ${JSON.stringify(b.arguments || {})}`);
      }
    }
  }
  return parts.join(" ");
}

function createSnippet(text: string, query: string, matchLength = 80): string {
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(query.toLowerCase());
  if (index === -1) return text.slice(0, matchLength);

  const start = Math.max(0, index - 25);
  const end = Math.min(text.length, index + query.length + 45);
  let snippet = text.slice(start, end).replace(/\s+/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const sessions = await listAllSessions();
    const results: SessionSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const session of sessions) {
      if (results.length >= 30) break; // Limit top sessions

      const snippets: SearchMatchSnippet[] = [];
      let matchCount = 0;

      try {
        const entries = getSessionEntries(session.path);
        for (const entry of entries as SessionEntry[]) {
          let text = "";
          let role = "message";

          if (entry.type === "message" && entry.message) {
            const msg = entry.message as unknown as Record<string, unknown>;
            role = (msg.role as string) || "message";
            if ("content" in msg) {
              text = extractTextFromContent(msg.content);
            } else if (msg.role === "bashExecution") {
              text = `${msg.command || ""} ${msg.output || ""}`;
            }
          } else if (entry.type === "compaction" && entry.summary) {
            role = "compaction";
            text = entry.summary;
          } else if (entry.type === "branch_summary" && entry.summary) {
            role = "branch_summary";
            text = entry.summary;
          } else if (entry.type === "session_info" && entry.name) {
            role = "title";
            text = entry.name;
          }

          if (text && text.toLowerCase().includes(lowerQuery)) {
            matchCount++;
            if (snippets.length < 5) {
              snippets.push({
                entryId: entry.id,
                role,
                snippet: createSnippet(text, query),
                timestamp: entry.timestamp,
              });
            }
          }
        }
      } catch {
        // Fallback to title/firstMessage check if entry parsing fails
        const headerText = `${session.name || ""} ${session.firstMessage || ""}`;
        if (headerText.toLowerCase().includes(lowerQuery)) {
          matchCount = 1;
          snippets.push({
            entryId: session.id,
            role: "session",
            snippet: createSnippet(headerText, query),
          });
        }
      }

      if (matchCount > 0) {
        results.push({
          sessionId: session.id,
          name: session.name,
          cwd: session.cwd,
          firstMessage: session.firstMessage,
          created: session.created,
          modified: session.modified,
          matchCount,
          snippets,
        });
      }
    }

    // Sort results by most recent modified date
    results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
