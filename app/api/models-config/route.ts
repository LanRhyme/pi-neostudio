import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
	const path = getModelsPath();
	if (!existsSync(path)) return { providers: {} };
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return { providers: {} };
	}
}

function writeModelsJson(data: Record<string, unknown>): void {
	const path = getModelsPath();
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writePrivateFileAtomicSync(path, JSON.stringify(data, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 忽略空模型配置行：过滤 id 为空白字符串的 provider model（上游 #473）
function sanitizeModelsConfig(
	data: Record<string, unknown>,
): Record<string, unknown> {
	if (!isRecord(data.providers)) return data;

	const providers = Object.fromEntries(
		Object.entries(data.providers).map(([providerId, provider]) => {
			if (!isRecord(provider) || !Array.isArray(provider.models))
				return [providerId, provider];
			const models = (provider.models as unknown[]).filter(
				(model) =>
					!isRecord(model) ||
					typeof model.id !== "string" ||
					model.id.trim().length > 0,
			);
			return [providerId, { ...provider, models }];
		}),
	);

	return { ...data, providers };
}

export async function GET() {
	return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
	try {
		const body = (await req.json()) as Record<string, unknown>;
		writeModelsJson(sanitizeModelsConfig(body));
		invalidateModelsCache();
		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 });
	}
}
