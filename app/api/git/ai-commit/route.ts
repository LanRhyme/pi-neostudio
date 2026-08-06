import { NextRequest, NextResponse } from "next/server";
import {
	createAgentSessionServices,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { Model, Api } from "@earendil-works/pi-ai";
import {
	getAllowedFileRoots,
	isFilePathAllowed,
	isWindowsAbsolutePath,
} from "@/lib/file-access";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { selectInitialModelScope } from "@/lib/model-scope";
import { resolveVisibleModels } from "@/lib/model-scope";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;

/** 内置默认提示词模板：{diff} 会被替换为暂存区 diff 内容 */
const DEFAULT_GIT_COMMIT_PROMPT = `Generate a concise, conventional git commit message based on the following git diff. Output ONLY the commit message itself, without markdown blocks, explanations, or quotes.

Diff:
{diff}`;

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
		timeout: GIT_TIMEOUT_MS,
		maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, LC_ALL: "C" },
	});
	return stdout;
}

export async function POST(request: NextRequest) {
	try {
		const body = (await request.json()) as {
			cwd: string;
			prompt?: string;
			model?: string;
			maxTokens?: number | string;
		};
		const { cwd, prompt, model: modelSpec, maxTokens: maxTokensRaw } = body;

		if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
			return NextResponse.json(
				{ error: "cwd must be an absolute path" },
				{ status: 400 },
			);
		}

		const allowedRoots = await getAllowedFileRoots();
		if (!isFilePathAllowed(cwd, allowedRoots)) {
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}

		let stat: fs.Stats;
		try {
			stat = fs.statSync(cwd);
		} catch {
			return NextResponse.json(
				{ error: "Directory not found" },
				{ status: 404 },
			);
		}
		if (!stat.isDirectory()) {
			return NextResponse.json({ error: "Not a directory" }, { status: 400 });
		}

		const diff = await git(cwd, ["diff", "--cached"]);
		if (!diff.trim()) {
			return NextResponse.json(
				{ error: "No staged changes to generate commit message for." },
				{ status: 400 },
			);
		}

		const agentDir = getAgentDir();
		const services = await createAgentSessionServices({ cwd, agentDir });
		const settings = services.settingsManager;

		const scope = await resolveVisibleModels(
			services.modelRuntime,
			settings.getEnabledModels(),
		);

		const defaultProvider = settings.getDefaultProvider();
		const defaultModelId = settings.getDefaultModel();

		let resolvedModel: Model<Api> | undefined;
		let usedModelSpec: string;

		// 用户显式指定模型（"provider/modelId"）：必须在可见模型中精确匹配，
		// 找不到时明确报错，而不是静默回退到第一个可用模型
		if (typeof modelSpec === "string" && modelSpec.includes("/")) {
			const slash = modelSpec.indexOf("/");
			const p = modelSpec.slice(0, slash);
			const m = modelSpec.slice(slash + 1);
			resolvedModel = scope.visible.find(
				(model) => model.provider === p && model.id === m,
			);
			if (!resolvedModel) {
				return NextResponse.json(
					{
						error: `Model is not available in the enabled scope: ${modelSpec}`,
					},
					{ status: 400 },
				);
			}
			usedModelSpec = `${resolvedModel.provider}/${resolvedModel.id}`;
		} else {
			// 未指定模型：使用 settings 默认模型（回退到第一个可用模型）
			const initial = selectInitialModelScope(scope, {
				...(defaultProvider && defaultModelId
					? {
							defaultModel: {
								provider: defaultProvider,
								modelId: defaultModelId,
							},
						}
					: {}),
			});
			if (!initial.model) {
				return NextResponse.json(
					{
						error: "No default model configured for AI generation.",
					},
					{ status: 400 },
				);
			}
			resolvedModel = initial.model;
			usedModelSpec = `${initial.model.provider}/${initial.model.id}`;
		}

		const model = services.modelRuntime.getModel(
			resolvedModel.provider,
			resolvedModel.id,
		);
		if (!model) {
			return NextResponse.json(
				{ error: `Model not found: ${usedModelSpec}` },
				{ status: 400 },
			);
		}

		const resolved = await services.modelRuntime.getAuth(model);
		if (!resolved?.auth.apiKey && !resolved?.auth.headers) {
			return NextResponse.json(
				{ error: `Authentication failed for ${resolvedModel.provider}` },
				{ status: 400 },
			);
		}

		const diffSnippet = diff.slice(0, 8000);
		const template =
			typeof prompt === "string" && prompt.trim()
				? prompt.trim()
				: DEFAULT_GIT_COMMIT_PROMPT;
		// 自定义提示词若包含 {diff} 占位符则就地替换，否则把 diff 追加到末尾
		const finalPrompt = template.includes("{diff}")
			? template.replaceAll("{diff}", diffSnippet)
			: `${template}\n\nDiff:\n${diffSnippet}`;

		// maxTokens 默认 1000000（思考型模型推理需要大预算），可被设置覆盖；
		// 再 clamp 到模型自身 maxTokens 上限，避免 API 拒绝
		const DEFAULT_MAX_TOKENS = 1_000_000;
		const parsedMaxTokens =
			typeof maxTokensRaw === "number" &&
			Number.isFinite(maxTokensRaw) &&
			maxTokensRaw > 0
				? Math.floor(maxTokensRaw)
				: typeof maxTokensRaw === "string" && maxTokensRaw.trim()
					? Math.floor(Number(maxTokensRaw))
					: DEFAULT_MAX_TOKENS;
		const effectiveMaxTokens =
			Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
				? parsedMaxTokens
				: DEFAULT_MAX_TOKENS;
		const clampedMaxTokens =
			model.maxTokens && model.maxTokens > 0
				? Math.min(effectiveMaxTokens, model.maxTokens)
				: effectiveMaxTokens;

		const message = await completeSimple(
			model,
			{
				messages: [
					{ role: "user", content: finalPrompt, timestamp: Date.now() },
				],
			},
			{
				apiKey: resolved.auth.apiKey,
				headers: resolved.auth.headers,
				maxTokens: clampedMaxTokens,
				timeoutMs: 60000,
				maxRetries: 1,
				cacheRetention: "none",
			},
		);

		if (message.stopReason === "error" || message.stopReason === "aborted") {
			throw new Error(message.errorMessage || "Model error");
		}

		const assistantText = message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim();

		if (!assistantText) {
			const hasThinking = message.content?.some(
				(block) => block.type === "thinking",
			);
			return NextResponse.json(
				{
					error: hasThinking
						? `Model ${usedModelSpec} returned only thinking content (stopReason=${message.stopReason}); try a non-thinking model or increase maxTokens.`
						: `Model ${usedModelSpec} returned no text (stopReason=${message.stopReason}).`,
				},
				{ status: 502 },
			);
		}

		return NextResponse.json({
			success: true,
			message: assistantText,
			model: usedModelSpec,
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 500 },
		);
	}
}
