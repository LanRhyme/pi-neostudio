// Pi Web 桌面版 —— Electron 主进程
// 生产模式: 自动启动 next start (端口 30142) 并加载
// 开发模式: 优先复用已有的 dev server (30141)
const { app, BrowserWindow, nativeTheme } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const DEV_URL = "http://localhost:30141";
const PROD_URL = "http://localhost:30142";
const PROD_PORT = 30142;

let nextProcess = null;
let mainWindow = null;

function isPortAlive(port, timeoutMs = 1500) {
	return new Promise((resolve) => {
		const req = http.get(
			{ host: "127.0.0.1", port, path: "/", timeout: timeoutMs },
			(res) => {
				res.resume();
				resolve(true);
			},
		);
		req.on("error", () => resolve(false));
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
	});
}

async function startNextServer() {
	const nextBin = path.join(__dirname, "..", "node_modules", ".bin", "next");
	nextProcess = spawn(
		nextBin,
		["start", "-p", String(PROD_PORT), "-H", "127.0.0.1"],
		{
			cwd: path.join(__dirname, ".."),
			stdio: "ignore",
			detached: false,
		},
	);
	// 等 server 就绪（最多 60s）
	for (let i = 0; i < 120; i++) {
		if (await isPortAlive(PROD_PORT)) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

function createWindow(url) {
	mainWindow = new BrowserWindow({
		width: 1320,
		height: 860,
		minWidth: 900,
		minHeight: 600,
		title: "Pi Web",
		autoHideMenuBar: true,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#101014" : "#ffffff",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	});
	mainWindow.loadURL(url);
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

app.whenReady().then(async () => {
	// 优先复用 dev server（开发时用户可能已启动 npm run dev）
	const devAlive = await isPortAlive(30141);
	const prodAlive = await isPortAlive(PROD_PORT);

	let url;
	if (prodAlive) {
		url = PROD_URL;
	} else if (devAlive) {
		url = DEV_URL;
	} else {
		const ok = await startNextServer();
		url = ok ? PROD_URL : null;
		if (!url) {
			console.error("Pi Web: 无法启动 next server，请先运行 npm run build");
			app.quit();
			return;
		}
	}
	createWindow(url);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
	});
});

app.on("window-all-closed", () => {
	app.quit();
});

app.on("before-quit", () => {
	if (nextProcess) {
		try {
			nextProcess.kill();
		} catch {
			/* ignore */
		}
		nextProcess = null;
	}
});
