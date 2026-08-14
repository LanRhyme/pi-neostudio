import { NextResponse } from "next/server";
import type { SessionEntry } from "@/lib/types";
import {
	resolveSessionPath,
	getSessionEntries,
	entryToUiMessage,
} from "@/lib/session-reader";

/**
 * 加载压缩前的更早对话。
 *
 * pi 压缩后，上下文只包含「最新压缩摘要 + firstKeptEntryId 之后保留的条目」，
 * 压缩点之前的原始条目仍完整保留在 .jsonl 文件中但被丢弃。
 * 本端点从 before 条目的父链向上回溯（before 本身已在上下文中，不包含），
 * 按页返回更早的历史消息，客户端再合并进消息列表。
 */
export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const searchParams = new URL(req.url).searchParams;
		const before = searchParams.get("before");
		if (!before) {
			return NextResponse.json({ error: "missing before" }, { status: 400 });
		}
		const rawLimit = Number(searchParams.get("limit") ?? "50");
		const limit = Number.isFinite(rawLimit)
			? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
			: 50;
		const deferThinking = searchParams.has("deferThinking");
		const deferToolResultImages = searchParams.has("deferMedia");

		const filePath = await resolveSessionPath(id);
		if (!filePath) {
			return NextResponse.json({ error: "Session not found" }, { status: 404 });
		}

		const entries = getSessionEntries(filePath);
		const byId = new Map<string, SessionEntry>();
		for (const e of entries) byId.set(e.id, e);

		const start = byId.get(before);
		if (!start) {
			return NextResponse.json({ error: "before not found" }, { status: 404 });
		}

		// 沿父链回溯收集（reversed：最旧的排在最后，避免原地 reverse 变异）
		let cur = start.parentId;
		const reversed: SessionEntry[] = [];
		while (cur && reversed.length < limit) {
			const e = byId.get(cur);
			if (!e) break;
			reversed.push(e);
			cur = e.parentId;
		}

		// 从末尾向前构建正序消息（最旧在前）
		const messages: unknown[] = [];
		const entryIds: string[] = [];
		for (let i = reversed.length - 1; i >= 0; i--) {
			const m = entryToUiMessage(reversed[i], {
				deferThinking,
				deferToolResultImages,
			});
			if (m) {
				messages.push(m);
				entryIds.push(reversed[i].id);
			}
		}

		return NextResponse.json({
			messages,
			entryIds,
			hasMore: reversed.length === limit && cur !== undefined,
			nextBefore: reversed.length > 0 ? reversed[reversed.length - 1].id : null,
		});
	} catch (e) {
		console.error("Failed to load earlier history:", e);
		return NextResponse.json(
			{ error: "Failed to load earlier history" },
			{ status: 500 },
		);
	}
}
