const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');

let mainWindow = null;
let presentationWindow = null;
let pptProcess = null;
let settingsPath = '';
let libraryPath = '';
let pptActive = false;
let pptAppReady = false;

// ─── App Ready ───────────────────────────────────────────────
app.whenReady().then(() => {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  libraryPath = path.join(app.getPath('userData'), 'media_library.json');
  loadSettings();
  createMainWindow();
  preOpenPowerPoint();
});

app.on('window-all-closed', () => { closePowerPoint(); app.quit(); });

// ─── Settings ────────────────────────────────────────────────
let settings = { logoPath: '', lastFolder: '' };
function loadSettings() { try { if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch(e) {} }
function saveSettings() { try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch(e) {} }

// ─── Media Library Persistence ───────────────────────────────
ipcMain.handle('load-media-library', () => {
  try { if (fs.existsSync(libraryPath)) return JSON.parse(fs.readFileSync(libraryPath, 'utf-8')); } catch(e) {}
  return { videos: [], images: [], audios: [] };
});

ipcMain.handle('save-media-library', (e, data) => {
  try { fs.writeFileSync(libraryPath, JSON.stringify(data, null, 2)); return true; } catch(e) { return false; }
});

// ─── Pre-open PowerPoint ─────────────────────────────────────
function preOpenPowerPoint() {
  const cmd = `try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); Write-Output 'READY' } catch { $ppt = New-Object -ComObject PowerPoint.Application; $ppt.Visible = -1; Write-Output 'STARTED' }`;
  exec(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, (err, stdout) => {
    const out = (stdout || '').trim();
    pptAppReady = (out === 'READY' || out === 'STARTED');
    console.log('PowerPoint pre-open:', out);
  });
}

// ─── Main Window ─────────────────────────────────────────────
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1400, width), height: Math.min(900, height),
    minWidth: 1000, minHeight: 700,
    title: 'WorshipApp', backgroundColor: '#0b1929',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png')
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { closePowerPoint(); if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.close(); mainWindow = null; });

  // Minimize/restore sync
  mainWindow.on('minimize', () => {
    if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.minimize();
  });
  mainWindow.on('restore', () => {
    if (presentationWindow && !presentationWindow.isDestroyed()) {
      presentationWindow.restore();
      presentationWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });
}

// ─── Presentation Window ─────────────────────────────────────
function createPresentationWindow(displayId) {
  const displays = screen.getAllDisplays();
  let target = displays.find(d => d.id === displayId) || displays.find(d => d.id !== screen.getPrimaryDisplay().id) || displays[0];
  if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.close();

  presentationWindow = new BrowserWindow({
    x: target.bounds.x, y: target.bounds.y,
    width: target.bounds.width, height: target.bounds.height,
    fullscreen: true, frame: false, backgroundColor: '#000000',
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  presentationWindow.loadFile(path.join(__dirname, 'src', 'presentation.html'));
  presentationWindow.setAlwaysOnTop(true, 'screen-saver');
  if (displays.length === 1) {
    presentationWindow.setFullScreen(false); presentationWindow.setSize(800, 600);
    presentationWindow.center(); presentationWindow.setAlwaysOnTop(false);
  }
  return presentationWindow;
}

// ─── IPC: Display ────────────────────────────────────────────
ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays(); const primary = screen.getPrimaryDisplay();
  return displays.map(d => ({
    id: d.id, label: `${Math.round(d.bounds.width*d.scaleFactor)}x${Math.round(d.bounds.height*d.scaleFactor)}`,
    primary: d.id === primary.id, bounds: d.bounds, scaleFactor: d.scaleFactor
  }));
});

ipcMain.handle('open-presentation', (e, displayId) => { createPresentationWindow(displayId); return true; });
ipcMain.handle('close-presentation', () => { if (presentationWindow && !presentationWindow.isDestroyed()) { presentationWindow.close(); presentationWindow = null; } return true; });

ipcMain.handle('show-content', (e, content) => {
  if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.webContents.send('display-content', content);
  return true;
});
ipcMain.handle('show-black', () => { if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.webContents.send('display-content', { type: 'black' }); return true; });
ipcMain.handle('show-logo', () => {
  if (presentationWindow && !presentationWindow.isDestroyed())
    presentationWindow.webContents.send('display-content', { type: 'logo', path: settings.logoPath || '' });
  return true;
});

// Video control forwarded to presentation window
ipcMain.handle('video-command', (e, cmd) => {
  if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.webContents.send('video-command', cmd);
  return true;
});

// Show/hide presentation window for PPT overlay
ipcMain.handle('presentation-show', () => { if (presentationWindow && !presentationWindow.isDestroyed()) { presentationWindow.show(); presentationWindow.setAlwaysOnTop(true, 'screen-saver'); } return true; });
ipcMain.handle('presentation-hide', () => { if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.hide(); return true; });

// ─── IPC: Files ──────────────────────────────────────────────
ipcMain.handle('select-files', async (e, options) => {
  const filters = [];
  if (options.type === 'powerpoint') filters.push({ name: 'PowerPoint', extensions: ['pps','ppsx','ppt','pptx'] });
  else if (options.type === 'video') filters.push({ name: 'Video', extensions: ['mp4','wmv','avi','webm','mov','mkv'] });
  else if (options.type === 'image') filters.push({ name: 'Imágenes', extensions: ['jpg','jpeg','png','bmp','gif','webp'] });
  else if (options.type === 'audio') filters.push({ name: 'Audio', extensions: ['mp3','wav','ogg','wma','aac'] });
  filters.push({ name: 'Todos', extensions: ['*'] });
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', options.multiple ? 'multiSelections' : undefined].filter(Boolean),
    filters, defaultPath: settings.lastFolder || app.getPath('documents')
  });
  if (!result.canceled && result.filePaths.length > 0) { settings.lastFolder = path.dirname(result.filePaths[0]); saveSettings(); }
  return result;
});

ipcMain.handle('set-logo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['jpg','jpeg','png','bmp','gif','webp'] }] });
  if (!result.canceled && result.filePaths.length > 0) { settings.logoPath = result.filePaths[0]; saveSettings(); return settings.logoPath; }
  return null;
});
ipcMain.handle('get-logo', () => settings.logoPath || '');

ipcMain.handle('get-file-info', (e, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, ext);
    const mp3Path = path.join(dir, baseName + '.mp3');
    const hasAudio = fs.existsSync(mp3Path);
    return { path: filePath, name: path.basename(filePath), ext, dir, hasAudio, audioPath: hasAudio ? mp3Path : null };
  } catch(e) { return null; }
});
ipcMain.handle('read-file-url', (e, filePath) => `file:///${filePath.replace(/\\/g, '/')}`);

// ─── PowerPoint COM ──────────────────────────────────────────
ipcMain.handle('ppt-open', async (e, filePath) => {
  return new Promise((resolve) => {
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
    if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.hide();
    pptActive = true;
    // Since PPT is pre-opened, just open the presentation directly
    const psScript = `
      try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
      catch { $ppt = New-Object -ComObject PowerPoint.Application; $ppt.Visible = -1 }
      $pres = $ppt.Presentations.Open('${escapedPath}', 0, 0, -1)
      $ss = $pres.SlideShowSettings
      try { $ss.ShowPresenterView = 0 } catch {}
      $slideShow = $ss.Run()
      Start-Sleep -Milliseconds 300
      Write-Output "OK|$($pres.Slides.Count)"
    `;
    pptProcess = spawn('powershell', ['-NoProfile', '-Command', psScript]);
    let output = '';
    pptProcess.stdout.on('data', (d) => { output += d.toString(); });
    pptProcess.stderr.on('data', (d) => { console.error('PPT:', d.toString()); });
    pptProcess.on('close', () => {
      const t = output.trim();
      if (t.startsWith('OK')) resolve({ success: true, totalSlides: parseInt(t.split('|')[1]) || 0 });
      else resolve({ success: false, error: t || 'Error' });
    });
    setTimeout(() => resolve({ success: true, totalSlides: 0 }), 15000);
  });
});

ipcMain.handle('ppt-next', () => runPptCmd('$ppt.SlideShowWindows(1).View.Next()'));
ipcMain.handle('ppt-prev', () => runPptCmd('$ppt.SlideShowWindows(1).View.Previous()'));
ipcMain.handle('ppt-goto', (e, n) => runPptCmd(`$ppt.SlideShowWindows(1).View.GotoSlide(${n})`));
ipcMain.handle('ppt-get-slide', () => runPptCmd('Write-Output "$($ppt.SlideShowWindows(1).View.CurrentShowPosition)"'));

ipcMain.handle('ppt-close', () => {
  pptActive = false;
  if (presentationWindow && !presentationWindow.isDestroyed()) { presentationWindow.show(); presentationWindow.setAlwaysOnTop(true, 'screen-saver'); }
  return new Promise((resolve) => {
    const cmd = `try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); foreach($p in $ppt.Presentations) { try { $p.SlideShowWindow.View.Exit() } catch {} }; foreach($p in $ppt.Presentations) { $p.Close() } } catch {}`;
    exec(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, () => resolve(true));
  });
});

ipcMain.handle('ppt-show-overlay', () => { if (presentationWindow && !presentationWindow.isDestroyed()) { presentationWindow.show(); presentationWindow.setAlwaysOnTop(true, 'screen-saver'); } return true; });
ipcMain.handle('ppt-hide-overlay', () => { if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.hide(); return true; });

// Export slides as images
ipcMain.handle('ppt-export-slides', async (e, filePath) => {
  const tmpDir = path.join(os.tmpdir(), 'worship_slides_' + Date.now());
  return new Promise((resolve) => {
    const ep = filePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
    const et = tmpDir.replace(/\\/g, '\\\\');
    const ps = `
      New-Item -ItemType Directory -Force -Path '${et}' | Out-Null
      try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
      catch { $ppt = New-Object -ComObject PowerPoint.Application; $ppt.Visible = -1 }
      $pres = $ppt.Presentations.Open('${ep}', -1, 0, 0)
      $total = $pres.Slides.Count
      for ($i = 1; $i -le $total; $i++) { $pres.Slides.Item($i).Export('${et}\\\\slide_' + $i + '.png', 'PNG', 480, 270) }
      $pres.Close()
      Write-Output "OK|$total"
    `;
    const proc = spawn('powershell', ['-NoProfile', '-Command', ps]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      const t = out.trim();
      if (t.startsWith('OK')) {
        const total = parseInt(t.split('|')[1]) || 0;
        const slides = [];
        for (let i = 1; i <= total; i++) { const p = path.join(tmpDir, `slide_${i}.png`); if (fs.existsSync(p)) slides.push(`file:///${p.replace(/\\/g, '/')}`); }
        resolve({ success: true, slides, total });
      } else resolve({ success: false, slides: [], total: 0 });
    });
    setTimeout(() => resolve({ success: false, slides: [], total: 0 }), 30000);
  });
});

function runPptCmd(inner) {
  return new Promise((resolve) => {
    const cmd = `try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); ${inner} } catch { Write-Output 'ERROR' }`;
    exec(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, (err, stdout) => resolve(stdout ? stdout.trim() : ''));
  });
}

function closePowerPoint() {
  return new Promise((resolve) => {
    const cmd = `try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $ppt.Quit() } catch {}`;
    exec(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, () => resolve(true));
  });
}

// ─── Bible ───────────────────────────────────────────────────
ipcMain.handle('load-bible', (e, version) => {
  const p = path.join(__dirname, 'data', 'bible', `${version}.json`);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  return null;
});
ipcMain.handle('get-bible-versions', () => {
  const dir = path.join(__dirname, 'data', 'bible');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ id: f.replace('.json',''), name: f.replace('.json','').toUpperCase() }));
});
ipcMain.handle('import-bible', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Biblia JSON', extensions: ['json'] }] });
  if (!result.canceled && result.filePaths.length > 0) {
    const src = result.filePaths[0]; const name = path.basename(src);
    fs.copyFileSync(src, path.join(__dirname, 'data', 'bible', name));
    return { success: true, name: name.replace('.json','') };
  }
  return { success: false };
});
