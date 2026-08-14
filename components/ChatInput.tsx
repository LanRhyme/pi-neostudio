"use client";

import React, {
	useRef,
	useState,
	useCallback,
	useEffect,
	useImperativeHandle,
	forwardRef,
} from "react";
import {
	EditorContent,
	useEditor,
	ReactNodeViewRenderer,
	NodeViewWrapper,
	type NodeViewProps,
} from "@tiptap/react";
import {
	Editor as TiptapEditor,
	Extension,
	Node as TiptapNode,
	mergeAttributes,
	type JSONContent,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type {
	BuiltinSlashCommandResult,
	CompactResultInfo,
	QueuedMessages,
	SlashCommandInfo,
} from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import {
	clearDraft,
	getDraft,
	setDraft,
	type ChatDraftImage,
} from "@/lib/draft-store";
import {
	MAX_ATTACHED_IMAGE_BYTES,
	MAX_ATTACHED_IMAGES,
	isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
	buildEntriesFromFiles,
	buildAtInsertText,
	extractAtQuery,
	filterFileEntries,
	type AtQueryMatch,
	type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

export interface AttachedImage {
	data: string; // base64, no prefix
	mimeType: string;
	previewUrl: string; // object URL for display
}

interface ModelOption {
	provider: string;
	modelId: string;
	name: string;
}

interface Props {
	onSend: (message: string, images?: AttachedImage[]) => void;
	onAbort: () => void;
	onSteer?: (message: string, images?: AttachedImage[]) => void;
	onFollowUp?: (message: string, images?: AttachedImage[]) => void;
	onPromptWithStreamingBehavior?: (
		message: string,
		behavior: "steer" | "followUp",
		images?: AttachedImage[],
	) => void;
	isStreaming: boolean;
	model?: { provider: string; modelId: string } | null;
	isAutoModelSelection?: boolean;
	modelNames?: Record<string, string>;
	modelList?: { id: string; name: string; provider: string }[];
	modelError?: string | null;
	/** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
	modelScopeWarnings?: string[];
	onModelChange?: (provider: string, modelId: string) => void;
	onCompact?: () => void;
	onAbortCompaction?: () => void;
	isCompacting?: boolean;
	compactError?: string | null;
	compactResult?: CompactResultInfo | null;
	toolPreset?: "none" | "default" | "full";
	onToolPresetChange?: (preset: "none" | "default" | "full") => void;
	thinkingLevel?:
		| "auto"
		| "off"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max";
	onThinkingLevelChange?: (
		level:
			| "auto"
			| "off"
			| "minimal"
			| "low"
			| "medium"
			| "high"
			| "xhigh"
			| "max",
	) => void;
	availableThinkingLevels?: string[] | null;
	thinkingLevelMap?: Record<string, string | null> | null;
	retryInfo?: {
		attempt: number;
		maxAttempts: number;
		errorMessage?: string;
	} | null;
	queuedMessages?: QueuedMessages | null;
	inputHistory?: string[];
	onRecallQueue?: () => void;
	slashCommands?: SlashCommandInfo[];
	slashCommandsLoading?: boolean;
	onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
	onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
	soundEnabled?: boolean;
	onSoundToggle?: () => void;
	onAudioUnlock?: () => void;
	draftKey?: string;
	/** Session working directory — enables the @ file autocomplete menu */
	cwd?: string | null;
}

export interface ChatInputHandle {
	insertText: (text: string) => void;
	insertIfEmpty: (text: string) => void;
	prependText: (text: string) => void;
	addImages: (files: File[]) => void;
}

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<
	"off" | "default" | "full",
	"none" | "default" | "full"
> = { off: "none", default: "default", full: "full" };
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const MODEL_FILTER_THRESHOLD = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function compareModelOptions(a: ModelOption, b: ModelOption): number {
	return (
		MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId) ||
		MODEL_OPTION_COLLATOR.compare(a.provider, b.provider) ||
		MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId)
	);
}

export function filterModelOptions(
	options: ModelOption[],
	query: string,
): ModelOption[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return options;

	return options.filter((option) =>
		`${option.name} ${option.modelId}`
			.toLocaleLowerCase()
			.includes(normalizedQuery),
	);
}

const THINKING_LEVELS = [
	"auto",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
const THINKING_LEVEL_DESC_KEYS: Record<
	(typeof THINKING_LEVELS)[number],
	string
> = {
	auto: "chat.thinkingUseDefault",
	off: "chat.thinkingOff",
	minimal: "chat.thinkingMinimal",
	low: "chat.thinkingLow",
	medium: "chat.thinkingMedium",
	high: "chat.thinkingHigh",
	xhigh: "chat.thinkingXhigh",
	max: "chat.thinkingMax",
};

function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
	return tokens.toLocaleString();
}

type SlashCommandPaletteItem =
	| SlashCommandInfo
	| {
			name: string;
			description: string;
			source: "builtin";
	  };

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
	{ name: "compact", description: "chat.commandCompact", source: "builtin" },
	{ name: "reload", description: "chat.commandReload", source: "builtin" },
	{ name: "name", description: "chat.commandName", source: "builtin" },
	{ name: "session", description: "chat.commandSession", source: "builtin" },
	{ name: "copy", description: "chat.commandCopy", source: "builtin" },
];

const SLASH_SOURCES: SlashCommandSource[] = [
	"builtin",
	"extension",
	"prompt",
	"skill",
];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
	builtin: "chat.builtIn",
	extension: "chat.extensions",
	prompt: "chat.prompts",
	skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
	builtin: 0,
	extension: 1,
	prompt: 2,
	skill: 3,
};

function slashMatchRank(
	command: SlashCommandPaletteItem,
	query: string,
	t: (key: string) => string,
): number {
	const name = command.name.toLowerCase();
	const description = getSlashDescription(command, t).toLowerCase();
	if (name === query) return 0;
	if (name.startsWith(query)) return 1;
	if (name.includes(query)) return 2;
	if (description.includes(query)) return 3;
	return 4;
}

function getSlashDescription(
	command: SlashCommandPaletteItem,
	t: (key: string) => string,
): string {
	return command.source === "builtin"
		? t(command.description)
		: (command.description ?? "");
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(
	command: SlashCommandPaletteItem,
	dormancy: Record<string, boolean>,
): boolean {
	if (command.source !== "skill" || !command.name.startsWith("skill:"))
		return false;
	return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
	commands: SlashCommandPaletteItem[],
	dormancy: Record<string, boolean>,
) {
	let index = 0;
	const groups = SLASH_SOURCES.map((source) => {
		const sourceCommands = commands.filter(
			(command) => command.source === source,
		);
		const orderedCommands =
			source === "skill"
				? [
						...sourceCommands.filter(
							(command) => !isDormantSkillCommand(command, dormancy),
						),
						...sourceCommands.filter((command) =>
							isDormantSkillCommand(command, dormancy),
						),
					]
				: sourceCommands;
		return {
			source,
			items: orderedCommands.map((command) => ({ command, index: index++ })),
		};
	}).filter((group) => group.items.length > 0);

	return {
		commands: groups.flatMap((group) =>
			group.items.map(({ command }) => command),
		),
		groups,
	};
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
	return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
	return {
		...image,
		previewUrl: `data:${image.mimeType};base64,${image.data}`,
	};
}

function draftImagesToAttachedImages(
	images: ChatDraftImage[] | undefined,
): AttachedImage[] {
	return (images ?? [])
		.filter(isBase64ImageWithinLimits)
		.slice(0, MAX_ATTACHED_IMAGES)
		.map(draftImageToAttachedImage);
}

function revokeImagePreview(image: AttachedImage): void {
	if (image.previewUrl.startsWith("blob:")) {
		URL.revokeObjectURL(image.previewUrl);
	}
}

// ── Tiptap atomic custom nodes ──────────────────────────────────────────────
// The chat input is backed by a ProseMirror/Tiptap editor. Plain text typing
// stays plain (input/paste rules are disabled; pastes are handled manually),
// while three atomic “chip” nodes carry richer payloads:
//   • mention    — @file / /command chips (background-colored, rounded)
//   • longText   — >10-line pasted/inserted text collapsed to a card
//   • domPicker  — browser-inspector UI-element captures rendered as a card
// All of them serialize back to the exact original Markdown/plain text when
// the message is sent (see editorToMarkdown below).

// 10 lines or more collapse into a card
const LONG_TEXT_LINE_THRESHOLD = 10;
// Detection marker for the browser-inspector payload — must match the format
// produced by SimpleBrowser (emoji included), so it stays untouched here.
const DOM_PICKER_MARKER = "**[🎯 UI 元素拾取]**";
const DOM_PICKER_HEAD = "> [!NOTE]";

// Inline stroke icons for the atomic cards (SVG instead of emoji).
function TargetIcon({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="12" r="5" />
			<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
		</svg>
	);
}

function FileTextIcon({ size = 14 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 2v6h6" />
			<line x1="8" y1="13" x2="16" y2="13" />
			<line x1="8" y1="17" x2="13" y2="17" />
		</svg>
	);
}

function isDomPickerText(text: string): boolean {
	return text.startsWith(DOM_PICKER_HEAD) && text.includes(DOM_PICKER_MARKER);
}

interface DomPickerParsed {
	selector: string;
	html: string;
	raw: string;
}

function parseDomPicker(text: string): DomPickerParsed | null {
	const lines = text.split(/\r?\n/);
	if (!lines[0]?.startsWith(DOM_PICKER_HEAD)) return null;
	if (!text.includes(DOM_PICKER_MARKER)) return null;
	let selector = "";
	const htmlLines: string[] = [];
	let inHtml = false;
	for (const line of lines) {
		const body = line.startsWith("> ") ? line.slice(2) : line;
		if (body.startsWith("DOM路径: `")) {
			selector = body.slice("DOM路径: `".length).replace(/`.*$/, "");
		} else if (body.trim() === "```html") {
			inHtml = true;
		} else if (inHtml) {
			if (body.trim() === "```") inHtml = false;
			else htmlLines.push(body);
		}
	}
	return { selector, html: htmlLines.join("\n"), raw: text.trimEnd() };
}

const MentionNode = TiptapNode.create({
	name: "mention",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	draggable: false,
	addAttributes() {
		return {
			kind: { default: "file" as string }, // "file" | "command"
			label: { default: "" }, // visible chip text, e.g. "@ChatInput.tsx" or "/compact"
			text: { default: "" }, // serialized markdown, e.g. "@components/ChatInput.tsx"
		};
	},
	parseHTML() {
		return [{ tag: "span[data-mention]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				class: "pi-mention-chip",
				"data-mention": node.attrs.kind,
				"data-label": node.attrs.label,
				title: node.attrs.text,
			}),
			node.attrs.label,
		];
	},
	renderText({ node }) {
		return node.attrs.text;
	},
});

function LongTextView({ node, getPos, editor, selected }: NodeViewProps) {
	const { text, lines } = node.attrs;
	// Clicking the collapsed card “releases” the text back into the document as
	// ordinary editable content (text + hard breaks), so it can be modified.
	const release = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (!editor) return;
			const pos = getPos();
			if (pos === undefined || pos < 0) return;
			const nodes = inlineNodesFromText(text).map((json) =>
				editor.schema.nodeFromJSON(json),
			);
			const tr = editor.state.tr;
			tr.delete(pos, pos + 1);
			const fragment = Fragment.fromArray(nodes);
			tr.insert(pos, fragment);
			tr.setSelection(TextSelection.near(tr.doc.resolve(pos + fragment.size)));
			editor.view.dispatch(tr);
			editor.commands.focus();
		},
		[editor, getPos, text],
	);
	return (
		<NodeViewWrapper
			as="span"
			className={`pi-longtext-chip${selected ? " pi-chip-selected" : ""}`}
			contentEditable={false}
			data-longtext="true"
		>
			<button
				type="button"
				className="pi-longtext-toggle"
				onClick={release}
				title="点击释放为可编辑文本"
			>
				<FileTextIcon />
				展开长文本 · {lines} 行
			</button>
		</NodeViewWrapper>
	);
}

const LongTextNode = TiptapNode.create({
	name: "longText",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	draggable: false,
	addAttributes() {
		return {
			text: { default: "" },
			lines: { default: 0 },
		};
	},
	parseHTML() {
		return [{ tag: "span[data-longtext]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-longtext": "true",
				"data-lines": node.attrs.lines,
			}),
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(LongTextView, {
			as: "span",
			stopEvent: (props) => {
				const target = props.event.target as HTMLElement | null;
				return Boolean(target?.closest?.(".pi-longtext-toggle, .pi-chip-btn"));
			},
		});
	},
	renderText({ node }) {
		return node.attrs.text;
	},
});

function DomPickerView({ node, updateAttributes, selected }: NodeViewProps) {
	const { selector, html, expanded } = node.attrs;
	const toggle = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			updateAttributes({ expanded: !expanded });
		},
		[expanded, updateAttributes],
	);
	return (
		<NodeViewWrapper
			className={`pi-dompicker-card${selected ? " pi-chip-selected" : ""}`}
			contentEditable={false}
			data-dompicker="true"
		>
			<div className="pi-dompicker-head">
				<span className="pi-dompicker-label">
					<TargetIcon />
					UI 元素拾取
				</span>
				{selector && (
					<span className="pi-dompicker-selector" title={selector}>
						{selector}
					</span>
				)}
				<button type="button" className="pi-chip-btn" onClick={toggle}>
					{expanded ? "收起" : `展开 HTML（${html.split("\n").length} 行）`}
				</button>
			</div>
			{expanded && <pre className="pi-dompicker-html">{html}</pre>}
		</NodeViewWrapper>
	);
}

const DomPickerNode = TiptapNode.create({
	name: "domPicker",
	group: "block",
	atom: true,
	selectable: true,
	draggable: false,
	addAttributes() {
		return {
			selector: { default: "" },
			html: { default: "" },
			raw: { default: "" },
			expanded: { default: false },
		};
	},
	parseHTML() {
		return [{ tag: "div[data-dompicker]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-dompicker": "true",
				"data-selector": node.attrs.selector,
			}),
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(DomPickerView, {
			stopEvent: (props) => {
				const target = props.event.target as HTMLElement | null;
				return Boolean(target?.closest?.(".pi-chip-btn"));
			},
		});
	},
	renderText({ node }) {
		return node.attrs.raw;
	},
});

// ── Serialization: editor doc ⇄ plain Markdown/plain text ──────────────────
// The editor is the source of truth while typing; `value` mirrors its
// serialized form on every transaction. Serialization restores the hidden
// payloads of the atomic chips so the backend always sees the full text.

function serializeInline(block: PMNode): string {
	let out = "";
	block.forEach((child) => {
		if (child.isText) out += child.text ?? "";
		else if (child.type.name === "hardBreak") out += "\n";
		else if (child.type.name === "mention" || child.type.name === "longText")
			out += child.attrs.text;
		else out += child.textContent;
	});
	return out;
}

function editorToMarkdown(editor: TiptapEditor): string {
	const doc = editor.state.doc;
	const parts: string[] = [];
	doc.forEach((block) => {
		if (block.type.name === "domPicker") {
			parts.push(String(block.attrs.raw ?? "").trimEnd());
		} else {
			parts.push(serializeInline(block));
		}
	});
	return parts.join("\n");
}

// Parse a Markdown/plain-text string into editor content. Each line becomes a
// paragraph (serialization rejoins with "\n", so the round-trip is exact);
// DOM-picker blocks are re-materialized as atomic cards.
function markdownToContent(md: string): JSONContent[] {
	if (!md) return [{ type: "paragraph" }];
	const lines = md.split(/\r?\n/);
	const blocks: JSONContent[] = [];
	let i = 0;
	while (i < lines.length) {
		if (lines[i].startsWith(DOM_PICKER_HEAD)) {
			// Gather the consecutive "> "-quoted block.
			const blockLines: string[] = [];
			let k = i;
			while (k < lines.length && lines[k].startsWith("> ")) {
				blockLines.push(lines[k]);
				k += 1;
			}
			if (blockLines.some((l) => l.includes(DOM_PICKER_MARKER))) {
				const parsed = parseDomPicker(blockLines.join("\n"));
				if (parsed) {
					blocks.push({
						type: "domPicker",
						attrs: {
							selector: parsed.selector,
							html: parsed.html,
							raw: parsed.raw,
							expanded: false,
						},
					});
					i = k;
					continue;
				}
			}
		}
		blocks.push({
			type: "paragraph",
			content: lines[i] ? [{ type: "text", text: lines[i] }] : [],
		});
		i += 1;
	}
	return blocks.length ? blocks : [{ type: "paragraph" }];
}

function inlineNodesFromText(text: string): JSONContent[] {
	const lines = text.split(/\r?\n/);
	const nodes: JSONContent[] = [];
	lines.forEach((line, index) => {
		if (index > 0) nodes.push({ type: "hardBreak" });
		if (line.length > 0) nodes.push({ type: "text", text: line });
	});
	return nodes;
}

// Some clipboard sources only provide text/html (no text/plain). Extract a
// plain-text approximation (block elements become newlines) so long-text
// collapsing and DOM-picker detection still work for those pastes.
function clipboardHtmlToText(html: string): string {
	if (typeof window === "undefined") return "";
	try {
		const doc = new window.DOMParser().parseFromString(html, "text/html");
		return (doc.body.innerText ?? doc.body.textContent ?? "").replace(
			/\u00a0/g,
			" ",
		);
	} catch {
		return "";
	}
}

// ── @-token tracking in doc space ──────────────────────────────────────────
// The @ autocomplete token lives in plain text; atomic chips are transparent
// (each contributes one non-whitespace placeholder char so token detection
// and doc-position mapping stay exact).

interface TextRun {
	text: string;
	start: number;
	end: number;
	docStart: number;
	docEnd: number;
	isAtom: boolean;
}

interface ParagraphCtx {
	text: string;
	runs: TextRun[];
}

const ATOM_GLYPH = "\uFFFC";

function paragraphCtx(
	editor: TiptapEditor,
	caretPos: number,
): ParagraphCtx | null {
	const { state } = editor;
	const $pos = state.doc.resolve(caretPos);
	if (!$pos.parent.isTextblock) return null;
	const start = $pos.start();
	const limit = Math.min($pos.end(), caretPos);
	const runs: TextRun[] = [];
	let text = "";
	state.doc.nodesBetween(
		start,
		limit,
		(node, pos) => {
			if (node.isText) {
				const maxPos = Math.min(pos + node.nodeSize, limit);
				const slice = (node.text ?? "").slice(0, Math.max(0, maxPos - pos));
				if (slice) {
					runs.push({
						text: slice,
						start: text.length,
						end: text.length + slice.length,
						docStart: pos,
						docEnd: pos + slice.length,
						isAtom: false,
					});
					text += slice;
				}
			} else if (node.type.name === "hardBreak") {
				if (pos < limit) {
					runs.push({
						text: "\n",
						start: text.length,
						end: text.length + 1,
						docStart: pos,
						docEnd: pos + 1,
						isAtom: false,
					});
					text += "\n";
				}
			} else if (node.isInline && node.isAtom) {
				if (pos + 1 <= limit) {
					runs.push({
						text: ATOM_GLYPH,
						start: text.length,
						end: text.length + 1,
						docStart: pos,
						docEnd: pos + 1,
						isAtom: true,
					});
					text += ATOM_GLYPH;
				}
			}
			return true;
		},
		0,
	);
	return { text, runs };
}

function charToDocPos(ctx: ParagraphCtx, charIndex: number): number | null {
	for (const run of ctx.runs) {
		if (charIndex >= run.start && charIndex < run.end) {
			if (run.isAtom) return null; // token start inside a chip — refuse
			return run.docStart + (charIndex - run.start);
		}
	}
	if (charIndex === ctx.text.length && ctx.runs.length > 0) {
		return ctx.runs[ctx.runs.length - 1].docEnd;
	}
	return null;
}

function insertNodesAtRange(
	editor: TiptapEditor,
	from: number,
	to: number,
	nodes: JSONContent[],
	caretOffset?: number,
): void {
	const chain = editor.chain().focus();
	if (nodes.length > 0) {
		chain.insertContentAt({ from, to }, nodes, { updateSelection: true });
	} else if (from !== to) {
		chain.deleteRange({ from, to });
	}
	chain.run();
	if (caretOffset != null) {
		editor.commands.setTextSelection(from + caretOffset);
	}
}

function insertPlainTextAt(editor: TiptapEditor, text: string): void {
	const nodes = inlineNodesFromText(text);
	if (!nodes.length) return;
	editor
		.chain()
		.focus()
		.insertContentAt(editor.state.selection.from, nodes, {
			updateSelection: true,
		})
		.run();
}

function insertDomPicker(editor: TiptapEditor, text: string): boolean {
	const parsed = parseDomPicker(text);
	if (!parsed) return false;
	const from = editor.state.selection.from;
	editor
		.chain()
		.focus()
		.insertContentAt(from, {
			type: "domPicker",
			attrs: {
				selector: parsed.selector,
				html: parsed.html,
				raw: parsed.raw,
				expanded: false,
			},
		})
		.run();
	return true;
}

function insertLongTextChip(editor: TiptapEditor, text: string): void {
	const lines = text.split(/\r?\n/).length;
	const from = editor.state.selection.from;
	editor
		.chain()
		.focus()
		.insertContentAt(from, {
			type: "longText",
			attrs: { text, lines },
		})
		.run();
}

// ── Keyboard bridge ────────────────────────────────────────────────────────
// All key interception lives in one Tiptap extension (priority above the core
// keymap) that forwards to the latest component actions via a module-level ref.

interface ChatInputUiActions {
	editor: () => TiptapEditor | null;
	isComposing: () => boolean;
	lastCompositionEndAt: () => number;
	value: () => string;
	historyMenuOpen: boolean;
	historyActiveIndex: number;
	inputHistory: string[];
	applyHistoryInput: (text: string) => void;
	setHistoryMenuOpen: (open: boolean) => void;
	setHistoryActiveIndex: (updater: number | ((prev: number) => number)) => void;
	slashMenuOpen: boolean;
	slashQuery: string | null;
	displayedSlashCommands: SlashCommandPaletteItem[];
	slashActiveIndex: number;
	applySlashCommand: (command: SlashCommandPaletteItem) => void;
	getNextSlashIndex: (direction: "up" | "down" | "left" | "right") => number;
	setSlashMenuOpen: (open: boolean) => void;
	setSlashActiveIndex: (updater: number | ((prev: number) => number)) => void;
	atMenuOpen: boolean;
	atQuery: AtQueryMatch | null;
	atMatches: FileIndexEntry[];
	atActiveIndex: number;
	applyAtCompletion: (entry: FileIndexEntry) => void;
	setAtMenuOpen: (open: boolean) => void;
	setAtActiveIndex: (updater: number | ((prev: number) => number)) => void;
	isStreaming: boolean;
	onSteer: Props["onSteer"];
	onFollowUp: Props["onFollowUp"];
	onAbort: Props["onAbort"];
	sendQueued: (mode: "steer" | "followup") => void;
	isMobile: boolean;
	handleSend: () => void;
}

const chatInputUiRef: { current: ChatInputUiActions | null } = {
	current: null,
};

const ChatInputKeyboard = Extension.create({
	name: "chatInputKeyboard",
	// Above the core keymap extension (default priority 100) so Enter/arrows are
	// intercepted before ProseMirror's default bindings run.
	priority: 300,
	addKeyboardShortcuts() {
		const ui = () => chatInputUiRef.current;
		const onEnter = (): boolean => {
			const actions = ui();
			if (!actions) return false;
			const editor = actions.editor();
			const composing =
				actions.isComposing() || Boolean(editor?.view.composing);
			const recentlyComposed =
				Date.now() - actions.lastCompositionEndAt() <
				COMPOSITION_END_ENTER_GRACE_MS;
			if (composing || recentlyComposed) return true;
			if (actions.isMobile) return false; // 移动端 Enter 换行，Ctrl/Cmd+Enter 发送
			if (
				actions.historyMenuOpen &&
				actions.inputHistory[actions.historyActiveIndex]
			) {
				actions.applyHistoryInput(
					actions.inputHistory[actions.historyActiveIndex],
				);
				return true;
			}
			if (
				actions.slashMenuOpen &&
				actions.slashQuery !== null &&
				actions.displayedSlashCommands[actions.slashActiveIndex]
			) {
				actions.applySlashCommand(
					actions.displayedSlashCommands[actions.slashActiveIndex],
				);
				return true;
			}
			if (
				actions.atMenuOpen &&
				actions.atQuery !== null &&
				actions.atMatches[actions.atActiveIndex]
			) {
				actions.applyAtCompletion(actions.atMatches[actions.atActiveIndex]);
				return true;
			}
			if (actions.isStreaming && (actions.onSteer || actions.onFollowUp)) {
				actions.sendQueued(actions.onSteer ? "steer" : "followup");
			} else {
				actions.handleSend();
			}
			return true;
		};
		const onArrow = (direction: "up" | "down" | "left" | "right"): boolean => {
			const actions = ui();
			if (!actions) return false;
			if (actions.historyMenuOpen && !actions.isComposing()) {
				if (direction === "down") {
					actions.setHistoryActiveIndex((i) =>
						Math.min(Math.max(0, actions.inputHistory.length - 1), i + 1),
					);
					return true;
				}
				if (direction === "up") {
					actions.setHistoryActiveIndex((i) => Math.max(0, i - 1));
					return true;
				}
			}
			if (actions.slashMenuOpen && actions.slashQuery !== null) {
				actions.setSlashActiveIndex(actions.getNextSlashIndex(direction));
				return true;
			}
			if (
				actions.atMenuOpen &&
				actions.atQuery !== null &&
				!actions.isComposing()
			) {
				if (direction === "down") {
					actions.setAtActiveIndex((i) =>
						Math.min(Math.max(0, actions.atMatches.length - 1), i + 1),
					);
					return true;
				}
				if (direction === "up") {
					actions.setAtActiveIndex((i) => Math.max(0, i - 1));
					return true;
				}
			}
			if (
				direction === "up" &&
				!actions.isComposing() &&
				!actions.isStreaming &&
				actions.inputHistory.length > 0 &&
				actions.value().trim().length === 0
			) {
				actions.setSlashMenuOpen(false);
				actions.setAtMenuOpen(false);
				actions.setHistoryActiveIndex(actions.inputHistory.length - 1);
				actions.setHistoryMenuOpen(true);
				return true;
			}
			return false;
		};
		const onEscape = (): boolean => {
			const actions = ui();
			if (!actions) return false;
			if (actions.historyMenuOpen) {
				actions.setHistoryMenuOpen(false);
				return true;
			}
			if (actions.slashMenuOpen) {
				actions.setSlashMenuOpen(false);
				return true;
			}
			if (actions.atMenuOpen) {
				actions.setAtMenuOpen(false);
				return true;
			}
			if (actions.isStreaming && actions.onAbort) {
				actions.onAbort();
				return true;
			}
			return false;
		};
		const onTab = (): boolean => {
			const actions = ui();
			if (!actions) return false;
			if (
				actions.historyMenuOpen &&
				actions.inputHistory[actions.historyActiveIndex]
			) {
				actions.applyHistoryInput(
					actions.inputHistory[actions.historyActiveIndex],
				);
				return true;
			}
			if (
				actions.slashMenuOpen &&
				actions.slashQuery !== null &&
				actions.displayedSlashCommands[actions.slashActiveIndex]
			) {
				actions.applySlashCommand(
					actions.displayedSlashCommands[actions.slashActiveIndex],
				);
				return true;
			}
			if (
				actions.atMenuOpen &&
				actions.atQuery !== null &&
				actions.atMatches[actions.atActiveIndex]
			) {
				actions.applyAtCompletion(actions.atMatches[actions.atActiveIndex]);
				return true;
			}
			return false;
		};
		return {
			Enter: onEnter,
			"Mod-Enter": onEnter,
			"Shift-Enter": () => false,
			ArrowUp: () => onArrow("up"),
			ArrowDown: () => onArrow("down"),
			ArrowLeft: () => onArrow("left"),
			ArrowRight: () => onArrow("right"),
			Escape: onEscape,
			Tab: onTab,
			// Neutralize StarterKit's markdown shortcuts so typing/shortcut use can
			// never turn the plain-text input into headings/lists (textarea parity).
			"Mod-Alt-1": () => true,
			"Mod-Alt-2": () => true,
			"Mod-Alt-3": () => true,
			"Mod-Alt-4": () => true,
			"Mod-Alt-5": () => true,
			"Mod-Alt-6": () => true,
			"Mod-Shift-7": () => true,
			"Mod-Shift-8": () => true,
			"Mod-Shift-9": () => true,
			"Mod-Shift-b": () => true,
			"Mod-Alt-c": () => true,
			"Mod-Alt--": () => true,
			"Mod-Alt-0": () => true,
			"Mod-Alt-\\": () => true,
		};
	},
});

function QueuedMessageRow({
	kind,
	text,
}: {
	kind: "steer" | "follow-up";
	text: string;
}) {
	return (
		<div
			title={text}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "3px 10px",
				fontSize: 12,
				color: "var(--text-muted)",
				minWidth: 0,
			}}
		>
			<span
				style={{
					flexShrink: 0,
					fontSize: 10,
					fontFamily: "var(--font-mono)",
					padding: "1px 7px",
					borderRadius: 999,
					border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
					color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
				}}
			>
				{kind}
			</span>
			<span
				style={{
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{text}
			</span>
		</div>
	);
}

function ModelNoticeBanner({
	tone,
	title,
	body,
}: {
	tone: "error" | "warning";
	title: string;
	body: string;
}) {
	const color = tone === "error" ? "239,68,68" : "234,179,8";
	return (
		<div
			role="alert"
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: 8,
				maxHeight: 120,
				marginBottom: 8,
				padding: "7px 10px",
				overflowY: "auto",
				border: `1px solid rgba(${color},0.3)`,
				borderRadius: 6,
				background: `rgba(${color},0.07)`,
				color: `rgb(${color})`,
				fontSize: 11,
				lineHeight: 1.45,
			}}
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{ flexShrink: 0, marginTop: 1 }}
				aria-hidden="true"
			>
				<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" />
				<line x1="12" y1="9" x2="12" y2="13" />
				<line x1="12" y1="17" x2="12.01" y2="17" />
			</svg>
			<div style={{ minWidth: 0 }}>
				<div style={{ fontWeight: 600 }}>{title}</div>
				<div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
					{body}
				</div>
			</div>
		</div>
	);
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
	if (!error) return null;
	return <ModelNoticeBanner tone="error" title="Model error" body={error} />;
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
	if (!warnings || warnings.length === 0) return null;
	return (
		<ModelNoticeBanner
			tone="warning"
			title={
				warnings.length > 1 ? "Model scope warnings" : "Model scope warning"
			}
			body={warnings.join("\n")}
		/>
	);
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
	{
		onSend,
		onAbort,
		onSteer,
		onFollowUp,
		isStreaming,
		model,
		isAutoModelSelection,
		modelNames,
		modelList,
		modelError,
		modelScopeWarnings,
		onModelChange,
		onCompact,
		onAbortCompaction,
		isCompacting,
		compactError,
		compactResult,
		toolPreset,
		onToolPresetChange,
		thinkingLevel,
		onThinkingLevelChange,
		availableThinkingLevels,
		thinkingLevelMap,
		retryInfo,
		queuedMessages,
		inputHistory = [],
		onRecallQueue,
		slashCommands,
		slashCommandsLoading,
		onLoadSlashCommands,
		onBuiltinCommand,
		soundEnabled,
		onSoundToggle,
		onAudioUnlock,
		onPromptWithStreamingBehavior,
		draftKey,
		cwd,
	}: Props,
	ref,
) {
	const { t } = useI18n();
	const isMobile = useIsMobile();
	const [value, setValue] = useState(() =>
		draftKey ? (getDraft(draftKey)?.value ?? "") : "",
	);
	const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
	const [modelDropdownRect, setModelDropdownRect] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const [modelFilter, setModelFilter] = useState("");
	const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
	const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
	const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() =>
		draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : [],
	);
	const trimmedValue = value.trimStart();
	const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
	const bashExcluded = bashMode && trimmedValue.startsWith("!!");
	const [slashMenuOpen, setSlashMenuOpen] = useState(false);
	const [slashActiveIndex, setSlashActiveIndex] = useState(0);
	const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
	const [atMenuOpen, setAtMenuOpen] = useState(false);
	const [atActiveIndex, setAtActiveIndex] = useState(0);
	const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
	const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
	const [fileIndex, setFileIndex] = useState<{
		cwd: string;
		entries: FileIndexEntry[];
		truncated: boolean;
	} | null>(null);
	const [fileIndexLoading, setFileIndexLoading] = useState(false);
	const [atServerResult, setAtServerResult] = useState<{
		cwd: string;
		query: string;
		matches: FileIndexEntry[];
	} | null>(null);
	const [skillDormancyState, setSkillDormancyState] = useState<{
		cwd: string;
		values: Record<string, boolean>;
	} | null>(null);
	const skillDormancy =
		cwd && skillDormancyState?.cwd === cwd ? skillDormancyState.values : {};

	const editorRef = useRef<TiptapEditor | null>(null);
	const editorDomRef = useRef<HTMLDivElement | null>(null);
	const placeholderTextRef = useRef("");
	const dropdownRef = useRef<HTMLDivElement>(null);
	const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
	const toolDropdownRef = useRef<HTMLDivElement>(null);
	const thinkingDropdownRef = useRef<HTMLDivElement>(null);
	const controlsMenuRef = useRef<HTMLDivElement>(null);
	const historyMenuRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isComposingRef = useRef(false);
	const lastCompositionEndAtRef = useRef(0);
	const slashCommandsRequestedRef = useRef(false);
	const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(
		null,
	);
	const fileIndexFetchingRef = useRef<string | null>(null);
	const draftKeyRef = useRef(draftKey);
	const valueRef = useRef(value);
	const attachedImagesRef = useRef(attachedImages);
	const pendingImageCountRef = useRef(0);
	valueRef.current = value;
	attachedImagesRef.current = attachedImages;

	useImperativeHandle(ref, () => ({
		insertIfEmpty(text: string) {
			const editor = editorRef.current;
			if (!editor) {
				if (!value.trim()) setValue(text);
				return;
			}
			if (editorToMarkdown(editor).trim()) return;
			editor
				.chain()
				.focus()
				.clearContent(false)
				.insertContent(markdownToContent(text))
				.run();
			editor.commands.setTextSelection(editor.state.doc.content.size);
			setAtQuery(null);
		},
		prependText(text: string) {
			if (!text.trim()) return;
			const editor = editorRef.current;
			if (!editor) {
				setValue((v) => [text, v].filter((t) => t.trim()).join("\n\n"));
				return;
			}
			// Mirrors the TUI's queue restore: queued text first, then whatever
			// the user already typed, separated by a blank line. Existing doc JSON
			// is kept so atomic chips survive.
			const currentJson = editor.getJSON();
			const newContent = [
				...markdownToContent(text),
				{ type: "paragraph" },
				...(currentJson.content ?? []),
			];
			editor.commands.setContent({ type: "doc", content: newContent });
			editor.commands.focus("end");
			setAtQuery(null);
		},
		insertText(text: string) {
			const editor = editorRef.current;
			if (!editor) {
				setValue((v) => v + (v ? " " : "") + text);
				return;
			}
			if (isDomPickerText(text)) {
				insertDomPicker(editor, text);
				setAtQuery(null);
				return;
			}
			if (text.split(/\r\n|\r|\n/).length >= LONG_TEXT_LINE_THRESHOLD) {
				insertLongTextChip(editor, text);
				setAtQuery(null);
				return;
			}
			const from = editor.state.selection.from;
			const before = editor.state.doc.textBetween(
				Math.max(0, from - 1),
				from,
				"\n",
				" ",
			);
			const sep = before && !before.endsWith(" ") ? " " : "";
			insertPlainTextAt(editor, sep + text);
			setAtQuery(null);
		},
		addImages(files: File[]) {
			processImageFiles(files);
		},
	}));

	const processImageFiles = useCallback(
		async (files: File[]) => {
			if (isStreaming) return;
			const remaining = Math.max(
				0,
				MAX_ATTACHED_IMAGES -
					attachedImagesRef.current.length -
					pendingImageCountRef.current,
			);
			const imageFiles = files
				.filter(
					(f) =>
						f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES,
				)
				.slice(0, remaining);
			if (!imageFiles.length) return;
			pendingImageCountRef.current += imageFiles.length;
			try {
				const newImages = await Promise.all(
					imageFiles.map(
						(file) =>
							new Promise<AttachedImage>((resolve, reject) => {
								const reader = new FileReader();
								reader.onload = () => {
									const result = reader.result as string;
									// result is "data:<mime>;base64,<data>"
									const base64 = result.split(",")[1];
									resolve({
										data: base64,
										mimeType: file.type,
										previewUrl: URL.createObjectURL(file),
									});
								};
								reader.onerror = reject;
								reader.readAsDataURL(file);
							}),
					),
				);
				setAttachedImages((prev) => {
					const accepted = newImages.slice(
						0,
						Math.max(0, MAX_ATTACHED_IMAGES - prev.length),
					);
					newImages.slice(accepted.length).forEach(revokeImagePreview);
					return [...prev, ...accepted];
				});
			} finally {
				pendingImageCountRef.current -= imageFiles.length;
			}
		},
		[isStreaming],
	);
	const processImageFilesRef = useRef(processImageFiles);
	processImageFilesRef.current = processImageFiles;

	const removeImage = useCallback((index: number) => {
		setAttachedImages((prev) => {
			const next = [...prev];
			const [removed] = next.splice(index, 1);
			if (removed) revokeImagePreview(removed);
			return next;
		});
	}, []);

	const clearImages = useCallback(() => {
		setAttachedImages((prev) => {
			prev.forEach(revokeImagePreview);
			return [];
		});
	}, []);

	const clearInput = useCallback(() => {
		const editor = editorRef.current;
		if (editor) {
			editor.chain().focus().clearContent(false).run();
			valueRef.current = "";
		}
		setValue("");
		setAtQuery(null);
		setHistoryMenuOpen(false);
		if (draftKey) clearDraft(draftKey);
		if (draftKeyRef.current && draftKeyRef.current !== draftKey)
			clearDraft(draftKeyRef.current);
		clearImages();
	}, [clearImages, draftKey]);

	useEffect(() => {
		if (!draftKey || draftKeyRef.current !== draftKey) return;
		setDraft(draftKey, {
			value,
			images: attachedImages.map(imageToDraftImage),
			doc: editorRef.current?.getJSON() ?? null,
		});
	}, [attachedImages, draftKey, value]);

	useEffect(() => {
		const previousDraftKey = draftKeyRef.current;
		if (previousDraftKey === draftKey) return;

		if (previousDraftKey) {
			setDraft(previousDraftKey, {
				value: valueRef.current,
				images: attachedImagesRef.current.map(imageToDraftImage),
				doc: editorRef.current?.getJSON() ?? null,
			});
		}

		const draft = draftKey ? getDraft(draftKey) : null;
		draftKeyRef.current = draftKey;
		const restoredValue = draft?.value ?? "";
		const editor = editorRef.current;
		if (editor) {
			const docJson = draft?.doc ?? {
				type: "doc",
				content: markdownToContent(restoredValue),
			};
			editor.commands.setContent(docJson as JSONContent, { emitUpdate: false });
		}
		valueRef.current = restoredValue;
		setValue(restoredValue);
		setAtQuery(null);
		setHistoryMenuOpen(false);
		setAttachedImages((prev) => {
			prev.forEach(revokeImagePreview);
			return draftImagesToAttachedImages(draft?.images);
		});
	}, [draftKey]);

	useEffect(() => {
		return () => {
			attachedImagesRef.current.forEach(revokeImagePreview);
		};
	}, []);

	const handleSend = useCallback(async () => {
		// Restore the full editor payload (collapsed long text, DOM HTML, chips)
		// into the original Markdown/plain-text form before handing it to the backend.
		const editor = editorRef.current;
		const msg = (editor ? editorToMarkdown(editor) : value).trim();
		if (!msg && !attachedImages.length) return;
		if (isStreaming) return;
		onAudioUnlock?.();
		if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
			const result = await onBuiltinCommand(msg);
			if (result.handled) {
				if (!result.error) clearInput();
				return;
			}
		}
		onSend(msg, attachedImages.length ? attachedImages : undefined);
		clearInput();
	}, [
		value,
		attachedImages,
		isStreaming,
		onBuiltinCommand,
		onSend,
		clearInput,
		onAudioUnlock,
	]);

	const slashQuery =
		value.startsWith("/") && !/\s/.test(value.slice(1))
			? value.slice(1).toLowerCase()
			: null;

	const filteredSlashCommands = (() => {
		if (slashQuery === null) return [];
		const commands = [
			...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS),
			...(slashCommands ?? []),
		];
		return [...commands]
			.filter((command) => {
				const name = command.name.toLowerCase();
				const description = getSlashDescription(command, t).toLowerCase();
				return name.includes(slashQuery) || description.includes(slashQuery);
			})
			.sort((a, b) => {
				const rankDelta =
					slashMatchRank(a, slashQuery, t) - slashMatchRank(b, slashQuery, t);
				if (rankDelta !== 0) return rankDelta;
				return (
					SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source] ||
					MODEL_OPTION_COLLATOR.compare(a.name, b.name)
				);
			});
	})();

	const { commands: displayedSlashCommands, groups: groupedSlashCommands } =
		buildSlashCommandLayout(filteredSlashCommands, skillDormancy);

	const slashCommandCountLabel =
		filteredSlashCommands.length === 1
			? t(slashQuery ? "chat.match" : "chat.command")
			: t(slashQuery ? "chat.matches" : "chat.commands", {
					count: filteredSlashCommands.length,
				});
	const hasInputText = Boolean(value.trim());
	const canQueueStreamingMessage = hasInputText && attachedImages.length === 0;

	// ── @ file autocomplete ──────────────────────────────────────────────────
	// Recomputed from the editor text before the caret on every change/caret
	// move. Disabled entirely when there is no cwd (new session without a
	// directory). Atomic chips contribute a single placeholder char each, so
	// token detection matches the original textarea semantics exactly.
	const updateAtQueryFromEditor = useCallback(() => {
		if (!cwd) {
			setAtQuery(null);
			return;
		}
		const editor = editorRef.current;
		if (!editor) return;
		const ctx = paragraphCtx(editor, editor.state.selection.from);
		setAtQuery(ctx ? extractAtQuery(ctx.text) : null);
	}, [cwd]);
	const updateAtQueryFromEditorRef = useRef(updateAtQueryFromEditor);
	updateAtQueryFromEditorRef.current = updateAtQueryFromEditor;

	const atQueryText = atQuery?.query ?? null;
	const atLocalMatches: FileIndexEntry[] = React.useMemo(
		() =>
			atQueryText !== null && fileIndex && fileIndex.cwd === cwd
				? filterFileEntries(fileIndex.entries, atQueryText)
				: [],
		[atQueryText, fileIndex, cwd],
	);

	// When the client index is truncated (repo larger than the index cap),
	// local filtering cannot see deep files, so queries are also ranked
	// server-side against the full listing. Local matches render immediately
	// and are replaced when the (debounced) server result for the current
	// query arrives; stale responses are ignored via the query/cwd tag.
	const needsServerSearch = Boolean(
		atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd,
	);
	useEffect(() => {
		if (!needsServerSearch || !cwd || !atQueryText) return;
		const fetchCwd = cwd;
		const query = atQueryText;
		const timer = setTimeout(() => {
			fetch(
				`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`,
			)
				.then((res) => {
					if (!res.ok) throw new Error(`file search failed: ${res.status}`);
					return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
				})
				.then((data) =>
					setAtServerResult({
						cwd: fetchCwd,
						query,
						matches: data.matches ?? [],
					}),
				)
				.catch(() => {
					// Keep showing local matches; the next keystroke retries.
				});
		}, 150);
		return () => clearTimeout(timer);
	}, [needsServerSearch, atQueryText, cwd]);

	const serverResultInUse =
		needsServerSearch &&
		atServerResult !== null &&
		atServerResult.cwd === cwd &&
		atServerResult.query === atQueryText;
	const atMatches: FileIndexEntry[] = serverResultInUse
		? atServerResult.matches
		: atLocalMatches;

	// Open/reset the menu whenever the @token appears or changes (mirrors the
	// slash menu: Escape closes it, the next keystroke re-opens it).
	const atTokenKey =
		atQuery === null
			? null
			: `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
	useEffect(() => {
		if (atTokenKey === null) {
			setAtMenuOpen(false);
			setAtActiveIndex(0);
			return;
		}
		setAtMenuOpen(true);
		setAtActiveIndex(0);
	}, [atTokenKey]);

	// Fetch the file index when the menu opens. The server caches per cwd for
	// ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
	const atTokenActive = atQuery !== null;
	useEffect(() => {
		if (!atTokenActive || !cwd) return;
		const meta = fileIndexMetaRef.current;
		if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000)
			return;
		if (fileIndexFetchingRef.current === cwd) return;
		fileIndexFetchingRef.current = cwd;
		const fetchCwd = cwd;
		setFileIndexLoading(true);
		fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
			.then((res) => {
				if (!res.ok) throw new Error(`file index failed: ${res.status}`);
				return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
			})
			.then((data) => {
				setFileIndex({
					cwd: fetchCwd,
					entries: buildEntriesFromFiles(data.files ?? []),
					truncated: !!data.truncated,
				});
				fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
			})
			.catch(() => {
				// Leave any previous index in place; next open retries.
				fileIndexMetaRef.current = null;
			})
			.finally(() => {
				fileIndexFetchingRef.current = null;
				setFileIndexLoading(false);
			});
	}, [atTokenActive, cwd]);

	const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
		const editor = editorRef.current;
		if (!editor) return;
		const caret = editor.state.selection.from;
		const ctx = paragraphCtx(editor, caret);
		if (!ctx) return;
		const match = extractAtQuery(ctx.text);
		if (!match) return;
		const docFrom = charToDocPos(ctx, match.start);
		if (docFrom === null) return;
		// Completing inside a quoted token (@"my dir/… with the caret before the
		// closing quote): the replacement carries its own closing quote, so drop
		// the old one right after the caret (mirrors the TUI's applyCompletion).
		let docTo = caret;
		if (match.quoted) {
			const after = editor.state.doc.textBetween(caret, caret + 1, "\n", " ");
			if (after === '"') docTo = caret + 1;
		}
		const insert = buildAtInsertText(entry.path, entry.isDir, match.quoted);
		if (entry.isDir) {
			// Directories keep the menu open for drill-down: plain text with the
			// caret placed per buildAtInsertText (before a closing quote if quoted).
			insertNodesAtRange(
				editor,
				docFrom,
				docTo,
				inlineNodesFromText(insert.text),
				insert.cursorOffset,
			);
		} else {
			// Files become atomic mention chips: colored, rounded, non-splittable.
			const chipText = insert.text.endsWith(" ")
				? insert.text.slice(0, -1)
				: insert.text;
			const label =
				chipText.startsWith('@"') && chipText.endsWith('"')
					? "@" + chipText.slice(2, -1)
					: chipText;
			insertNodesAtRange(editor, docFrom, docTo, [
				{ type: "mention", attrs: { kind: "file", label, text: chipText } },
				{ type: "text", text: " " },
			]);
		}
		setAtMenuOpen(false);
		setAtActiveIndex(0);
	}, []);

	useEffect(() => {
		if (atActiveIndex >= atMatches.length) {
			setAtActiveIndex(Math.max(0, atMatches.length - 1));
		}
	}, [atMatches.length, atActiveIndex]);

	useEffect(() => {
		atItemRefs.current.length = atMatches.length;
	}, [atMatches.length]);

	useEffect(() => {
		if (!atMenuOpen) return;
		atItemRefs.current[atActiveIndex]?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [atActiveIndex, atMenuOpen]);

	useEffect(() => {
		if (historyActiveIndex >= inputHistory.length) {
			setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
		}
	}, [inputHistory.length, historyActiveIndex]);

	useEffect(() => {
		historyItemRefs.current.length = inputHistory.length;
	}, [inputHistory.length]);

	useEffect(() => {
		if (!historyMenuOpen) return;
		historyItemRefs.current[historyActiveIndex]?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [historyActiveIndex, historyMenuOpen]);

	const applyHistoryInput = useCallback((text: string) => {
		const editor = editorRef.current;
		if (editor) {
			editor
				.chain()
				.focus()
				.clearContent(false)
				.insertContent(markdownToContent(text))
				.run();
			editor.commands.setTextSelection(editor.state.doc.content.size);
		} else {
			setValue(text);
		}
		setHistoryMenuOpen(false);
		setHistoryActiveIndex(0);
		setAtQuery(null);
	}, []);

	const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
		const editor = editorRef.current;
		if (!editor) {
			setValue(`/${command.name} `);
		} else {
			const text = `/${command.name}`;
			editor
				.chain()
				.focus()
				.clearContent(false)
				.insertContent([
					{ type: "mention", attrs: { kind: "command", label: text, text } },
					{ type: "text", text: " " },
				])
				.run();
			editor.commands.focus();
		}
		setSlashMenuOpen(false);
		setSlashActiveIndex(0);
	}, []);

	const sendQueued = useCallback(
		(mode: "steer" | "followup") => {
			const editor = editorRef.current;
			const msg = (editor ? editorToMarkdown(editor) : value).trim();
			if (!msg && !attachedImages.length) return;
			if (attachedImages.length) return;
			onAudioUnlock?.();
			const streamingBehavior = mode === "steer" ? "steer" : "followUp";
			if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
				onPromptWithStreamingBehavior(
					msg,
					streamingBehavior,
					attachedImages.length ? attachedImages : undefined,
				);
				clearInput();
				return;
			}
			if (mode === "steer" && onSteer) {
				onSteer(msg, attachedImages.length ? attachedImages : undefined);
			} else if (mode === "followup" && onFollowUp) {
				onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
			}
			clearInput();
		},
		[
			value,
			attachedImages,
			onPromptWithStreamingBehavior,
			onSteer,
			onFollowUp,
			clearInput,
			onAudioUnlock,
		],
	);

	const getNextSlashIndex = useCallback(
		(direction: "up" | "down" | "left" | "right") => {
			const lastIndex = displayedSlashCommands.length - 1;
			if (lastIndex < 0) return 0;

			if (direction === "left") return Math.max(0, slashActiveIndex - 1);
			if (direction === "right")
				return Math.min(lastIndex, slashActiveIndex + 1);

			const currentNode = slashItemRefs.current[slashActiveIndex];
			if (!currentNode) {
				return direction === "down"
					? Math.min(lastIndex, slashActiveIndex + 1)
					: Math.max(0, slashActiveIndex - 1);
			}

			const currentRect = currentNode.getBoundingClientRect();
			const currentX = currentRect.left + currentRect.width / 2;
			const currentY = currentRect.top + currentRect.height / 2;
			let bestIndex = -1;
			let bestScore = Number.POSITIVE_INFINITY;

			for (let index = 0; index <= lastIndex; index += 1) {
				if (index === slashActiveIndex) continue;
				const node = slashItemRefs.current[index];
				if (!node) continue;
				const rect = node.getBoundingClientRect();
				const candidateY = rect.top + rect.height / 2;
				const verticalDelta = candidateY - currentY;
				if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4)
					continue;

				const candidateX = rect.left + rect.width / 2;
				const score =
					Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
				if (score < bestScore) {
					bestIndex = index;
					bestScore = score;
				}
			}

			if (bestIndex >= 0) return bestIndex;
			return direction === "down"
				? Math.min(lastIndex, slashActiveIndex + 1)
				: Math.max(0, slashActiveIndex - 1);
		},
		[displayedSlashCommands.length, slashActiveIndex],
	);

	// Keyboard interception is implemented as a Tiptap keymap extension
	// (ChatInputKeyboard, priority 300) that forwards to these latest actions.
	chatInputUiRef.current = {
		editor: () => editorRef.current,
		isMobile,
		isComposing: () => isComposingRef.current,
		lastCompositionEndAt: () => lastCompositionEndAtRef.current,
		value: () => valueRef.current,
		historyMenuOpen,
		historyActiveIndex,
		inputHistory,
		applyHistoryInput,
		setHistoryMenuOpen,
		setHistoryActiveIndex,
		slashMenuOpen,
		slashQuery,
		displayedSlashCommands,
		slashActiveIndex,
		applySlashCommand,
		getNextSlashIndex,
		setSlashMenuOpen,
		setSlashActiveIndex,
		atMenuOpen,
		atQuery,
		atMatches,
		atActiveIndex,
		applyAtCompletion,
		setAtMenuOpen,
		setAtActiveIndex,
		isStreaming,
		onSteer,
		onFollowUp,
		onAbort,
		sendQueued,
		handleSend,
	};

	const handleEditorPaste = useCallback(
		(_view: EditorView, event: ClipboardEvent): boolean => {
			const editor = editorRef.current;
			if (!editor) return false;
			// Text first: rich clipboards often carry BOTH text and an image item
			// (e.g. copying from a web page). If we checked images first we would
			// silently discard the pasted text. Images are handled only when the
			// clipboard carries no text at all.
			let text = event.clipboardData?.getData("text/plain") ?? "";
			if (!text) {
				// Some apps only provide text/html — extract plain text so long-text
				// collapsing and DOM-picker detection still apply.
				const html = event.clipboardData?.getData("text/html") ?? "";
				if (html) text = clipboardHtmlToText(html);
			}
			if (text) {
				event.preventDefault();
				if (isDomPickerText(text)) {
					// DOM picker blocks paste back as their card form too.
					insertDomPicker(editor, text);
				} else if (
					text.split(/\r\n|\r|\n/).length >= LONG_TEXT_LINE_THRESHOLD
				) {
					// More than 10 lines — collapse into an atomic “展开长文本” card so the
					// input box never gets blown up by pasted code.
					insertLongTextChip(editor, text);
				} else {
					insertPlainTextAt(editor, text);
				}
				return true;
			}
			const items = Array.from(event.clipboardData?.items ?? []);
			const imageItems = items.filter((item) => item.type.startsWith("image/"));
			if (imageItems.length > 0) {
				event.preventDefault();
				const files = imageItems
					.map((item) => item.getAsFile())
					.filter((f): f is File => f !== null);
				processImageFilesRef.current(files);
				return true;
			}
			return false;
		},
		[],
	);

	// ── Tiptap editor ────────────────────────────────────────────────────────
	// The editor replaces the native <textarea>: plain typing stays plain (all
	// input/paste rules are disabled; pastes are handled manually above), while
	// atomic chips carry mentions / collapsed long text / DOM picker cards.
	// `value` mirrors the serialized Markdown on every transaction so all
	// existing derived state (bashMode, slashQuery, send button, …) keeps working.
	const initialDocRef = useRef<JSONContent | null>(null);
	if (initialDocRef.current === null) {
		const draft = draftKey ? getDraft(draftKey) : null;
		initialDocRef.current = draft?.doc
			? (draft.doc as JSONContent)
			: { type: "doc", content: markdownToContent(draft?.value ?? "") };
	}

	const editor = useEditor(
		{
			extensions: [
				StarterKit.configure({}),
				Placeholder.configure({
					placeholder: () => placeholderTextRef.current,
				}),
				MentionNode,
				LongTextNode,
				DomPickerNode,
				ChatInputKeyboard,
			],
			content: initialDocRef.current,
			immediatelyRender: false,
			// Typing markdown like "# foo" must stay literal text (textarea parity).
			enableInputRules: false,
			enablePasteRules: false,
			editorProps: {
				attributes: { class: "chat-input-editor" },
				handlePaste: handleEditorPaste,
			},
			onUpdate: ({ editor: e }) => {
				const md = editorToMarkdown(e);
				valueRef.current = md;
				setValue(md);
				setHistoryMenuOpen(false);
				updateAtQueryFromEditorRef.current();
			},
			onSelectionUpdate: () => {
				updateAtQueryFromEditorRef.current();
			},
		},
		[],
	);

	useEffect(() => {
		editorRef.current = editor;
		editorDomRef.current = editor ? (editor.view.dom as HTMLDivElement) : null;
		return () => {
			editorRef.current = null;
			editorDomRef.current = null;
		};
	}, [editor]);

	// Track IME composition so Enter right after compositionend is swallowed
	// (mirrors the old textarea's composition grace period).
	useEffect(() => {
		const dom = editor?.view?.dom;
		if (!dom) return;
		const onCompositionStart = () => {
			isComposingRef.current = true;
		};
		const onCompositionEnd = () => {
			isComposingRef.current = false;
			lastCompositionEndAtRef.current = Date.now();
			updateAtQueryFromEditorRef.current();
		};
		dom.addEventListener("compositionstart", onCompositionStart);
		dom.addEventListener("compositionend", onCompositionEnd);
		return () => {
			dom.removeEventListener("compositionstart", onCompositionStart);
			dom.removeEventListener("compositionend", onCompositionEnd);
		};
	}, [editor]);

	// Keep the placeholder in sync with the streaming state.
	useEffect(() => {
		placeholderTextRef.current =
			isStreaming && (onSteer || onFollowUp)
				? t("chat.steerPlaceholder")
				: isStreaming
					? t("chat.agentPlaceholder")
					: t("chat.messagePlaceholder");
		const ed = editorRef.current;
		if (ed) ed.view.dispatch(ed.state.tr); // force placeholder decorations to re-run
	}, [isStreaming, onSteer, onFollowUp, t]);

	useEffect(() => {
		if (slashQuery === null) {
			setSlashMenuOpen(false);
			setSlashActiveIndex(0);
			slashCommandsRequestedRef.current = false;
			return;
		}
		setSlashMenuOpen(true);
		setSlashActiveIndex(0);
		if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
			slashCommandsRequestedRef.current = true;
			Promise.resolve(onLoadSlashCommands()).catch(() => {
				slashCommandsRequestedRef.current = false;
			});
		}
	}, [slashQuery, onLoadSlashCommands]);

	// Lazy-load skill dormancy (disable-model-invocation) each time the slash
	// palette opens, so toggles made in the skills panel are reflected on the
	// next open. Failures degrade silently to the unannotated palette.
	useEffect(() => {
		if (!slashMenuOpen || !cwd) return;
		const requestCwd = cwd;
		let cancelled = false;
		setSkillDormancyState({ cwd: requestCwd, values: {} });
		fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
			.then((res) => {
				if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
				return res.json() as Promise<Partial<SkillsResponse>>;
			})
			.then((data) => {
				if (cancelled) return;
				const dormancy: Record<string, boolean> = {};
				for (const skill of data.skills ?? [])
					dormancy[skill.name] = skill.disableModelInvocation;
				setSkillDormancyState({ cwd: requestCwd, values: dormancy });
			})
			.catch(() => {
				if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
			});
		return () => {
			cancelled = true;
		};
	}, [slashMenuOpen, cwd]);

	useEffect(() => {
		if (slashActiveIndex >= displayedSlashCommands.length) {
			setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
		}
	}, [displayedSlashCommands.length, slashActiveIndex]);

	useEffect(() => {
		slashItemRefs.current.length = displayedSlashCommands.length;
	}, [displayedSlashCommands.length]);

	useEffect(() => {
		if (!slashMenuOpen) return;
		slashItemRefs.current[slashActiveIndex]?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [slashActiveIndex, slashMenuOpen]);

	// Build model options: prefer modelList (has provider info), fallback to modelNames
	const modelOptions: ModelOption[] = (() => {
		if (modelList && modelList.length > 0) {
			return modelList
				.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }))
				.sort(compareModelOptions);
		}
		return Object.entries(modelNames ?? {})
			.map(([modelId, name]) => ({
				provider: model?.provider ?? "unknown",
				modelId,
				name,
			}))
			.sort(compareModelOptions);
	})();
	const filteredModelOptions = filterModelOptions(modelOptions, modelFilter);
	const showModelFilter = modelOptions.length > MODEL_FILTER_THRESHOLD;

	// Group options by provider, preserving insertion order
	const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
	for (const opt of filteredModelOptions) {
		const group = modelsByProvider.find((g) => g.provider === opt.provider);
		if (group) group.options.push(opt);
		else modelsByProvider.push({ provider: opt.provider, options: [opt] });
	}

	const displayModelName = model
		? (modelOptions.find(
				(o) => o.modelId === model.modelId && o.provider === model.provider,
			)?.name ?? model.modelId)
		: null;
	const currentName = displayModelName;

	const compactSavedTokens = compactResult
		? Math.max(
				0,
				compactResult.tokensBefore - compactResult.estimatedTokensAfter,
			)
		: 0;
	const compactResultText = compactResult
		? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatTokenCount(compactSavedTokens) })})`
		: null;
	const thinkingDisplayLabel = (() => {
		const lvl = thinkingLevel ?? "auto";
		if (lvl === "auto" || !thinkingLevelMap) return lvl;
		return thinkingLevelMap[lvl] ?? lvl;
	})();
	const toolPresetLabel =
		Object.entries(TOOL_PRESET_MAP).find(
			([, v]) => v === (toolPreset ?? "default"),
		)?.[0] ?? "default";

	// Close dropdowns on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(e.target as Node) &&
				modelDropdownPanelRef.current &&
				!modelDropdownPanelRef.current.contains(e.target as Node)
			) {
				setModelDropdownOpen(false);
				setModelFilter("");
			}
			if (
				toolDropdownRef.current &&
				!toolDropdownRef.current.contains(e.target as Node)
			) {
				setToolDropdownOpen(false);
			}
			if (
				thinkingDropdownRef.current &&
				!thinkingDropdownRef.current.contains(e.target as Node)
			) {
				setThinkingDropdownOpen(false);
			}
			if (
				controlsMenuRef.current &&
				!controlsMenuRef.current.contains(e.target as Node)
			) {
				setControlsMenuOpen(false);
			}
			if (
				historyMenuRef.current &&
				!historyMenuRef.current.contains(e.target as Node) &&
				!editorDomRef.current?.contains(e.target as Node)
			) {
				setHistoryMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	useEffect(() => {
		if (!isMobile) setControlsMenuOpen(false);
	}, [isMobile]);

	return (
		<div
			style={{
				flexShrink: 0,
				background: "transparent",
				padding: "0 16px 8px",
				paddingRight: isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
			}}
		>
			{/* Hidden file input */}
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				disabled={isStreaming}
				style={{ display: "none" }}
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					processImageFiles(files);
					e.target.value = "";
				}}
			/>
			<div style={{ maxWidth: 820, margin: "0 auto" }}>
				<ModelErrorBanner error={modelError} />
				<ModelScopeWarningBanner warnings={modelScopeWarnings} />
				{/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
				{(queuedMessages?.steering.length ?? 0) +
					(queuedMessages?.followUp.length ?? 0) >
					0 && (
					<div
						style={{
							marginBottom: 8,
							border: "1px solid var(--border)",
							borderRadius: 6,
							background: "var(--bg-panel)",
							padding: "5px 0",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 8,
								padding: "2px 8px 4px 10px",
							}}
						>
							<span
								style={{
									fontSize: 10,
									fontFamily: "var(--font-mono)",
									color: "var(--text-dim)",
									textTransform: "uppercase",
									letterSpacing: 0.4,
								}}
							>
								{t("chat.queued", {
									count:
										(queuedMessages?.steering.length ?? 0) +
										(queuedMessages?.followUp.length ?? 0),
								})}
							</span>
							{onRecallQueue && (
								<button
									onClick={onRecallQueue}
									title={t("chat.recallTitle")}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "4px 12px",
										fontSize: 12,
										color: "var(--text)",
										background: "transparent",
										border: "1px solid var(--border)",
										borderRadius: 7,
										cursor: "pointer",
										transition: "background 0.12s, border-color 0.12s",
										whiteSpace: "nowrap",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "var(--bg-hover)";
										e.currentTarget.style.borderColor =
											"color-mix(in srgb, var(--accent) 45%, var(--border))";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
										e.currentTarget.style.borderColor = "var(--border)";
									}}
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<polyline points="9 14 4 9 9 4" />
										<path d="M20 20v-7a4 4 0 0 0-4-4H4" />
									</svg>
									{t("chat.recall")}
								</button>
							)}
						</div>
						{queuedMessages?.steering.map((text, i) => (
							<QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
						))}
						{queuedMessages?.followUp.map((text, i) => (
							<QueuedMessageRow
								key={`followup-${i}`}
								kind="follow-up"
								text={text}
							/>
						))}
					</div>
				)}
				{/* Retry banner */}
				{retryInfo && (
					<div
						style={{
							marginBottom: 8,
							padding: "5px 10px",
							background: "rgba(234,179,8,0.08)",
							border: "1px solid rgba(234,179,8,0.25)",
							borderRadius: 6,
							fontSize: 12,
							color: "rgba(180,130,0,0.9)",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<svg
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ flexShrink: 0 }}
						>
							<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
							<path d="M3 3v5h5" />
						</svg>
						{t("chat.retrying", {
							attempt: retryInfo.attempt,
							max: retryInfo.maxAttempts,
						})}
						{retryInfo.errorMessage && (
							<span style={{ opacity: 0.7, marginLeft: 4 }}>
								— {retryInfo.errorMessage}
							</span>
						)}
					</div>
				)}
				{compactResultText && (
					<div
						style={{
							marginBottom: 8,
							padding: "5px 10px",
							background: "rgba(16,185,129,0.08)",
							border: "1px solid rgba(16,185,129,0.24)",
							borderRadius: 6,
							fontSize: 12,
							color: "rgba(5,150,105,0.95)",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<svg
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ flexShrink: 0 }}
						>
							<polyline points="20 6 9 17 4 12" />
						</svg>
						{compactResultText}
					</div>
				)}
				{compactError && (
					<div
						role="alert"
						style={{
							marginBottom: 8,
							padding: "7px 10px",
							background: "rgba(239,68,68,0.07)",
							border: "1px solid rgba(239,68,68,0.3)",
							borderRadius: 6,
							color: "var(--danger)",
							fontFamily: "var(--font-mono)",
							fontSize: 12,
							lineHeight: 1.5,
							whiteSpace: "pre-wrap",
							overflowWrap: "anywhere",
						}}
					>
						{compactError}
					</div>
				)}
				{/* Image previews */}
				{attachedImages.length > 0 && (
					<div
						style={{
							display: "flex",
							gap: 6,
							marginBottom: 6,
							flexWrap: "wrap",
						}}
					>
						{attachedImages.map((img, i) => (
							<div key={i} style={{ position: "relative", flexShrink: 0 }}>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={img.previewUrl}
									alt=""
									style={{
										width: 56,
										height: 56,
										objectFit: "cover",
										borderRadius: 6,
										border: "1px solid var(--border)",
										display: "block",
									}}
								/>
								<button
									onClick={() => removeImage(i)}
									style={{
										position: "absolute",
										top: -4,
										right: -4,
										width: 16,
										height: 16,
										borderRadius: "50%",
										background: "var(--bg-panel)",
										border: "1px solid var(--border)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										cursor: "pointer",
										padding: 0,
										color: "var(--text-muted)",
									}}
								>
									<svg
										width="8"
										height="8"
										viewBox="0 0 8 8"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
									>
										<line x1="1" y1="1" x2="7" y2="7" />
										<line x1="7" y1="1" x2="1" y2="7" />
									</svg>
								</button>
							</div>
						))}
					</div>
				)}

				{/* Main input */}
				<div style={{ position: "relative", minWidth: 0 }}>
					{historyMenuOpen && inputHistory.length > 0 && (
						<div
							ref={historyMenuRef}
							className="panel-content-in"
							style={{
								position: "absolute",
								left: 0,
								right: 0,
								bottom: "calc(100% + 8px)",
								zIndex: 120,
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
								overflow: "hidden",
								maxHeight: "min(44vh, 360px)",
							}}
						>
							<div
								title="Input history"
								style={{
									height: 30,
									padding: "0 10px",
									borderBottom: "1px solid var(--border)",
									display: "flex",
									alignItems: "center",
									color: "var(--text-dim)",
								}}
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<path d="M3 12a9 9 0 1 0 3-6.7" />
									<path d="M3 4v5h5" />
									<path d="M12 7v5l3 2" />
								</svg>
							</div>
							<div
								style={{
									maxHeight: "calc(min(44vh, 360px) - 31px)",
									overflowY: "auto",
									padding: 4,
								}}
							>
								{inputHistory.map((item, index) => {
									const active = index === historyActiveIndex;
									return (
										<button
											key={`${index}:${item}`}
											ref={(node) => {
												historyItemRefs.current[index] = node;
											}}
											type="button"
											onMouseDown={(e) => {
												e.preventDefault();
												applyHistoryInput(item);
											}}
											onMouseEnter={() => setHistoryActiveIndex(index)}
											style={{
												width: "100%",
												display: "flex",
												alignItems: "flex-start",
												gap: 8,
												padding: "7px 8px",
												border: "none",
												borderRadius: 6,
												background: active ? "var(--bg-selected)" : "none",
												color: "var(--text)",
												cursor: "pointer",
												textAlign: "left",
												fontSize: 12.5,
												lineHeight: 1.45,
											}}
										>
											<span
												style={{
													flexShrink: 0,
													fontFamily: "var(--font-mono)",
													fontSize: 11,
													color: "var(--text-dim)",
													paddingTop: 1,
												}}
											>
												{index + 1}
											</span>
											<span
												style={{
													minWidth: 0,
													display: "-webkit-box",
													WebkitBoxOrient: "vertical",
													WebkitLineClamp: 2,
													overflow: "hidden",
													overflowWrap: "anywhere",
												}}
											>
												{item}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					)}
					{slashMenuOpen && slashQuery !== null && (
						<div
							className="panel-content-in"
							style={{
								position: "absolute",
								left: 0,
								right: 0,
								bottom: "calc(100% + 10px)",
								zIndex: 120,
								background:
									"color-mix(in srgb, var(--bg-panel) 90%, transparent)",
								backdropFilter: "blur(16px)",
								WebkitBackdropFilter: "blur(16px)",
								border:
									"1px solid color-mix(in srgb, var(--border) 80%, var(--accent))",
								borderRadius: 12,
								boxShadow:
									"0 -8px 32px -4px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent)",
								overflow: "hidden",
								maxHeight: "min(56vh, 460px)",
							}}
						>
							<div
								style={{
									padding: "8px 10px",
									borderBottom: "1px solid var(--border)",
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 8,
									fontSize: 11,
									color: "var(--text-dim)",
								}}
							>
								<span>
									{slashCommandsLoading
										? t("chat.loadingCommands")
										: t("chat.slashCommands", {
												label: slashCommandCountLabel,
											})}
								</span>
								<span style={{ fontFamily: "var(--font-mono)" }}>
									{t("chat.tabEnter")}
								</span>
							</div>
							<div
								style={{
									maxHeight: "calc(min(56vh, 460px) - 34px)",
									overflowY: "auto",
									padding: 10,
								}}
							>
								{!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
									<div
										style={{
											padding: "2px 2px 4px",
											fontSize: 12,
											color: "var(--text-dim)",
										}}
									>
										{t("chat.noCommands")}
									</div>
								) : (
									groupedSlashCommands.map((group) => (
										<section key={group.source} style={{ marginBottom: 12 }}>
											<div
												style={{
													position: "sticky",
													top: -10,
													zIndex: 1,
													display: "flex",
													alignItems: "center",
													justifyContent: "space-between",
													gap: 8,
													padding: "4px 0 6px",
													background: "var(--bg)",
													color: "var(--text-dim)",
													fontSize: 10,
													fontWeight: 600,
													textTransform: "uppercase",
												}}
											>
												<span>
													{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}
												</span>
												<span
													style={{
														fontFamily: "var(--font-mono)",
														fontWeight: 500,
													}}
												>
													{group.items.length}
												</span>
											</div>
											<div
												style={{
													display: "grid",
													gridTemplateColumns:
														"repeat(auto-fit, minmax(220px, 1fr))",
													gap: 8,
												}}
											>
												{group.items.map(({ command, index }) => {
													const active = index === slashActiveIndex;
													const dormant = isDormantSkillCommand(
														command,
														skillDormancy,
													);
													return (
														<button
															key={`${command.source}:${command.name}`}
															ref={(node) => {
																slashItemRefs.current[index] = node;
															}}
															type="button"
															onMouseDown={(e) => {
																e.preventDefault();
																applySlashCommand(command);
															}}
															onMouseEnter={() => setSlashActiveIndex(index)}
															style={{
																width: "100%",
																minWidth: 0,
																minHeight: 58,
																display: "flex",
																flexDirection: "column",
																gap: 4,
																justifyContent: "center",
																padding: "9px 10px",
																border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
																borderRadius: 7,
																background: active
																	? "var(--bg-selected)"
																	: "var(--bg-panel)",
																color: "var(--text)",
																cursor: "pointer",
																textAlign: "left",
																boxShadow: active
																	? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)"
																	: "none",
															}}
														>
															<span
																style={{
																	fontSize: 13,
																	fontFamily: "var(--font-mono)",
																	overflowWrap: "anywhere",
																	wordBreak: "break-word",
																	color: dormant
																		? "var(--text-dim)"
																		: undefined,
																}}
															>
																/{command.name}
																{dormant && (
																	<span
																		style={{
																			marginLeft: 6,
																			padding: "0 4px",
																			border: "1px solid var(--border)",
																			borderRadius: 3,
																			fontSize: 9,
																			color: "var(--text-dim)",
																			whiteSpace: "nowrap",
																		}}
																	>
																		{t("chat.dormant")}
																	</span>
																)}
															</span>
															{command.description && (
																<span
																	style={{
																		display: "-webkit-box",
																		WebkitBoxOrient: "vertical",
																		WebkitLineClamp: 2,
																		overflow: "hidden",
																		fontSize: 11,
																		lineHeight: 1.35,
																		color: "var(--text-dim)",
																	}}
																>
																	{getSlashDescription(command, t)}
																</span>
															)}
														</button>
													);
												})}
											</div>
										</section>
									))
								)}
							</div>
						</div>
					)}
					{atMenuOpen &&
						atQuery !== null &&
						(() => {
							const indexLoading =
								fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
							const matchCountLabel =
								atMatches.length === 1
									? t("chat.match")
									: t("chat.matches", { count: atMatches.length });
							// With a truncated index, local results are provisional — the
							// debounced server search over the full listing replaces them.
							const truncatedHint =
								fileIndex?.truncated && !serverResultInUse
									? atQuery.query
										? t("chat.searchingAll")
										: t("chat.indexTruncated")
									: "";
							return (
								<div
									className="panel-content-in"
									style={{
										position: "absolute",
										left: 0,
										right: 0,
										bottom: "calc(100% + 10px)",
										zIndex: 120,
										background:
											"color-mix(in srgb, var(--bg-panel) 90%, transparent)",
										backdropFilter: "blur(16px)",
										WebkitBackdropFilter: "blur(16px)",
										border:
											"1px solid color-mix(in srgb, var(--border) 80%, var(--accent))",
										borderRadius: 12,
										boxShadow:
											"0 -8px 32px -4px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent)",
										overflow: "hidden",
										maxHeight: "min(48vh, 400px)",
									}}
								>
									<div
										style={{
											padding: "8px 10px",
											borderBottom: "1px solid var(--border)",
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											gap: 8,
											fontSize: 11,
											color: "var(--text-dim)",
										}}
									>
										<span>
											{indexLoading
												? t("chat.loadingFiles")
												: t("chat.files", {
														label: matchCountLabel,
														hint: truncatedHint,
													})}
										</span>
										<span style={{ fontFamily: "var(--font-mono)" }}>
											{t("chat.tabEnter")}
										</span>
									</div>
									<div
										style={{
											maxHeight: "calc(min(48vh, 400px) - 34px)",
											overflowY: "auto",
											padding: 4,
										}}
									>
										{!indexLoading && atMatches.length === 0 ? (
											<div
												style={{
													padding: "6px 8px",
													fontSize: 12,
													color: "var(--text-dim)",
												}}
											>
												{needsServerSearch && !serverResultInUse
													? t("chat.searching")
													: t("chat.noMatchingFiles")}
											</div>
										) : (
											atMatches.map((entry, index) => {
												const active = index === atActiveIndex;
												const name = entry.path.split("/").pop() ?? entry.path;
												const dirPrefix = entry.path.slice(
													0,
													entry.path.length - name.length,
												);
												return (
													<button
														key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
														ref={(node) => {
															atItemRefs.current[index] = node;
														}}
														type="button"
														onMouseDown={(e) => {
															e.preventDefault();
															applyAtCompletion(entry);
														}}
														onMouseEnter={() => setAtActiveIndex(index)}
														style={{
															width: "100%",
															display: "flex",
															alignItems: "center",
															gap: 8,
															padding: "6px 8px",
															border: "none",
															borderRadius: 6,
															background: active
																? "var(--bg-selected)"
																: "none",
															color: "var(--text)",
															cursor: "pointer",
															textAlign: "left",
															fontSize: 12.5,
															fontFamily: "var(--font-mono)",
														}}
													>
														<span
															style={{
																flexShrink: 0,
																display: "flex",
																alignItems: "center",
															}}
														>
															{entry.isDir ? (
																<FolderIcon size={14} />
															) : (
																getFileIcon(name, 14)
															)}
														</span>
														<span
															style={{
																minWidth: 0,
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
															}}
														>
															{dirPrefix && (
																<span style={{ color: "var(--text-dim)" }}>
																	{dirPrefix}
																</span>
															)}
															{name}
															{entry.isDir && (
																<span style={{ color: "var(--text-dim)" }}>
																	/
																</span>
															)}
														</span>
													</button>
												);
											})
										)}
									</div>
								</div>
							);
						})()}
					<style
						dangerouslySetInnerHTML={{
							__html: `
            .chat-input-shell {
              min-width: 0;
              display: flex;
              gap: 8px;
              align-items: center;
              background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border: 1px solid ${bashMode ? "var(--tool-bg)" : isStreaming && (onSteer || onFollowUp) ? "rgba(234,179,8,0.4)" : "color-mix(in srgb, var(--border) 70%, transparent)"};
              border-radius: 16px;
              padding: 10px 10px 10px 14px;
              box-shadow: 0 4px 12px -4px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05);
              transition: border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .chat-input-shell:focus-within {
              border-color: var(--accent);
              box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent), 0 8px 24px -8px rgba(0,0,0,0.15);
              transform: translateY(-1px);
            }
            .chat-input-editor {
              flex: 1;
              min-width: 0;
              width: 100%;
              background: none;
              border: none;
              outline: none;
              color: var(--text);
              font-size: 14px;
              line-height: 1.6;
              font-family: inherit;
              min-height: 24px;
              max-height: 200px;
              overflow-y: auto;
              padding: 0;
              caret-color: var(--text);
              word-break: break-word;
            }
            .chat-input-editor p {
              margin: 0;
            }
            .chat-input-editor p.is-empty::before,
            .chat-input-editor .is-editor-empty::before {
              content: attr(data-placeholder);
              color: var(--text-dim);
              float: left;
              height: 0;
              pointer-events: none;
            }
            .pi-mention-chip {
              display: inline-block;
              background: color-mix(in srgb, var(--accent) 24%, transparent);
              border: 1px solid color-mix(in srgb, var(--accent) 62%, transparent);
              border-radius: 6px;
              padding: 0 6px;
              color: var(--accent);
              font-family: var(--font-mono);
              font-size: 12.5px;
              font-weight: 600;
              line-height: 1.55;
              white-space: nowrap;
              vertical-align: baseline;
              cursor: default;
              user-select: none;
              /* highlight: soft glow so chips stand out from plain text */
              box-shadow:
                0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent),
                0 1px 5px -1px color-mix(in srgb, var(--accent) 45%, transparent);
              text-shadow: 0 0 7px color-mix(in srgb, var(--accent) 45%, transparent);
            }
            .pi-mention-chip[data-kind="command"] {
              background: color-mix(in srgb, #8b5cf6 24%, transparent);
              border-color: color-mix(in srgb, #a78bfa 68%, transparent);
              color: #c4b5fd;
              box-shadow:
                0 0 0 1px color-mix(in srgb, #8b5cf6 14%, transparent),
                0 1px 5px -1px color-mix(in srgb, #8b5cf6 50%, transparent);
              text-shadow: 0 0 7px color-mix(in srgb, #a78bfa 50%, transparent);
            }
            .pi-longtext-chip {
              display: inline-block;
              max-width: 100%;
              vertical-align: baseline;
            }
            .pi-longtext-toggle {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              background: color-mix(in srgb, var(--accent) 12%, transparent);
              border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
              border-radius: 7px;
              padding: 1px 8px;
              color: var(--accent);
              font-family: var(--font-mono);
              font-size: 12px;
              line-height: 1.5;
              cursor: pointer;
            }
            .pi-dompicker-label {
              display: inline-flex;
              align-items: center;
              gap: 5px;
            }
            .pi-chip-btn {
              background: none;
              border: 1px solid var(--border);
              border-radius: 5px;
              color: var(--text-muted);
              font-size: 11px;
              cursor: pointer;
              padding: 0 8px;
              line-height: 1.5;
            }
            .pi-chip-selected {
              outline: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
              border-radius: 7px;
            }
            .pi-dompicker-card {
              display: block;
              margin: 4px 0;
              border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
              border-radius: 8px;
              background: color-mix(in srgb, var(--accent) 7%, transparent);
              overflow: hidden;
            }
            .pi-dompicker-head {
              display: flex;
              align-items: center;
              gap: 8px;
              flex-wrap: wrap;
              padding: 5px 8px;
              font-size: 12px;
              font-weight: 600;
              color: var(--accent);
            }
            .pi-dompicker-selector {
              font-family: var(--font-mono);
              font-size: 11px;
              font-weight: 400;
              color: var(--text-muted);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .pi-dompicker-html {
              margin: 0;
              padding: 6px 8px;
              max-height: 200px;
              overflow: auto;
              border-top: 1px solid var(--border);
              background: var(--bg);
              font-family: var(--font-mono);
              font-size: 11px;
              line-height: 1.5;
              white-space: pre-wrap;
              word-break: break-all;
              color: var(--text-muted);
            }
          `,
						}}
					/>
					<div className="chat-input-shell">
						<EditorContent
							editor={editor}
							style={{
								flex: 1,
								minWidth: 0,
								display: "flex",
								alignItems: "center",
							}}
						/>

						{isStreaming ? (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									flexShrink: 0,
									alignSelf: "flex-end",
								}}
							>
								{onSteer && (
									<button
										onClick={() => sendQueued("steer")}
										disabled={!canQueueStreamingMessage}
										title={
											attachedImages.length
												? "Image attachments cannot be queued while the agent is running"
												: "Interrupt the current run and inject this message now"
										}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 5,
											padding: "7px 12px",
											background: canQueueStreamingMessage
												? "rgba(234,179,8,0.12)"
												: "none",
											border: "1px solid rgba(234,179,8,0.35)",
											borderRadius: 8,
											color: canQueueStreamingMessage
												? "rgba(180,130,0,1)"
												: "var(--text-dim)",
											cursor: canQueueStreamingMessage
												? "pointer"
												: "not-allowed",
											fontSize: 13,
											fontWeight: 600,
											letterSpacing: "-0.01em",
											transition: "background 0.12s",
										}}
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 10 10"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.8"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<path d="M5 1 L9 5 L5 9" />
											<line x1="1" y1="5" x2="9" y2="5" />
										</svg>
										{t("chat.steer")}
									</button>
								)}
								{onFollowUp && (
									<button
										onClick={() => sendQueued("followup")}
										disabled={!canQueueStreamingMessage}
										title={
											attachedImages.length
												? "Image attachments cannot be queued while the agent is running"
												: "Queue this message after the agent finishes"
										}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 5,
											padding: "7px 12px",
											background: canQueueStreamingMessage
												? "rgba(129,140,248,0.12)"
												: "none",
											border: "1px solid rgba(129,140,248,0.35)",
											borderRadius: 8,
											color: canQueueStreamingMessage
												? "rgba(99,102,241,1)"
												: "var(--text-dim)",
											cursor: canQueueStreamingMessage
												? "pointer"
												: "not-allowed",
											fontSize: 13,
											fontWeight: 600,
											letterSpacing: "-0.01em",
											transition: "background 0.12s",
										}}
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 10 10"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.8"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<line x1="5" y1="1" x2="5" y2="6" />
											<polyline points="2.5 3.5 5 1 7.5 3.5" />
											<line x1="2" y1="9" x2="8" y2="9" />
										</svg>
										{t("chat.followUp")}
									</button>
								)}
							</div>
						) : (
							<button
								onClick={handleSend}
								disabled={!value.trim() && !attachedImages.length}
								style={{
									flexShrink: 0,
									alignSelf: "flex-end",
									display: "flex",
									alignItems: "center",
									gap: 6,
									padding: "7px 14px",
									background:
										value.trim() || attachedImages.length
											? "var(--accent)"
											: "var(--bg-panel)",
									border: "none",
									borderRadius: 8,
									color:
										value.trim() || attachedImages.length
											? "#fff"
											: "var(--text-dim)",
									cursor:
										value.trim() || attachedImages.length
											? "pointer"
											: "not-allowed",
									fontSize: 13,
									fontWeight: 600,
									letterSpacing: "-0.01em",
									boxShadow:
										value.trim() || attachedImages.length
											? "0 1px 3px rgba(37,99,235,0.25)"
											: "none",
									transition: "background 0.15s, box-shadow 0.15s",
								}}
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 14 14"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<line x1="2" y1="7" x2="11" y2="7" />
									<polyline points="7.5 3 12 7 7.5 11" />
								</svg>
								{t("chat.send")}
							</button>
						)}
					</div>
				</div>

				{/* Bash mode status label */}
				{bashMode && (
					<div
						className="text-xs px-2 py-1"
						style={{
							color: bashExcluded ? "var(--text-muted)" : "var(--accent)",
							marginTop: 4,
						}}
					>
						{t("chat.shell")} ·{" "}
						{bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
					</div>
				)}

				{/* Bottom bar: left | center (context) | right */}
				<div
					style={{
						marginTop: 8,
						display: isMobile ? "grid" : "flex",
						gridTemplateColumns: isMobile ? "minmax(0, 1fr) auto" : undefined,
						alignItems: "center",
						gap: 6,
					}}
				>
					{/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
					<div
						style={{
							flex: isMobile ? "1 1 auto" : "0 0 auto",
							minWidth: 0,
							display: "flex",
							alignItems: "center",
							gap: 2,
						}}
					>
						<button
							onClick={() => fileInputRef.current?.click()}
							disabled={isStreaming}
							title={t("chat.attachImage")}
							style={{
								flexShrink: 0,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 32,
								height: 32,
								padding: 0,
								background: "none",
								border: "none",
								borderRadius: 9,
								color: attachedImages.length
									? "var(--accent)"
									: "var(--text-muted)",
								cursor: isStreaming ? "not-allowed" : "pointer",
								opacity: isStreaming ? 0.5 : 1,
								transition: "background 0.12s, color 0.12s",
							}}
							onMouseEnter={(e) => {
								if (isStreaming) return;
								e.currentTarget.style.background = "var(--bg-hover)";
								e.currentTarget.style.color = attachedImages.length
									? "var(--accent)"
									: "var(--text)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.background = "none";
								e.currentTarget.style.color = attachedImages.length
									? "var(--accent)"
									: "var(--text-muted)";
							}}
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
								<circle cx="8.5" cy="8.5" r="1.5" />
								<polyline points="21 15 16 10 5 21" />
							</svg>
						</button>
						{/* Model selector — visible always, disabled during streaming */}
						{(modelOptions.length > 0 || currentName || modelError) &&
							onModelChange && (
								<div
									ref={dropdownRef}
									style={{
										position: "relative",
										flex: isMobile ? "1 1 auto" : undefined,
										minWidth: 0,
									}}
								>
									<button
										onClick={(e) => {
											const rect = (
												e.currentTarget as HTMLElement
											).getBoundingClientRect();
											setModelDropdownRect({
												top: rect.top,
												left: rect.left,
												width: rect.width,
											});
											setModelDropdownOpen((open) => {
												if (open) setModelFilter("");
												return !open;
											});
										}}
										disabled={isStreaming}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											justifyContent: isMobile ? "flex-start" : undefined,
											padding: isMobile ? "8px 10px" : "8px 12px",
											height: 32,
											width: isMobile ? "100%" : undefined,
											maxWidth: isMobile ? "100%" : 220,
											overflow: "hidden",
											background: modelDropdownOpen
												? "var(--bg-hover)"
												: "none",
											border: "none",
											borderRadius: 9,
											color: "var(--text-muted)",
											cursor: isStreaming ? "not-allowed" : "pointer",
											fontSize: 12,
											opacity: isStreaming ? 0.5 : 1,
											transition: "background 0.12s, color 0.12s",
										}}
										onMouseEnter={(e) => {
											if (isStreaming) return;
											e.currentTarget.style.background = "var(--bg-hover)";
											e.currentTarget.style.color = "var(--text)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = modelDropdownOpen
												? "var(--bg-hover)"
												: "none";
											e.currentTarget.style.color = "var(--text-muted)";
										}}
										title={
											modelOptions.length > 0
												? "Change model"
												: "No available models"
										}
									>
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<rect x="4" y="4" width="16" height="16" rx="2" />
											<rect x="9" y="9" width="6" height="6" />
											<line x1="9" y1="1" x2="9" y2="4" />
											<line x1="15" y1="1" x2="15" y2="4" />
											<line x1="9" y1="20" x2="9" y2="23" />
											<line x1="15" y1="20" x2="15" y2="23" />
											<line x1="20" y1="9" x2="23" y2="9" />
											<line x1="20" y1="14" x2="23" y2="14" />
											<line x1="1" y1="9" x2="4" y2="9" />
											<line x1="1" y1="14" x2="4" y2="14" />
										</svg>
										<span
											style={{
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												minWidth: 0,
											}}
										>
											{currentName ??
												(modelOptions.length > 0
													? "Select model"
													: "No models")}
										</span>
									</button>
									{modelDropdownOpen &&
										modelDropdownRect &&
										(() => {
											const viewportHeight =
												window.visualViewport?.height ?? window.innerHeight;
											const bottom = viewportHeight - modelDropdownRect.top + 6;
											const maxH = Math.max(
												120,
												Math.min(
													modelDropdownRect.top - 8,
													viewportHeight * 0.6,
												),
											);
											// On mobile, pin to a small left margin and cap width to the
											// viewport so long model names never push the panel off-screen.
											const panelPos: React.CSSProperties = isMobile
												? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
												: {
														left: modelDropdownRect.left,
														width: "max-content",
														minWidth: modelDropdownRect.width,
													};
											return (
												<div
													ref={modelDropdownPanelRef}
													className="panel-content-in"
													style={{
														position: "fixed",
														bottom,
														...panelPos,
														zIndex: 500,
														background: "var(--bg)",
														border: "1px solid var(--border)",
														borderRadius: 8,
														boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
														overflow: "hidden",
														maxHeight: maxH,
														display: "flex",
														flexDirection: "column",
													}}
												>
													{showModelFilter && (
														<div
															style={{
																padding: "6px 8px",
																borderBottom: "1px solid var(--border)",
																flexShrink: 0,
															}}
														>
															<input
																value={modelFilter}
																onChange={(e) => setModelFilter(e.target.value)}
																onKeyDown={(e) => {
																	if (e.key === "Escape") {
																		setModelFilter("");
																		setModelDropdownOpen(false);
																	}
																}}
																placeholder={t("chat.filterModels")}
																aria-label={t("chat.filterModels")}
																autoFocus
																autoComplete="off"
																spellCheck={false}
																style={{
																	width: "100%",
																	minWidth: isMobile ? 0 : 220,
																	fontSize: 11,
																	fontFamily: "var(--font-mono)",
																	padding: "5px 8px",
																	border: "1px solid var(--border)",
																	borderRadius: 5,
																	outline: "none",
																	background: "var(--bg)",
																	color: "var(--text)",
																	boxSizing: "border-box",
																}}
															/>
														</div>
													)}
													<div style={{ minHeight: 0, overflowY: "auto" }}>
														{modelsByProvider.length === 0 ? (
															<div
																style={{
																	padding: "8px 12px",
																	color: "var(--text-dim)",
																	fontSize: 12,
																	whiteSpace: "nowrap",
																}}
															>
																{modelFilter.trim()
																	? t("chat.noMatchingModels")
																	: "No available models"}
															</div>
														) : (
															modelsByProvider.map((group, gi) => (
																<div key={group.provider}>
																	{modelsByProvider.length > 1 && (
																		<div
																			style={{
																				padding: "6px 12px 4px",
																				fontSize: 10,
																				fontWeight: 600,
																				color: "var(--text-dim)",
																				textTransform: "uppercase",
																				letterSpacing: "0.07em",
																				borderTop:
																					gi > 0
																						? "1px solid var(--border)"
																						: "none",
																			}}
																		>
																			{group.provider}
																		</div>
																	)}
																	{group.options.map((opt) => {
																		const isActive =
																			opt.modelId === model?.modelId &&
																			opt.provider === model?.provider;
																		return (
																			<button
																				key={`${opt.provider}:${opt.modelId}`}
																				onClick={() => {
																					setModelDropdownOpen(false);
																					setModelFilter("");
																					if (!isActive || isAutoModelSelection)
																						onModelChange(
																							opt.provider,
																							opt.modelId,
																						);
																				}}
																				style={{
																					display: "flex",
																					alignItems: "center",
																					gap: 8,
																					width: "100%",
																					padding: "7px 12px",
																					background: isActive
																						? "var(--bg-selected)"
																						: "none",
																					border: "none",
																					color: isActive
																						? "var(--text)"
																						: "var(--text-muted)",
																					cursor: "pointer",
																					fontSize: 12,
																					textAlign: "left",
																					fontWeight: isActive ? 600 : 400,
																					whiteSpace: "nowrap",
																				}}
																				onMouseEnter={(e) => {
																					if (!isActive)
																						e.currentTarget.style.background =
																							"var(--bg-hover)";
																				}}
																				onMouseLeave={(e) => {
																					if (!isActive)
																						e.currentTarget.style.background =
																							"none";
																				}}
																			>
																				{isActive ? (
																					<svg
																						width="10"
																						height="10"
																						viewBox="0 0 10 10"
																						fill="none"
																						stroke="var(--accent)"
																						strokeWidth="2"
																						strokeLinecap="round"
																						strokeLinejoin="round"
																						style={{ flexShrink: 0 }}
																					>
																						<polyline points="1.5 5 4 7.5 8.5 2.5" />
																					</svg>
																				) : (
																					<span
																						style={{ width: 10, flexShrink: 0 }}
																					/>
																				)}
																				{opt.name}
																			</button>
																		);
																	})}
																</div>
															))
														)}
													</div>
												</div>
											);
										})()}
								</div>
							)}
					</div>

					{/* spacer */}
					{!isMobile && <div style={{ flex: 1 }} />}

					{/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
					<div
						ref={controlsMenuRef}
						style={{
							flex: "0 0 auto",
							display: "flex",
							alignItems: "center",
							justifyContent: "flex-end",
							position: "relative",
							marginLeft: isMobile ? 0 : "auto",
						}}
					>
						{isMobile && (
							<button
								type="button"
								title={controlsMenuOpen ? undefined : t("chat.moreControls")}
								aria-label={t("chat.moreControls")}
								aria-expanded={controlsMenuOpen}
								aria-hidden={controlsMenuOpen || undefined}
								tabIndex={controlsMenuOpen ? -1 : undefined}
								onClick={() => {
									setModelDropdownOpen(false);
									setModelFilter("");
									setControlsMenuOpen(true);
								}}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: "100%",
									height: 32,
									padding: "8px 10px",
									background: "none",
									border: "none",
									borderRadius: 9,
									color: "var(--text-muted)",
									cursor: controlsMenuOpen ? "default" : "pointer",
									fontSize: 12,
									fontWeight: 500,
									visibility: controlsMenuOpen ? "hidden" : "visible",
									pointerEvents: controlsMenuOpen ? "none" : "auto",
									transition: "background 0.12s, color 0.12s",
								}}
								onMouseEnter={(e) => {
									if (controlsMenuOpen) return;
									e.currentTarget.style.background = "var(--bg-hover)";
									e.currentTarget.style.color = "var(--text)";
								}}
								onMouseLeave={(e) => {
									if (controlsMenuOpen) return;
									e.currentTarget.style.background = "none";
									e.currentTarget.style.color = "var(--text-muted)";
								}}
							>
								{t("chat.moreControls")}
							</button>
						)}
						<div
							style={{
								display: isMobile
									? controlsMenuOpen
										? "flex"
										: "none"
									: "flex",
								alignItems: "center",
								gap: isMobile ? 1 : 2,
								...(isMobile
									? {
											position: "absolute",
											right: 0,
											bottom: 0,
											zIndex: 60,
											padding: 1,
											width: "max-content",
											maxWidth: "calc(100vw - 32px)",
											flexWrap: "nowrap",
											justifyContent: "flex-end",
											border:
												"1px solid color-mix(in srgb, var(--border) 72%, transparent)",
											borderRadius: 10,
											background:
												"color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
											boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
											backdropFilter: "blur(10px)",
										}
									: null),
							}}
						>
							{!isStreaming && onThinkingLevelChange && (
								<div ref={thinkingDropdownRef} style={{ position: "relative" }}>
									<button
										onClick={() =>
											!isStreaming && setThinkingDropdownOpen((v) => !v)
										}
										disabled={isStreaming}
										title={t("chat.changeReasoning", {
											level: thinkingDisplayLabel,
										})}
										aria-label={t("chat.changeReasoningLabel")}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: 5,
											padding: isMobile ? "0 6px" : "8px 12px",
											width: isMobile ? "auto" : undefined,
											height: 32,
											background: thinkingDropdownOpen
												? "var(--bg-hover)"
												: "none",
											border: "none",
											borderRadius: 9,
											color: "var(--text-muted)",
											cursor: isStreaming ? "not-allowed" : "pointer",
											fontSize: 12,
											opacity: isStreaming ? 0.5 : 1,
											transition: "background 0.12s, color 0.12s",
										}}
										onMouseEnter={(e) => {
											if (isStreaming) return;
											e.currentTarget.style.background = "var(--bg-hover)";
											e.currentTarget.style.color = "var(--text)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = thinkingDropdownOpen
												? "var(--bg-hover)"
												: "none";
											e.currentTarget.style.color = "var(--text-muted)";
										}}
									>
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
											<line x1="7" y1="18" x2="12" y2="18" />
											<line x1="8" y1="21" x2="11" y2="21" />
										</svg>
										{(!isMobile || controlsMenuOpen) && (
											<span style={{ whiteSpace: "nowrap" }}>
												{thinkingDisplayLabel}
											</span>
										)}
									</button>
									{thinkingDropdownOpen && (
										<div
											className="panel-content-in"
											style={{
												position: "absolute",
												bottom: "calc(100% + 6px)",
												right: 0,
												zIndex: 100,
												background: "var(--bg)",
												border: "1px solid var(--border)",
												borderRadius: 8,
												boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
												overflow: "hidden",
												minWidth: 180,
											}}
										>
											{THINKING_LEVELS.filter((lvl) => {
												if (!availableThinkingLevels) return true;
												if (lvl === "auto") return true;
												return availableThinkingLevels.includes(lvl);
											}).map((lvl) => {
												const isActive = (thinkingLevel ?? "auto") === lvl;
												const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
												const mappedVal =
													lvl !== "auto" && thinkingLevelMap
														? thinkingLevelMap[lvl]
														: undefined;
												const displayLabel =
													mappedVal != null && mappedVal !== lvl
														? mappedVal
														: lvl;
												const showOriginal =
													mappedVal != null && mappedVal !== lvl;
												return (
													<button
														key={lvl}
														onClick={() => {
															setThinkingDropdownOpen(false);
															if (!isActive) onThinkingLevelChange(lvl);
														}}
														style={{
															display: "flex",
															alignItems: "center",
															gap: 8,
															width: "100%",
															padding: "7px 12px",
															background: isActive
																? "var(--bg-selected)"
																: "none",
															border: "none",
															color: isActive
																? "var(--text)"
																: "var(--text-muted)",
															cursor: "pointer",
															fontSize: 12,
															textAlign: "left",
															fontWeight: isActive ? 600 : 400,
															whiteSpace: "nowrap",
														}}
														onMouseEnter={(e) => {
															if (!isActive)
																e.currentTarget.style.background =
																	"var(--bg-hover)";
														}}
														onMouseLeave={(e) => {
															if (!isActive)
																e.currentTarget.style.background = "none";
														}}
													>
														{isActive ? (
															<svg
																width="10"
																height="10"
																viewBox="0 0 10 10"
																fill="none"
																stroke="var(--accent)"
																strokeWidth="2"
																strokeLinecap="round"
																strokeLinejoin="round"
																style={{ flexShrink: 0 }}
															>
																<polyline points="1.5 5 4 7.5 8.5 2.5" />
															</svg>
														) : (
															<span style={{ width: 10, flexShrink: 0 }} />
														)}
														<span style={{ flex: 1 }}>
															{displayLabel}
															{showOriginal && (
																<span
																	style={{
																		fontSize: 10,
																		color: "var(--text-dim)",
																		fontFamily: "var(--font-mono)",
																		marginLeft: 5,
																	}}
																>
																	({lvl})
																</span>
															)}
														</span>
														<span
															style={{
																fontSize: 11,
																color: "var(--text-dim)",
																marginLeft: 8,
															}}
														>
															{desc}
														</span>
													</button>
												);
											})}
										</div>
									)}
								</div>
							)}
							{!isStreaming && onToolPresetChange && (
								<div ref={toolDropdownRef} style={{ position: "relative" }}>
									<button
										onClick={() =>
											!isStreaming && setToolDropdownOpen((v) => !v)
										}
										disabled={isStreaming}
										title={t("chat.changeToolPreset") + `: ${toolPresetLabel}`}
										aria-label={t("chat.changeToolPreset")}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: 5,
											padding: isMobile ? "0 6px" : "8px 12px",
											width: isMobile ? "auto" : undefined,
											height: 32,
											background: toolDropdownOpen ? "var(--bg-hover)" : "none",
											border: "none",
											borderRadius: 9,
											color: "var(--text-muted)",
											cursor: isStreaming ? "not-allowed" : "pointer",
											fontSize: 12,
											opacity: isStreaming ? 0.5 : 1,
											transition: "background 0.12s, color 0.12s",
										}}
										onMouseEnter={(e) => {
											if (isStreaming) return;
											e.currentTarget.style.background = "var(--bg-hover)";
											e.currentTarget.style.color = "var(--text)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = toolDropdownOpen
												? "var(--bg-hover)"
												: "none";
											e.currentTarget.style.color = "var(--text-muted)";
										}}
									>
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
										</svg>
										{(!isMobile || controlsMenuOpen) && (
											<span style={{ whiteSpace: "nowrap" }}>
												{toolPresetLabel}
											</span>
										)}
									</button>
									{toolDropdownOpen && (
										<div
											className="panel-content-in"
											style={{
												position: "absolute",
												bottom: "calc(100% + 6px)",
												right: 0,
												zIndex: 100,
												background: "var(--bg)",
												border: "1px solid var(--border)",
												borderRadius: 8,
												boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
												overflow: "hidden",
												minWidth: 120,
											}}
										>
											{TOOL_PRESETS.map((lvl) => {
												const preset = TOOL_PRESET_MAP[lvl];
												const isActive = (toolPreset ?? "default") === preset;
												const desc =
													lvl === "off"
														? t("chat.noTools")
														: lvl === "default"
															? t("chat.builtInTools", { count: 4 })
															: t("chat.allBuiltInTools");
												return (
													<button
														key={lvl}
														onClick={() => {
															setToolDropdownOpen(false);
															if (!isActive) onToolPresetChange(preset);
														}}
														style={{
															display: "flex",
															alignItems: "center",
															gap: 8,
															width: "100%",
															padding: "7px 12px",
															background: isActive
																? "var(--bg-selected)"
																: "none",
															border: "none",
															color: isActive
																? "var(--text)"
																: "var(--text-muted)",
															cursor: "pointer",
															fontSize: 12,
															textAlign: "left",
															fontWeight: isActive ? 600 : 400,
															whiteSpace: "nowrap",
														}}
														onMouseEnter={(e) => {
															if (!isActive)
																e.currentTarget.style.background =
																	"var(--bg-hover)";
														}}
														onMouseLeave={(e) => {
															if (!isActive)
																e.currentTarget.style.background = "none";
														}}
													>
														{isActive ? (
															<svg
																width="10"
																height="10"
																viewBox="0 0 10 10"
																fill="none"
																stroke="var(--accent)"
																strokeWidth="2"
																strokeLinecap="round"
																strokeLinejoin="round"
																style={{ flexShrink: 0 }}
															>
																<polyline points="1.5 5 4 7.5 8.5 2.5" />
															</svg>
														) : (
															<span style={{ width: 10, flexShrink: 0 }} />
														)}
														<span style={{ flex: 1 }}>{lvl}</span>
														<span
															style={{
																fontSize: 11,
																color: "var(--text-dim)",
																marginLeft: 8,
															}}
														>
															{desc}
														</span>
													</button>
												);
											})}
										</div>
									)}
								</div>
							)}

							{!isStreaming && onCompact && (
								<div>
									<button
										onClick={isCompacting ? onAbortCompaction : onCompact}
										disabled={isStreaming && !isCompacting}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: 5,
											padding: isMobile ? "0 6px" : "8px 12px",
											width: isMobile ? "auto" : undefined,
											height: 32,
											background: isCompacting
												? "rgba(239,68,68,0.08)"
												: "none",
											border: "none",
											borderRadius: 9,
											color: isCompacting
												? "var(--danger)"
												: "var(--text-muted)",
											cursor:
												isStreaming && !isCompacting
													? "not-allowed"
													: "pointer",
											fontSize: 12,
											opacity: isStreaming && !isCompacting ? 0.5 : 1,
											transition: "background 0.12s, color 0.12s",
										}}
										onMouseEnter={(e) => {
											if (isStreaming && !isCompacting) return;
											e.currentTarget.style.background = isCompacting
												? "rgba(239,68,68,0.16)"
												: "var(--bg-hover)";
											e.currentTarget.style.color = isCompacting
												? "var(--danger)"
												: "var(--text)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = isCompacting
												? "rgba(239,68,68,0.08)"
												: "none";
											e.currentTarget.style.color = isCompacting
												? "var(--danger)"
												: "var(--text-muted)";
										}}
										title={
											isCompacting
												? t("chat.stopCompaction")
												: t("chat.compactContext")
										}
										aria-label={
											isCompacting
												? t("chat.stopCompaction")
												: t("chat.compactContext")
										}
									>
										{isCompacting ? (
											<>
												<svg
													width="10"
													height="10"
													viewBox="0 0 10 10"
													fill="none"
												>
													<rect
														x="2"
														y="2"
														width="6"
														height="6"
														rx="1"
														fill="currentColor"
													/>
												</svg>
												{(!isMobile || controlsMenuOpen) && (
													<span style={{ whiteSpace: "nowrap" }}>
														{t("chat.compacting")}
													</span>
												)}
											</>
										) : (
											<>
												<svg
													width="11"
													height="11"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<polyline points="4 14 10 14 10 20" />
													<polyline points="20 10 14 10 14 4" />
													<line x1="10" y1="14" x2="3" y2="21" />
													<line x1="21" y1="3" x2="14" y2="10" />
												</svg>
												{(!isMobile || controlsMenuOpen) && (
													<span style={{ whiteSpace: "nowrap" }}>
														{t("chat.compact")}
													</span>
												)}
											</>
										)}
									</button>
								</div>
							)}

							{isStreaming && (
								<button
									onClick={onAbort}
									title={t("chat.stopAgent")}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "8px 14px",
										height: 32,
										background: "rgba(239,68,68,0.08)",
										border: "1px solid rgba(239,68,68,0.3)",
										borderRadius: 9,
										color: "var(--danger)",
										cursor: "pointer",
										fontSize: 12,
										fontWeight: 600,
										whiteSpace: "nowrap",
										letterSpacing: "-0.01em",
										transition: "background 0.12s",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "rgba(239,68,68,0.16)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "rgba(239,68,68,0.08)";
									}}
								>
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
										<rect
											x="1.5"
											y="1.5"
											width="7"
											height="7"
											rx="1.5"
											fill="currentColor"
										/>
									</svg>
									{t("chat.stop")}
								</button>
							)}

							{onSoundToggle !== undefined && (
								<button
									onClick={onSoundToggle}
									title={
										soundEnabled
											? t("chat.disableSound")
											: t("chat.enableSound")
									}
									aria-label={
										soundEnabled
											? t("chat.disableSound")
											: t("chat.enableSound")
									}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										gap: 5,
										width: isMobile ? 32 : 32,
										height: 32,
										padding: 0,
										background: "none",
										border: "none",
										borderRadius: 9,
										color: soundEnabled
											? "var(--text-muted)"
											: "var(--text-dim)",
										cursor: "pointer",
										opacity: soundEnabled ? 1 : 0.55,
										transition: "background 0.12s, color 0.12s, opacity 0.12s",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "var(--bg-hover)";
										e.currentTarget.style.color = "var(--text)";
										e.currentTarget.style.opacity = "1";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "none";
										e.currentTarget.style.color = soundEnabled
											? "var(--text-muted)"
											: "var(--text-dim)";
										e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
									}}
								>
									{soundEnabled ? (
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
											<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
											<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
										</svg>
									) : (
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
											<line x1="23" y1="9" x2="17" y2="15" />
											<line x1="17" y1="9" x2="23" y2="15" />
										</svg>
									)}
								</button>
							)}
							{isMobile && controlsMenuOpen && (
								<button
									type="button"
									title={t("chat.collapseControls")}
									aria-label={t("chat.collapseControls")}
									aria-expanded={true}
									onClick={() => {
										setToolDropdownOpen(false);
										setThinkingDropdownOpen(false);
										setControlsMenuOpen(false);
									}}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: 36,
										height: 32,
										padding: 0,
										marginLeft: 0,
										background: "var(--bg-hover)",
										border: "none",
										borderLeft:
											"1px solid color-mix(in srgb, var(--border) 72%, transparent)",
										borderRadius: "0 9px 9px 0",
										color: "var(--text)",
										cursor: "pointer",
										transition: "background 0.12s, color 0.12s",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "var(--bg-selected)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "var(--bg-hover)";
									}}
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
									>
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
});
