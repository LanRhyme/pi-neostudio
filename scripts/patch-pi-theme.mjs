#!/usr/bin/env node
// 修复 pi-coding-agent 0.84.x 的 Theme 构造回归：
// 当 bgColors 为空对象时，scrollbarThumb 兜底为 undefined，
// bgAnsi(undefined) 直接调用 undefined.startsWith 崩溃（构建期与运行期均触发）
// 补丁：fgAnsi/bgAnsi 对 null/undefined 颜色值返回 ANSI 重置码
// 幂等：检测到已修补则直接退出

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const themePath = join(
	__dirname,
	"..",
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"modes",
	"interactive",
	"theme",
	"theme.js",
);

if (!existsSync(themePath)) {
	console.log("[patch-pi-theme] theme.js not found, skip");
	process.exit(0);
}

const src = readFileSync(themePath, "utf8");
if (src.includes("color == null")) {
	console.log("[patch-pi-theme] already patched, skip");
	process.exit(0);
}

const fgOld = '    if (color === "")\n        return "\\x1b[39m";';
const fgNew =
	'    if (color == null || color === "")\n        return "\\x1b[39m";';
const bgOld = '    if (color === "")\n        return "\\x1b[49m";';
const bgNew =
	'    if (color == null || color === "")\n        return "\\x1b[49m";';

if (!src.includes(fgOld) || !src.includes(bgOld)) {
	console.error("[patch-pi-theme] unexpected theme.js content, patch aborted");
	process.exit(1);
}

const patched = src.replace(fgOld, fgNew).replace(bgOld, bgNew);
writeFileSync(themePath, patched);
console.log(
	"[patch-pi-theme] patched pi-coding-agent theme.js (bgAnsi/fgAnsi null guard)",
);
