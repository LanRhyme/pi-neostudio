import { NextRequest, NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { selectInitialModelScope } from "@/lib/model-scope";
import { resolveVisibleModels } from "@/lib/model-scope";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;

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
    const { cwd } = await request.json() as { cwd: string };

    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const diff = await git(cwd, ["diff", "--cached"]);
    if (!diff.trim()) {
      return NextResponse.json({ error: "No staged changes to generate commit message for." }, { status: 400 });
    }

    const agentDir = getAgentDir();
    const services = await createAgentSessionServices({ cwd, agentDir });
    const settings = services.settingsManager;
    
    const scope = await resolveVisibleModels(services.modelRuntime, settings.getEnabledModels());
    
    const defaultProvider = settings.getDefaultProvider();
    const defaultModelId = settings.getDefaultModel();
    const initial = selectInitialModelScope(scope, {
      ...(defaultProvider && defaultModelId
        ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
        : {}),
    });

    if (!initial.model) {
      return NextResponse.json({ error: "No default model configured for AI generation." }, { status: 400 });
    }

    const model = services.modelRuntime.getModel(initial.model.provider, initial.model.id);
    if (!model) {
      return NextResponse.json({ error: `Model not found: ${initial.model.provider}/${initial.model.id}` }, { status: 400 });
    }

    const resolved = await services.modelRuntime.getAuth(model);
    if (!resolved?.auth.apiKey && !resolved?.auth.headers) {
      return NextResponse.json({ error: `Authentication failed for ${initial.model.provider}` }, { status: 400 });
    }

    const prompt = `Generate a concise, conventional git commit message based on the following git diff. Output ONLY the commit message itself, without markdown blocks, explanations, or quotes.

Diff:
${diff.slice(0, 8000)}`;

    const message = await completeSimple(model, {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    }, {
      apiKey: resolved.auth.apiKey,
      headers: resolved.auth.headers,
      maxTokens: 200,
      timeoutMs: 30000,
      maxRetries: 1,
      cacheRetention: "none",
    });

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw new Error(message.errorMessage || "Model error");
    }

    const assistantText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return NextResponse.json({ success: true, message: assistantText });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
