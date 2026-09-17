// Smart Secretary — Electron main process (production desktop shell)
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
let apiProc = null;
let win = null;

const API_PORT = 3847;
const DATA_DIR = isDev
  ? path.join(__dirname, '..', 'data')
  : path.join(app.getPath('userData'), 'data');

function startApi() {
  return new Promise((resolve) => {
    const serverFile = isDev
      ? path.join(__dirname, '..', 'server', 'index.js')
      : path.join(process.resourcesPath, 'app', 'server', 'index.js');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // في وضع التطوير/المصدر: نستخدم node النظام (متوافق مع الوحدات المثبتة عبر npm).
    // في النسخة المثبتة (لا يوجد node): نستخدم Electron نفسه كـ Node.
    const useSystemNode = isDev;
    const bin = useSystemNode ? 'node' : process.execPath;
    const env = { ...process.env, PORT: API_PORT, DATA_DIR, DB_PATH: path.join(DATA_DIR, 'smart-secretary.db'), NODE_ENV: 'production' };
    if (useSystemNode) delete env.ELECTRON_RUN_AS_NODE;
    else env.ELECTRON_RUN_AS_NODE = '1';
    let logOut = 'ignore';
    try { logOut = fs.openSync(path.join(DATA_DIR, 'api.log'), 'a'); } catch {}
    apiProc = spawn(bin, [serverFile], {
      env,
      stdio: ['ignore', logOut, logOut],
      windowsHide: true
    });
    apiProc.on('error', () => resolve(false));
    // انتظار الإقلاع
    const http = require('http');
    let tries = 0;
    const tick = () => {
      http.get(`http://127.0.0.1:${API_PORT}/api/health`, (r) => r.statusCode === 200 ? resolve(true) : retry()).on('error', retry);
    };
    const retry = () => (++tries > 60 ? resolve(false) : setTimeout(tick, 500));
    setTimeout(tick, 800);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    title: 'Smart Secretary — سكرتير ذكي',
    backgroundColor: '#f2f4fa',
    autoHideMenuBar: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  const useBuild = process.env.USE_BUILD === '1';
  const startUrl = process.env.ELECTRON_START_URL
    || ((!isDev || useBuild) ? `http://127.0.0.1:${API_PORT}` : 'http://127.0.0.1:5173');
  win.loadURL(startUrl);

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  const menu = Menu.buildFromTemplate([
    {
      label: 'ملف', submenu: [
        { label: 'تحديث', accelerator: 'F5', click: () => win.reload() },
        { type: 'separator' },
        {
          label: 'طباعة / PDF', accelerator: 'Ctrl+P', click: () => win.webContents.print({ printBackground: true }, (ok) => !ok && dialog.showErrorBox('طباعة', 'تم إلغاء الطباعة'))
        },
        { type: 'separator' },
        { label: 'خروج', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: 'عرض', submenu: [
        { label: 'بحث سريع', accelerator: 'Ctrl+K', click: () => win.webContents.send('open-palette') },
        { label: 'ملء الشاشة', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
        { label: 'تكبير', accelerator: 'Ctrl+Plus', click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5) },
        { label: 'تصغير', accelerator: 'Ctrl+-', click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5) }
      ]
    },
    {
      label: 'مساعدة', submenu: [
        { label: 'حول Smart Secretary', click: () => dialog.showMessageBox(win, { type: 'info', title: 'حول', message: 'Smart Secretary v1.0.0', detail: 'نظام إدارة سكرتارية وأعمال احترافي — سطح المكتب' }) }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.isMinimized() && win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    if (!isDev || process.env.USE_BUILD === '1') {
      const ok = await startApi();
      if (!ok) { dialog.showErrorBox('Smart Secretary', 'تعذر تشغيل خدمة البيانات المحلية — تأكد أنه لا توجد نسخة أخرى تعمل.\n\nسجل الأخطاء:\n' + path.join(DATA_DIR, 'api.log')); app.quit(); return; }
    }
    createWindow();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { apiProc?.kill(); } catch {} });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
