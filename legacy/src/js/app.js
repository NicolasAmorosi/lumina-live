/* ═══════════════════════════════════════════════════════════
   WorshipApp — Controlador v6
   ═══════════════════════════════════════════════════════════ */

const SVGI = {
  ppt: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="9" rx="1.5"/><line x1="5.5" y1="14" x2="10.5" y2="14"/><line x1="8" y1="11" x2="8" y2="14"/></svg>',
  vid: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="9.5" height="10" rx="1.5"/><path d="M10.5 7l4.5-2.5v7L10.5 9"/></svg>',
  img: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="12" rx="1.5"/><circle cx="5" cy="6" r="1.5"/><path d="M1 12l4-4 3 3 2-2 5 5"/></svg>',
  aud: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 13V3l8-2v10"/><circle cx="4" cy="13" r="2"/><circle cx="12" cy="11" r="2"/></svg>',
  bib: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 13.5A1.5 1.5 0 014 12h10"/><path d="M4 1h10v14H4a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 014 1z"/></svg>',
};

const state = {
  playlist: [],
  selectedIndex: -1,
  activeIndex: -1,
  presentationOpen: false,
  blackActive: false,
  logoActive: false,
  lastContentType: null,
  pptActive: false,
  pptSlides: 0,
  pptCurrentSlide: 0,
  pptSlideImages: [],
  currentAudio: null,
  videoActive: false,
  bibleData: null,
  bibleVerses: [],
  bibleBookName: '',
  bibleChapterNum: 0,
  currentVerseIndex: -1,
  library: { videos: [], images: [], audios: [] },
  currentLibTab: 'videos',
  libSelectedIndex: -1,
  mediaPlaying: false,  // track play/pause state
  activeTab: 'preview', // which tab is active
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const els = {};

const TYPE_MAP = {
  '.pps':'powerpoint','.ppsx':'powerpoint','.ppt':'powerpoint','.pptx':'powerpoint',
  '.mp4':'video','.wmv':'video','.avi':'video','.webm':'video','.mov':'video','.mkv':'video',
  '.jpg':'image','.jpeg':'image','.png':'image','.bmp':'image','.gif':'image','.webp':'image',
  '.mp3':'audio','.wav':'audio','.ogg':'audio','.wma':'audio','.aac':'audio'
};
const TYPE_LABELS = { powerpoint:'PPT', video:'VID', image:'IMG', audio:'AUD', bible:'BIB' };
const TYPE_CLASSES = { powerpoint:'item-type-ppt', video:'item-type-vid', image:'item-type-img', audio:'item-type-aud', bible:'item-type-bib' };
const TYPE_ICONS = { powerpoint:'ppt', video:'vid', image:'img', audio:'aud', bible:'bib' };
const LIB_FILETYPES = {
  videos: { type:'video', exts:['.mp4','.wmv','.avi','.webm','.mov','.mkv'] },
  images: { type:'image', exts:['.jpg','.jpeg','.png','.bmp','.gif','.webp'] },
  audios: { type:'audio', exts:['.mp3','.wav','.ogg','.wma','.aac'] }
};

document.addEventListener('DOMContentLoaded', async () => {
  ['display-select','btn-open-display','btn-close-display','btn-set-logo',
   'playlist','playlist-empty','btn-move-up','btn-move-down','btn-remove','btn-clear',
   'preview-container','preview-placeholder','preview-image','preview-video','preview-text',
   'preview-ppt-info','ppt-filename','ppt-status','ppt-audio-info',
   'ppt-controls','btn-ppt-prev','btn-ppt-next','ppt-slide-info',
   'media-controls','btn-media-play','btn-media-restart','media-seek','media-time',
   'icon-play','icon-pause',
   'btn-black','btn-logo','btn-present','btn-stop',
   'live-preview','live-status-text',
   'bible-version','bible-book','bible-chapter',
   'btn-bible-search','bible-result','btn-bible-show','btn-bible-add','btn-bible-next','btn-import-bible',
   'library-list','lib-count','btn-lib-add','btn-lib-remove'
  ].forEach(id => { els[id] = document.getElementById(id); });

  await loadDisplays();
  await loadBibleVersions();
  await loadMediaLibrary();
  setupEvents();
  setupDragDrop();
});

// ═══ DISPLAY ═══════════════════════════════════════════════
async function loadDisplays() {
  const d = await window.api.getDisplays();
  els['display-select'].innerHTML = '';
  d.forEach(x => {
    const o = document.createElement('option');
    o.value = x.id;
    o.textContent = `${x.primary ? 'Principal' : 'Externo'} — ${x.label}`;
    if (!x.primary) o.selected = true;
    els['display-select'].appendChild(o);
  });
}

async function openScreen() {
  await window.api.openPresentation(parseInt(els['display-select'].value));
  state.presentationOpen = true;
  els['btn-open-display'].disabled = true;
  els['btn-close-display'].disabled = false;
  els['live-status-text'].textContent = 'Conectado';
  els['live-status-text'].className = 'status-indicator status-on';
  await window.api.showLogo();
  updateLive('logo');
}

async function closeScreen() {
  if (state.pptActive) await stopPPT();
  await window.api.closePresentation();
  state.presentationOpen = false;
  els['btn-open-display'].disabled = false;
  els['btn-close-display'].disabled = true;
  els['live-status-text'].textContent = 'Desconectado';
  els['live-status-text'].className = 'status-indicator status-off';
  updateLive('off');
}

// ═══ DRAG & DROP ═══════════════════════════════════════════
function setupDragDrop() {
  const allExts = Object.keys(TYPE_MAP);
  document.body.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); document.body.classList.add('drag-over'); });
  document.body.addEventListener('dragleave', e => { e.preventDefault(); document.body.classList.remove('drag-over'); });
  document.body.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation(); document.body.classList.remove('drag-over');
    for (const f of e.dataTransfer.files) {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      if (!allExts.includes(ext)) continue;
      const info = await window.api.getFileInfo(f.path);
      if (info) addFileToPlaylist(info);
    }
    renderPlaylist();
  });
}

// ═══ PLAYLIST ══════════════════════════════════════════════
function addFileToPlaylist(info) {
  state.playlist.push({
    id: Date.now()+Math.random(), name: info.name, path: info.path,
    type: TYPE_MAP[info.ext]||'unknown', ext: info.ext,
    hasAudio: info.hasAudio, audioPath: info.audioPath
  });
}

async function addToPlaylist(type) {
  const r = await window.api.selectFiles({ type, multiple: true });
  if (r.canceled) return;
  for (const fp of r.filePaths) { const info = await window.api.getFileInfo(fp); if (info) addFileToPlaylist(info); }
  renderPlaylist();
}

function renderPlaylist() {
  const ul = els['playlist']; ul.innerHTML = '';
  els['playlist-empty'].style.display = state.playlist.length === 0 ? 'block' : 'none';
  state.playlist.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (i===state.selectedIndex?' selected':'') + (i===state.activeIndex?' active':'');
    const label = TYPE_LABELS[item.type] || 'FILE';
    const cls = TYPE_CLASSES[item.type] || '';
    const svg = SVGI[TYPE_ICONS[item.type]] || '';
    li.innerHTML = `<span class="item-type ${cls}">${svg} ${label}</span><span class="item-name" title="${item.name}">${item.name}</span>${item.hasAudio?'<span class="item-badge">+Audio</span>':''}`;
    li.addEventListener('click', () => selectItem(i));
    li.addEventListener('dblclick', () => presentItem(i));
    ul.appendChild(li);
  });
}

function selectItem(i) { state.selectedIndex = i; renderPlaylist(); showPreview(state.playlist[i]); }

function moveItem(dir) {
  const i = state.selectedIndex, j = i+dir;
  if (i<0||j<0||j>=state.playlist.length) return;
  [state.playlist[i],state.playlist[j]] = [state.playlist[j],state.playlist[i]];
  if (state.activeIndex===i) state.activeIndex=j; else if (state.activeIndex===j) state.activeIndex=i;
  state.selectedIndex=j; renderPlaylist();
}

function removeItem() {
  if (state.selectedIndex<0) return;
  if (state.selectedIndex===state.activeIndex) stopAll();
  state.playlist.splice(state.selectedIndex,1);
  state.selectedIndex = Math.min(state.selectedIndex, state.playlist.length-1);
  renderPlaylist();
  if (state.selectedIndex>=0) showPreview(state.playlist[state.selectedIndex]); else clearPreview();
}

function clearAll() { stopAll(); state.playlist=[]; state.selectedIndex=-1; state.activeIndex=-1; renderPlaylist(); clearPreview(); }

// ═══ MEDIA LIBRARY ═════════════════════════════════════════
async function loadMediaLibrary() {
  state.library = await window.api.loadMediaLibrary();
  if (!state.library.videos) state.library.videos = [];
  if (!state.library.images) state.library.images = [];
  if (!state.library.audios) state.library.audios = [];
  renderLibrary();
}

function renderLibrary() {
  const tab = state.currentLibTab;
  const items = state.library[tab] || [];
  els['lib-count'].textContent = `${items.length} archivos`;
  const list = els['library-list']; list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:12px"><p class="hint">Sin archivos</p></div>';
    return;
  }
  items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'lib-item';
    if (i === state.libSelectedIndex) div.style.background = 'var(--bg-active)';
    let thumbHtml;
    if (tab === 'images') thumbHtml = `<div class="lib-thumb"><img src="file:///${item.path.replace(/\\\\/g,'/').replace(/\\/g,'/')}" alt="" /></div>`;
    else if (tab === 'videos') thumbHtml = `<div class="lib-thumb">${SVGI.vid}</div>`;
    else thumbHtml = `<div class="lib-thumb">${SVGI.aud}</div>`;
    div.innerHTML = `${thumbHtml}<span class="item-name" title="${item.name}">${item.name}</span>`;
    div.draggable = true;
    div.addEventListener('click', () => { state.libSelectedIndex = i; renderLibrary(); });
    div.addEventListener('dblclick', () => { addFileToPlaylist({ name:item.name, path:item.path, ext:item.ext, hasAudio:false, audioPath:null }); renderPlaylist(); });
    div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; });
    list.appendChild(div);
  });
}

async function addToLibrary() {
  const tab = state.currentLibTab;
  const r = await window.api.selectFiles({ type: LIB_FILETYPES[tab].type, multiple: true });
  if (r.canceled) return;
  for (const fp of r.filePaths) {
    const ext = '.' + fp.split('.').pop().toLowerCase();
    if (state.library[tab].some(x => x.path === fp)) continue;
    state.library[tab].push({ name: fp.split('\\').pop().split('/').pop(), path: fp, ext });
  }
  await window.api.saveMediaLibrary(state.library);
  renderLibrary();
}

async function removeFromLibrary() {
  const tab = state.currentLibTab;
  if (state.libSelectedIndex < 0 || state.libSelectedIndex >= state.library[tab].length) return;
  state.library[tab].splice(state.libSelectedIndex, 1);
  state.libSelectedIndex = -1;
  await window.api.saveMediaLibrary(state.library);
  renderLibrary();
}

// ═══ PREVIEW ═══════════════════════════════════════════════
async function showPreview(item) {
  clearPreview();
  if (!item) return;
  els['preview-placeholder'].style.display = 'none';
  switch (item.type) {
    case 'powerpoint':
      els['preview-ppt-info'].style.display = 'block';
      els['ppt-filename'].textContent = item.name;
      els['ppt-status'].textContent = 'Cargando diapositivas...';
      els['ppt-audio-info'].style.display = item.hasAudio ? 'block' : 'none';
      exportSlidesForPreview(item.path);
      break;
    case 'image':
      els['preview-image'].src = await window.api.readFileUrl(item.path);
      els['preview-image'].style.display = 'block';
      break;
    case 'video':
      els['preview-video'].src = await window.api.readFileUrl(item.path);
      els['preview-video'].style.display = 'block';
      els['preview-video'].volume = 0.3;
      els['preview-video'].preload = 'auto';
      // Show first frame
      els['preview-video'].addEventListener('loadeddata', function onLoad() {
        els['preview-video'].currentTime = 0;
        els['preview-video'].removeEventListener('loadeddata', onLoad);
      }, { once: true });
      els['media-controls'].style.display = 'flex';
      setPlayIcon(false);
      break;
    case 'audio':
      els['preview-text'].innerHTML = `<div style="margin-bottom:12px">${SVGI.aud}</div><div style="font-size:15px;color:var(--text-secondary)">${item.name}</div>`;
      els['preview-text'].style.display = 'flex';
      const url = await window.api.readFileUrl(item.path);
      state.currentAudio = new Audio(url);
      state.currentAudio.volume = 0.5;
      setupAudioUpdates();
      els['media-controls'].style.display = 'flex';
      setPlayIcon(false);
      break;
    case 'bible':
      els['preview-text'].innerHTML = `<div style="font-size:18px;line-height:1.8">${item.text}</div><div style="color:#fff;margin-top:16px;font-weight:600">${item.reference}</div>`;
      els['preview-text'].style.display = 'flex';
      break;
  }
}

async function exportSlidesForPreview(pptPath) {
  const result = await window.api.pptExportSlides(pptPath);
  if (result.success && result.slides.length > 0) {
    state.pptSlideImages = result.slides;
    state.pptSlides = result.total;
    els['ppt-status'].textContent = `${result.total} diapositivas`;
    showPptSlideGrid();
  } else {
    els['ppt-status'].textContent = 'No se pudieron cargar';
  }
}

function showPptSlideGrid() {
  const c = els['preview-container'];
  c.querySelectorAll('.ppt-slide-grid').forEach(e => e.remove());
  els['preview-ppt-info'].style.display = 'none';
  els['preview-placeholder'].style.display = 'none';
  const grid = document.createElement('div');
  grid.className = 'ppt-slide-grid';
  state.pptSlideImages.forEach((src, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'ppt-slide-thumb' + (i === (state.pptCurrentSlide-1) ? ' active' : '');
    thumb.innerHTML = `<img src="${src}" alt="Diapositiva ${i+1}" /><span class="slide-num">${i+1}</span>`;
    thumb.addEventListener('click', () => { if (state.pptActive) { window.api.pptGoto(i+1); state.pptCurrentSlide = i+1; updatePptInfo(); updateSlideGridActive(); } });
    grid.appendChild(thumb);
  });
  c.appendChild(grid);
}

function updateSlideGridActive() {
  els['preview-container'].querySelectorAll('.ppt-slide-thumb').forEach((t, i) => t.classList.toggle('active', i === state.pptCurrentSlide - 1));
}

function clearPreview() {
  els['preview-placeholder'].style.display = 'block';
  els['preview-image'].style.display = 'none';
  els['preview-text'].style.display = 'none';
  els['preview-ppt-info'].style.display = 'none';
  els['preview-container'].querySelectorAll('.ppt-slide-grid').forEach(e => e.remove());

  // If a video is being projected, DON'T destroy the preview video — keep it for time tracking
  if (state.videoActive) {
    // Keep video element running (hidden) and media controls visible
    els['preview-video'].style.display = 'none';
    // Don't hide media controls — they control the projected video
  } else {
    els['preview-video'].pause();
    els['preview-video'].removeAttribute('src');
    els['preview-video'].load();
    els['preview-video'].style.display = 'none';
    els['media-controls'].style.display = 'none';
  }

  // If audio is being projected (PPT linked audio or standalone), don't stop it
  if (!state.pptActive && state.lastContentType !== 'audio') {
    stopAudio();
  }

  els['ppt-controls'].style.display = 'none';
}

// ═══ PLAY/PAUSE ICON ═══════════════════════════════════════
function setPlayIcon(playing) {
  state.mediaPlaying = playing;
  els['icon-play'].style.display = playing ? 'none' : 'block';
  els['icon-pause'].style.display = playing ? 'block' : 'none';
}

// ═══ LIVE PREVIEW ══════════════════════════════════════════
function updateLive(type, url, text) {
  const c = els['live-preview']; c.innerHTML = ''; c.style.background = '#000';
  switch (type) {
    case 'off': c.innerHTML = '<div class="live-placeholder"><p>Sin señal</p></div>'; break;
    case 'black': break;
    case 'logo': c.innerHTML = '<div class="live-placeholder"><p>Logo</p></div>'; break;
    case 'image':
      if (url) { const img = document.createElement('img'); img.src = url; img.style.cssText='width:100%;height:100%;object-fit:contain'; c.appendChild(img); }
      break;
    case 'video': c.innerHTML = '<div class="live-placeholder"><p>Video</p></div>'; break;
    case 'ppt': c.style.background = '#1a1a3e'; c.innerHTML = '<div class="live-placeholder"><p>PowerPoint</p></div>'; break;
    case 'bible': c.innerHTML = `<div class="live-placeholder"><p>${text||'Biblia'}</p></div>`; break;
  }
}

// ═══ BLACK / LOGO TOGGLE ═══════════════════════════════════
async function toggleBlack() {
  if (!state.presentationOpen) await openScreen();
  if (state.blackActive) {
    state.blackActive = false; els['btn-black'].classList.remove('toggled');
    // Resume audio if PPT has linked audio
    if (state.pptActive && state.currentAudio) state.currentAudio.play().catch(()=>{});
    await restorePrevious();
  } else {
    state.logoActive = false; els['btn-logo'].classList.remove('toggled');
    state.blackActive = true; els['btn-black'].classList.add('toggled');
    // Pause PPT linked audio
    if (state.pptActive && state.currentAudio) state.currentAudio.pause();
    if (state.pptActive) { await window.api.pptShowOverlay(); await window.api.showBlack(); }
    else await window.api.showBlack();
    updateLive('black');
  }
}

async function toggleLogo() {
  if (!state.presentationOpen) await openScreen();
  if (state.logoActive) {
    state.logoActive = false; els['btn-logo'].classList.remove('toggled');
    if (state.pptActive && state.currentAudio) state.currentAudio.play().catch(()=>{});
    await restorePrevious();
  } else {
    state.blackActive = false; els['btn-black'].classList.remove('toggled');
    state.logoActive = true; els['btn-logo'].classList.add('toggled');
    if (state.pptActive && state.currentAudio) state.currentAudio.pause();
    if (state.pptActive) { await window.api.pptShowOverlay(); await window.api.showLogo(); }
    else await window.api.showLogo();
    updateLive('logo');
  }
}

async function restorePrevious() {
  if (state.pptActive) { await window.api.pptHideOverlay(); updateLive('ppt'); }
  else if (state.videoActive) { await window.api.showContent({ type:'video-resume' }); updateLive('video'); }
  else if (state.lastContentType === 'image') {
    const item = state.playlist[state.activeIndex];
    if (item) { const url = await window.api.readFileUrl(item.path); await window.api.showContent({ type:'image', url }); updateLive('image', url); }
  } else if (state.lastContentType === 'bible') {
    const item = state.playlist[state.activeIndex];
    if (item) { await window.api.showContent({ type:'bible', text:item.text, reference:item.reference }); updateLive('bible', null, item.reference); }
  } else { await window.api.showLogo(); updateLive('logo'); }
}

// ═══ STOP CURRENT CONTENT ══════════════════════════════════
async function stopCurrentContent() {
  // Stop projected video sound
  if (state.videoActive) {
    await window.api.videoCommand({ action: 'pause' });
    await window.api.showContent({ type: 'black' }); // Clear the projection
    state.videoActive = false;
  }
  // Stop PPT
  if (state.pptActive) await stopPPT();
  // Stop audio
  stopAudio();
  // Stop preview video
  els['preview-video'].pause();
}

// ═══ PRESENT ═══════════════════════════════════════════════
function getActivePresentable() {
  // If on Bible tab and a verse is selected, present that verse
  if (state.activeTab === 'bible' && state.currentVerseIndex >= 0 && state.bibleVerses.length > 0) {
    const v = state.bibleVerses[state.currentVerseIndex];
    const ref = `${state.bibleBookName} ${state.bibleChapterNum}:${v.num}`;
    return { type: 'bible', text: v.text, reference: ref, name: ref };
  }
  // Otherwise present selected playlist item
  if (state.selectedIndex >= 0) return state.playlist[state.selectedIndex];
  return null;
}

async function presentItem(index) {
  if (!state.presentationOpen) await openScreen();
  await stopCurrentContent(); // Stop everything currently playing
  const item = state.playlist[index];
  if (!item) return;
  state.activeIndex = index;
  state.blackActive = false; state.logoActive = false;
  els['btn-black'].classList.remove('toggled'); els['btn-logo'].classList.remove('toggled');
  renderPlaylist();
  switch (item.type) {
    case 'powerpoint': await doPresentPPT(item); break;
    case 'image': await doPresentImage(item); break;
    case 'video': await doPresentVideo(item); break;
    case 'audio': await doPresentAudio(item); break;
    case 'bible': await doPresentBible(item); break;
  }
  els['btn-present'].style.display = 'none';
  els['btn-stop'].style.display = 'inline-flex';
}

async function presentBibleDirect() {
  if (!state.presentationOpen) await openScreen();
  await stopCurrentContent();
  const v = state.bibleVerses[state.currentVerseIndex];
  const ref = `${state.bibleBookName} ${state.bibleChapterNum}:${v.num}`;
  await window.api.showContent({ type:'bible', text:v.text, reference:ref });
  state.lastContentType = 'bible'; state.videoActive = false;
  updateLive('bible', null, ref);
  // Highlight in list
  els['bible-result'].querySelectorAll('.bible-verse-item').forEach(e => { e.classList.remove('active','selected'); });
  const active = els['bible-result'].querySelector(`.bible-verse-item[data-index="${state.currentVerseIndex}"]`);
  if (active) { active.classList.add('active'); active.scrollIntoView({ block:'nearest', behavior:'smooth' }); }
  els['btn-present'].style.display = 'none';
  els['btn-stop'].style.display = 'inline-flex';
}

async function doPresentImage(item) {
  const url = await window.api.readFileUrl(item.path);
  await window.api.showContent({ type:'image', url });
  state.lastContentType = 'image'; state.videoActive = false;
  updateLive('image', url);
}

async function doPresentVideo(item) {
  const url = await window.api.readFileUrl(item.path);
  // Ensure preview video shows the same source for time tracking
  if (els['preview-video'].src !== url) {
    els['preview-video'].src = url;
    els['preview-video'].preload = 'auto';
  }
  els['preview-video'].style.display = 'block';
  els['preview-video'].volume = 0;
  els['preview-video'].play().catch(()=>{});
  await window.api.showContent({ type:'video', url });
  state.lastContentType = 'video'; state.videoActive = true;
  els['media-controls'].style.display = 'flex';
  setPlayIcon(true);
  updateLive('video');
}

async function doPresentAudio(item) {
  stopAudio();
  const url = await window.api.readFileUrl(item.path);
  state.currentAudio = new Audio(url);
  state.currentAudio.volume = 0.5;
  state.currentAudio.play().catch(() => {});
  setupAudioUpdates();
  state.lastContentType = 'audio'; state.videoActive = false;
  els['media-controls'].style.display = 'flex';
  setPlayIcon(true);
}

async function doPresentBible(item) {
  await window.api.showContent({ type:'bible', text:item.text, reference:item.reference });
  state.lastContentType = 'bible'; state.videoActive = false;
  updateLive('bible', null, item.reference);
}

async function doPresentPPT(item) {
  const result = await window.api.pptOpen(item.path);
  if (result.success) {
    state.pptActive = true; state.pptSlides = result.totalSlides;
    state.pptCurrentSlide = 1; state.lastContentType = 'ppt'; state.videoActive = false;
    els['ppt-controls'].style.display = 'flex'; els['media-controls'].style.display = 'none';
    updatePptInfo(); updateLive('ppt');
    if (item.hasAudio && item.audioPath) playLinkedAudio(item.audioPath);
    startPptPoll();
    if (state.pptSlideImages.length > 0) updateSlideGridActive();
  }
}

async function stopAll() {
  await stopCurrentContent();
  state.activeIndex = -1; state.lastContentType = null;
  els['ppt-controls'].style.display = 'none';
  els['media-controls'].style.display = 'none';
  els['btn-present'].style.display = 'inline-flex';
  els['btn-stop'].style.display = 'none';
  if (state.presentationOpen) { await window.api.showLogo(); updateLive('logo'); }
  renderPlaylist();
}

// ═══ PPT CONTROL ═══════════════════════════════════════════
let pptPoll = null;
async function stopPPT() { state.pptActive = false; clearInterval(pptPoll); await window.api.pptClose(); els['ppt-controls'].style.display = 'none'; }
async function pptNext() { if (state.pptActive) await window.api.pptNext(); }
async function pptPrev() { if (state.pptActive) await window.api.pptPrev(); }
function updatePptInfo() { els['ppt-slide-info'].textContent = `Diapositiva ${state.pptCurrentSlide} / ${state.pptSlides || '?'}`; }
function startPptPoll() {
  clearInterval(pptPoll);
  pptPoll = setInterval(async () => {
    if (!state.pptActive) { clearInterval(pptPoll); return; }
    const s = await window.api.pptGetSlide();
    const n = parseInt(s);
    if (n > 0 && n !== state.pptCurrentSlide) { state.pptCurrentSlide = n; updatePptInfo(); updateSlideGridActive(); }
  }, 800);
}

// ═══ AUDIO ═════════════════════════════════════════════════
function playLinkedAudio(p) { stopAudio(); state.currentAudio = new Audio(`file:///${p.replace(/\\/g,'/')}`); state.currentAudio.volume = 0.5; state.currentAudio.play().catch(()=>{}); }
function stopAudio() { if (state.currentAudio) { state.currentAudio.pause(); state.currentAudio.src = ''; state.currentAudio = null; } }
function setupAudioUpdates() {
  if (!state.currentAudio) return;
  state.currentAudio.addEventListener('timeupdate', () => {
    if (!state.currentAudio?.duration) return;
    els['media-seek'].value = (state.currentAudio.currentTime / state.currentAudio.duration) * 100;
    els['media-time'].textContent = `${fmt(state.currentAudio.currentTime)} / ${fmt(state.currentAudio.duration)}`;
  });
  state.currentAudio.addEventListener('ended', () => setPlayIcon(false));
}

// ═══ MEDIA CONTROLS ════════════════════════════════════════
function setupMediaControls() {
  // PLAY / PAUSE
  els['btn-media-play'].addEventListener('click', () => {
    if (state.videoActive) {
      // Control projected video
      if (state.mediaPlaying) {
        window.api.videoCommand({ action: 'pause' });
        els['preview-video'].pause();
        setPlayIcon(false);
      } else {
        window.api.videoCommand({ action: 'play' });
        els['preview-video'].play();
        setPlayIcon(true);
      }
    } else if (state.currentAudio) {
      if (state.currentAudio.paused) { state.currentAudio.play(); setPlayIcon(true); }
      else { state.currentAudio.pause(); setPlayIcon(false); }
    } else {
      // Preview-only video (not projected)
      const v = els['preview-video'];
      if (v.style.display !== 'none' && v.src) {
        if (v.paused) { v.play(); setPlayIcon(true); } else { v.pause(); setPlayIcon(false); }
      }
    }
  });

  // RESTART (go to beginning, PAUSED)
  els['btn-media-restart'].addEventListener('click', () => {
    if (state.videoActive) {
      window.api.videoCommand({ action: 'pause' });
      window.api.videoCommand({ action: 'seek', time: 0 });
      els['preview-video'].pause();
      els['preview-video'].currentTime = 0;
      setPlayIcon(false);
    } else if (state.currentAudio) {
      state.currentAudio.pause();
      state.currentAudio.currentTime = 0;
      setPlayIcon(false);
    } else {
      const v = els['preview-video'];
      if (v.style.display !== 'none') { v.pause(); v.currentTime = 0; setPlayIcon(false); }
    }
  });

  // SEEK
  els['preview-video'].addEventListener('timeupdate', () => {
    const v = els['preview-video'];
    if (v.duration) { els['media-seek'].value = (v.currentTime / v.duration) * 100; els['media-time'].textContent = `${fmt(v.currentTime)} / ${fmt(v.duration)}`; }
  });
  els['preview-video'].addEventListener('ended', () => setPlayIcon(false));

  els['media-seek'].addEventListener('input', () => {
    const pct = els['media-seek'].value / 100;
    if (state.videoActive) {
      const v = els['preview-video'];
      if (v.duration) { v.currentTime = pct * v.duration; window.api.videoCommand({ action:'seek', time:v.currentTime }); }
    } else if (state.currentAudio?.duration) {
      state.currentAudio.currentTime = pct * state.currentAudio.duration;
    } else {
      const v = els['preview-video'];
      if (v.duration) v.currentTime = pct * v.duration;
    }
  });
}

function fmt(s) { return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`; }

// ═══ BIBLE ═════════════════════════════════════════════════
async function loadBibleVersions() {
  const v = await window.api.getBibleVersions(); const sel = els['bible-version']; sel.innerHTML = '';
  if (!v.length) { sel.innerHTML = '<option value="">Sin versiones</option>'; return; }
  v.forEach(x => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; sel.appendChild(o); });
  await loadBible(v[0].id);
}
async function loadBible(vid) {
  state.bibleData = await window.api.loadBible(vid); if (!state.bibleData) return;
  const sel = els['bible-book']; sel.innerHTML = '<option value="">Libro...</option>';
  getBibleBooks().forEach((name, i) => { const o = document.createElement('option'); o.value = i; o.textContent = name; sel.appendChild(o); });
}
function getBibleBooks() { if (!state.bibleData) return []; if (Array.isArray(state.bibleData)) return state.bibleData.map(b=>b.name||b.nombre||'Libro'); if (state.bibleData.books) return state.bibleData.books.map(b=>b.name||b.nombre); return Object.keys(state.bibleData); }
function getBook(i) { if (Array.isArray(state.bibleData)) return state.bibleData[i]; if (state.bibleData.books) return state.bibleData.books[i]; return state.bibleData[Object.keys(state.bibleData)[i]]; }
function getChapterCount(bi) { const b=getBook(bi); if(!b)return 0; if(b.chapters)return Array.isArray(b.chapters)?b.chapters.length:Object.keys(b.chapters).length; return Array.isArray(b)?b.length:Object.keys(b).length; }
function getVerses(bi, ci) {
  const b=getBook(bi); if(!b)return []; let ch;
  if(b.chapters) ch=Array.isArray(b.chapters)?b.chapters[ci]:b.chapters[String(ci+1)];
  else ch=Array.isArray(b)?b[ci]:(b[String(ci+1)]||b[Object.keys(b)[ci]]);
  if(!ch)return [];
  if(Array.isArray(ch)) return ch.map((t,i)=>({num:i+1,text:typeof t==='string'?t:(t.text||t.verse||'')}));
  return Object.entries(ch).map(([n,t])=>({num:parseInt(n),text:t}));
}

function searchBible() {
  const bi=parseInt(els['bible-book'].value), ci=parseInt(els['bible-chapter'].value);
  if(isNaN(bi)||isNaN(ci))return;
  state.bibleBookName=getBibleBooks()[bi]; state.bibleChapterNum=ci+1;
  state.bibleVerses=getVerses(bi,ci); state.currentVerseIndex=-1;
  if(!state.bibleVerses.length){els['bible-result'].innerHTML='<div class="empty-state"><p>No se encontraron versículos</p></div>';return;}
  let html='<div class="bible-verse-list">';
  state.bibleVerses.forEach((v,i)=>{html+=`<div class="bible-verse-item" data-index="${i}"><span class="verse-num">${v.num}</span><span class="verse-txt">${v.text}</span></div>`;});
  html+='</div>';
  els['bible-result'].innerHTML=html;
  els['bible-result'].querySelectorAll('.bible-verse-item').forEach(el=>{
    el.addEventListener('dblclick',()=>projectVerse(parseInt(el.dataset.index)));
    el.addEventListener('click',()=>{els['bible-result'].querySelectorAll('.bible-verse-item').forEach(e=>e.classList.remove('selected'));el.classList.add('selected');state.currentVerseIndex=parseInt(el.dataset.index);});
  });
  els['btn-bible-show'].disabled=false; els['btn-bible-add'].disabled=false; els['btn-bible-next'].disabled=false;
}

async function projectVerse(index) {
  if(index<0||index>=state.bibleVerses.length)return;
  if(!state.presentationOpen) await openScreen();
  await stopCurrentContent();
  state.currentVerseIndex=index;
  const v=state.bibleVerses[index]; const ref=`${state.bibleBookName} ${state.bibleChapterNum}:${v.num}`;
  await window.api.showContent({type:'bible',text:v.text,reference:ref});
  state.lastContentType='bible';
  updateLive('bible',null,ref);
  els['bible-result'].querySelectorAll('.bible-verse-item').forEach(e=>{e.classList.remove('active','selected');});
  const active=els['bible-result'].querySelector(`.bible-verse-item[data-index="${index}"]`);
  if(active){active.classList.add('active');active.scrollIntoView({block:'nearest',behavior:'smooth'});}
  els['btn-present'].style.display='none'; els['btn-stop'].style.display='inline-flex';
}
function nextVerse(){if(state.currentVerseIndex<state.bibleVerses.length-1)projectVerse(state.currentVerseIndex+1);}
function prevVerse(){if(state.currentVerseIndex>0)projectVerse(state.currentVerseIndex-1);}
function addBibleToPlaylist(){
  if(state.currentVerseIndex<0)return;
  const v=state.bibleVerses[state.currentVerseIndex]; const ref=`${state.bibleBookName} ${state.bibleChapterNum}:${v.num}`;
  state.playlist.push({id:Date.now()+Math.random(),name:ref,type:'bible',text:v.text,reference:ref});
  renderPlaylist();
}

// ═══ KEYBOARD ══════════════════════════════════════════════
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Only handle Delete/Backspace when not typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      // Check if library section is focused (libSelectedIndex >= 0)
      if (state.libSelectedIndex >= 0) {
        removeFromLibrary();
      } else if (state.selectedIndex >= 0) {
        removeItem();
      }
    }
  });
}

// ═══ EVENTS ════════════════════════════════════════════════
function setupEvents() {
  els['btn-open-display'].addEventListener('click', openScreen);
  els['btn-close-display'].addEventListener('click', closeScreen);
  els['btn-set-logo'].addEventListener('click', async () => { await window.api.setLogo(); });
  $$('.btn-add').forEach(b => b.addEventListener('click', () => addToPlaylist(b.dataset.type)));
  els['btn-move-up'].addEventListener('click', () => moveItem(-1));
  els['btn-move-down'].addEventListener('click', () => moveItem(1));
  els['btn-remove'].addEventListener('click', removeItem);
  els['btn-clear'].addEventListener('click', clearAll);

  // EN VIVO: check if Bible tab is active and has selected verse
  els['btn-present'].addEventListener('click', () => {
    if (state.activeTab === 'bible' && state.currentVerseIndex >= 0 && state.bibleVerses.length > 0) {
      presentBibleDirect();
    } else if (state.selectedIndex >= 0) {
      presentItem(state.selectedIndex);
    }
  });

  els['btn-stop'].addEventListener('click', stopAll);
  els['btn-black'].addEventListener('click', toggleBlack);
  els['btn-logo'].addEventListener('click', toggleLogo);
  els['btn-ppt-next'].addEventListener('click', pptNext);
  els['btn-ppt-prev'].addEventListener('click', pptPrev);
  setupMediaControls();

  // Tabs
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tabName = btn.dataset.tab;
    state.activeTab = tabName;
    document.getElementById('tab-' + tabName).classList.add('active');
  }));

  // Bible
  els['bible-version'].addEventListener('change', () => loadBible(els['bible-version'].value));
  els['bible-book'].addEventListener('change', () => {
    const bi=parseInt(els['bible-book'].value); if(isNaN(bi))return;
    const sel=els['bible-chapter']; sel.innerHTML='<option value="">Cap...</option>';
    for(let i=0;i<getChapterCount(bi);i++){const o=document.createElement('option');o.value=i;o.textContent=i+1;sel.appendChild(o);}
    sel.disabled=false;
  });
  els['btn-bible-search'].addEventListener('click', searchBible);
  els['btn-bible-show'].addEventListener('click', prevVerse);
  els['btn-bible-next'].addEventListener('click', nextVerse);
  els['btn-bible-add'].addEventListener('click', addBibleToPlaylist);
  els['btn-import-bible'].addEventListener('click', async () => { const r = await window.api.importBible(); if (r.success) await loadBibleVersions(); });

  // Library tabs
  $$('.lib-tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.lib-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); state.currentLibTab = btn.dataset.lib; state.libSelectedIndex = -1; renderLibrary();
  }));
  els['btn-lib-add'].addEventListener('click', addToLibrary);
  els['btn-lib-remove'].addEventListener('click', removeFromLibrary);

  // Drop from library to playlist
  els['playlist'].parentElement.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  els['playlist'].parentElement.addEventListener('drop', async e => {
    e.preventDefault();
    try { const data=JSON.parse(e.dataTransfer.getData('text/plain')); if(data.path){const info=await window.api.getFileInfo(data.path);if(info){addFileToPlaylist(info);renderPlaylist();}}} catch(err){}
  });

  // Keyboard (Delete/Backspace)
  setupKeyboard();

  // Click on playlist area deselects library
  els['playlist'].addEventListener('click', () => { if (state.libSelectedIndex >= 0) { state.libSelectedIndex = -1; renderLibrary(); } });
}
