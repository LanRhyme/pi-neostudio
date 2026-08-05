import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import fs from "fs";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C" },
    });
    return { stdout, stderr };
  } catch (err: any) {
    if (err.stdout !== undefined || err.stderr !== undefined) {
      throw new Error(err.stderr || err.stdout || err.message);
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { cwd, action, paths, message } = await request.json() as {
      cwd: string;
      action: "add" | "unstage" | "commit" | "restore" | "push" | "pull";
      paths?: string[];
      message?: string;
    };

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

    let result = "";

    switch (action) {
      case "add":
        if (!paths || paths.length === 0) throw new Error("Paths required for add");
        await git(cwd, ["add", "--", ...paths]);
        result = `Staged ${paths.length} file(s).`;
        break;
      case "unstage":
        if (!paths || paths.length === 0) throw new Error("Paths required for unstage");
        await git(cwd, ["reset", "HEAD", "--", ...paths]);
        result = `Unstaged ${paths.length} file(s).`;
        break;
      case "restore":
        if (!paths || paths.length === 0) throw new Error("Paths required for restore");
        // git restore works for tracked files, git clean for untracked
        await git(cwd, ["restore", "--", ...paths]).catch(() => {});
        await git(cwd, ["clean", "-f", "--", ...paths]).catch(() => {});
        result = `Restored ${paths.length} file(s).`;
        break;
      case "commit":
        if (!message) throw new Error("Commit message required");
        await git(cwd, ["commit", "-m", message]);
        result = "Committed successfully.";
        break;
      case "push":
        const pushRes = await git(cwd, ["push"]);
        result = pushRes.stdout || pushRes.stderr || "Pushed successfully.";
        break;
      case "pull":
        const pullRes = await git(cwd, ["pull"]);
        result = pullRes.stdout || pullRes.stderr || "Pulled successfully.";
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
