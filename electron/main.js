const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, Notification } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Check if the Express backend server is already responding
 */
function checkServerReady(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/status`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Start backend Express server if not already running
 */
async function startServerIfNeeded() {
  const isRunning = await checkServerReady(SERVER_URL);
  if (isRunning) {
    console.log(`[Electron] Backend server already running on ${SERVER_URL}`);
    return;
  }

  console.log(`[Electron] Launching backend server on port ${PORT}...`);
  const projectRoot = path.join(__dirname, '..');
  const serverScript = path.join(projectRoot, 'server.js');

  serverProcess = spawn('node', [serverScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      OPEN_BROWSER: 'false' // Prevent opening duplicate browser tab
    },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (d) => {
    const msg = d.toString();
    process.stdout.write(`[Server] ${msg}`);
  });

  serverProcess.stderr.on('data', (d) => {
    process.stderr.write(`[Server Error] ${d.toString()}`);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
    serverProcess = null;
  });

  // Wait for server to become responsive
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ready = await checkServerReady(SERVER_URL);
    if (ready) break;
  }

  if (!ready) {
    console.warn('[Electron] Server took longer than 15s to respond, proceeding to load window...');
  }
}

/**
 * Create primary application window
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: 'AutoApply AI — Autonomous Career Suite',
    backgroundColor: '#0b1120',
    show: false, // Show once ready-to-show to prevent white flash
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false
    }
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Intercept window close: minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      if (Notification.isSupported()) {
        new Notification({
          title: 'AutoApply AI is Still Running',
          body: 'Your 24/7 Autopilot and job applications continue in the background. Click the tray icon to reopen.'
        }).show();
      }
    }
  });

  // Open external links in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

/**
 * Setup Windows System Tray icon & context menu
 */
function setupTray() {
  // Simple transparent 16x16 icon fallback if no custom icon file
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('AutoApply AI — Running 24/7 Autopilot');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🚀 Open Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '📂 Open Data Folder',
      click: () => {
        shell.openPath(path.join(__dirname, '..', 'data'));
      }
    },
    {
      label: '📄 Open Tailored CVs',
      click: () => {
        shell.openPath(path.join(__dirname, '..', 'data', 'tailored_cvs'));
      }
    },
    {
      label: '🔄 Reload Dashboard',
      click: () => {
        if (mainWindow) mainWindow.reload();
      }
    },
    { type: 'separator' },
    {
      label: '🛑 Quit AutoApply AI',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await startServerIfNeeded();
  createMainWindow();
  setupTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) {
    try {
      serverProcess.kill('SIGINT');
    } catch (_) {}
  }
});

app.on('window-all-closed', () => {
  // On Windows, keep running in tray unless explicit quit
  if (process.platform !== 'win32' || isQuitting) {
    app.quit();
  }
});
