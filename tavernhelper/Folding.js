/* ============================================================
 * SillyTavern 消息折叠 v4.6 (for 酒馆助手脚本)
 *
 * 小折叠: 单条消息内容折叠/展开 (v3 功能保留)
 * 大折叠: 收纳包 - 把多条连续消息打包成一个可展开的卡片
 * 设置面板: 双页 tab (折叠设置 / 收纳管理)
 * ============================================================ */

// ==================== 常量 & 默认设置 ====================
const DEFAULT_SETTINGS = {
  previewAmount: 5,
  previewUnit: 'lines',
  autoFoldNew: false,
  minFoldLength: 10,
  persist: true,
  truncateStyle: 'hard',
  foldUserMessages: false,
};

const SETTINGS_KEY = 'stfold_settings_v1';
const STATES_KEY = 'stfold_states_v1';
const PACKS_KEY = 'stfold_packs_v1';    // 收纳包数据

const FOLD_BTN_CLASS = 'stfold-btn';
const FOLDED_CLASS = 'stfold-folded';
const FADE_CLASS = 'stfold-fade';
const MENU_ITEM_ID = 'stfold_menu_item';
const POPUP_ID = 'stfold_popup';

// 收纳包相关 class
const PACK_HEADER_CLASS = 'stfold-pack-header';
const PACK_FOOTER_CLASS = 'stfold-pack-footer';
const PACK_HIDDEN_CLASS = 'stfold-pack-hidden';

// ==================== 图标 ====================
const SVG_UNFOLDED =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="vertical-align:middle;">' +
  '<path d="M4 9h16v2H4zm0 4h16v2H4zM7 6l5-3 5 3H7zm10 12l-5 3-5-3h10z"/></svg>';
const SVG_FOLDED =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="vertical-align:middle;">' +
  '<path d="M4 11h16v2H4zM7 8l5 3 5-3H7zm10 8l-5-3-5 3h10z"/></svg>';
const SVG_MENU_ICON =
  '<svg viewBox="0 0 48 48" width="20" height="20" fill="currentColor" style="vertical-align:middle; margin-right: 4px;">' +
  '<rect x="8" y="10" width="32" height="4" rx="2"/>' +
  '<rect x="8" y="18" width="32" height="3" rx="1.5" opacity="0.75"/>' +
  '<rect x="8" y="24" width="32" height="2" rx="1" opacity="0.5"/>' +
  '<rect x="8" y="29" width="32" height="2" rx="1" opacity="0.5"/>' +
  '<rect x="8" y="34" width="32" height="4" rx="2"/></svg>';

// ==================== 设置 & 状态管理 ====================
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}
function loadStates() {
  if (!settings.persist) return {};
  try { return JSON.parse(localStorage.getItem(STATES_KEY) || '{}'); } catch (e) { return {}; }
}
function saveStates(states) {
  if (!settings.persist) return;
  try { localStorage.setItem(STATES_KEY, JSON.stringify(states)); } catch (e) {}
}

// ---- 收纳包数据 ----
// 结构: { [chatId]: [ { id, name, startMesId, endMesId, mode, collapsed } ] }
function loadAllPacks() {
  try { return JSON.parse(localStorage.getItem(PACKS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveAllPacks(allPacks) {
  try { localStorage.setItem(PACKS_KEY, JSON.stringify(allPacks)); } catch (e) {}
}
function getPacksForChat() {
  const all = loadAllPacks();
  return all[getChatId()] || [];
}
function setPacksForChat(packs) {
  const all = loadAllPacks();
  all[getChatId()] = packs;
  saveAllPacks(all);
}

function getChatId() {
  try {
    const ctx = window.parent.SillyTavern?.getContext?.();
    if (ctx?.chatId) return ctx.chatId;
    if (ctx?.characterId != null) return 'char_' + ctx.characterId;
  } catch (e) {}
  return 'default';
}
function stateKeyForMes($mes) {
  const mid = $mes.attr('mesid') || '?';
  const swipeId = $mes.attr('swipeid') || '0';
  return `${getChatId()}::${mid}::${swipeId}`;
}
function isLongEnough($mesText) {
  if (!$mesText || $mesText.length === 0) return false;
  const text = $mesText.text() || '';
  if (settings.previewUnit === 'chars') {
    return text.length >= settings.minFoldLength;
  } else {
    const lineCount = (text.match(/\n/g) || []).length + 1;
    return lineCount >= settings.minFoldLength || text.length >= settings.minFoldLength * 50;
  }
}

function getDoc() { return (window.parent || window).document; }
function getParent$() { return (window.parent || window).$ || $; }

// ==================== 样式 ====================
function buildCss() {
  const amt = settings.previewAmount;
  const unit = settings.previewUnit;
  const clampRule =
    unit === 'lines'
      ? `-webkit-line-clamp: ${amt};`
      : `max-height: ${Math.max(2, Math.ceil(amt / 20))}em;`;
  const fadeRule =
    settings.truncateStyle === 'fade'
      ? `.mes_text.${FOLDED_CLASS}.${FADE_CLASS} {
      -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
              mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
    }`
      : '';

  return `
    /* ===== 小折叠 ===== */
    .${FOLD_BTN_CLASS} {
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      padding: 0 4px; opacity: 0.75; transition: opacity 0.15s, color 0.15s; color: inherit;
    }
    .${FOLD_BTN_CLASS}:hover { opacity: 1; }
    .${FOLD_BTN_CLASS}.active { color: var(--SmartThemeQuoteColor, #7aa2f7); opacity: 1; }
    .mes_text.${FOLDED_CLASS} {
      display: -webkit-box !important; -webkit-box-orient: vertical;
      ${clampRule} overflow: hidden;
    }
    ${fadeRule}
    .stfold-link {
      display: block; margin-top: 6px;
      color: var(--SmartThemeQuoteColor, #7aa2f7);
      cursor: pointer; font-size: 0.9em; user-select: none;
    }
    .stfold-link:hover { text-decoration: underline; }

    /* ===== 大折叠 (收纳包) ===== */
    .${PACK_HIDDEN_CLASS} { display: none !important; }

    .${PACK_HEADER_CLASS}, .${PACK_FOOTER_CLASS} {
      background: var(--SmartThemeBlurTintColor, #1e1e2e);
      border: 1px solid var(--SmartThemeBorderColor, #444);
      border-left: 6px solid var(--SmartThemeQuoteColor, #7aa2f7);
      border-radius: 10px;
      margin: 14px 0;
      padding: 18px 20px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
      width: 100%;
      box-sizing: border-box;
    }
    .${PACK_HEADER_CLASS}:hover, .${PACK_FOOTER_CLASS}:hover {
      background: rgba(255,255,255,0.06);
    }
    .${PACK_HEADER_CLASS} .pack-bar, .${PACK_FOOTER_CLASS} .pack-bar {
      display: flex; align-items: center; gap: 14px;
    }
    .pack-icon { font-size: 32px; flex-shrink: 0; }
    .pack-info { flex: 1; min-width: 0; }
    .pack-name {
      font-weight: 700; font-size: 16px;
      color: var(--SmartThemeEmColor, #fff);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .pack-note {
      font-size: 13px; opacity: 0.6; margin-top: 4px;
      line-height: 1.45;
      display: -webkit-box; -webkit-box-orient: vertical;
      -webkit-line-clamp: 2; overflow: hidden;
    }
    .pack-meta {
      font-size: 13px; opacity: 0.5; margin-top: 5px;
    }
    .pack-toggle {
      font-size: 15px; opacity: 0.8;
      color: var(--SmartThemeQuoteColor, #7aa2f7);
      flex-shrink: 0; white-space: nowrap;
      font-weight: 600;
    }
    .pack-mode-badge {
      font-size: 11px; padding: 2px 8px;
      border-radius: 4px; background: rgba(255,100,100,0.2);
      color: #f77; font-weight: 600;
    }

    /* ===== 魔法棒菜单项 ===== */
    #${MENU_ITEM_ID} { cursor: pointer; }

    /* ===== 设置弹窗 ===== */
    #${POPUP_ID}_mask {
      position: fixed !important; top: 0 !important; left: 0 !important;
      right: 0 !important; bottom: 0 !important;
      width: 100vw !important; height: 100vh !important; height: 100dvh !important;
      background: rgba(0,0,0,0.82) !important;
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      z-index: 2147483646 !important;
      display: flex !important; align-items: center !important; justify-content: center !important;
      padding: 12px !important; box-sizing: border-box !important; margin: 0 !important;
    }
    #${POPUP_ID} {
      background: var(--SmartThemeBlurTintColor, #1e1e2e);
      color: var(--SmartThemeBodyColor, #d4d4d4);
      border: 1px solid var(--SmartThemeBorderColor, #444);
      border-radius: 12px;
      width: min(440px, 100%); max-width: 100%;
      max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px);
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
      z-index: 2147483647;
      display: flex !important; flex-direction: column !important;
      overflow: hidden !important; position: relative; margin: 0 !important;
    }

    /* tab 栏 */
    .stfold-tabs {
      display: flex; border-bottom: 1px solid var(--SmartThemeBorderColor, #333);
      flex-shrink: 0;
    }
    .stfold-tab {
      flex: 1; padding: 12px 8px; text-align: center;
      cursor: pointer; font-size: 14px; font-weight: 500;
      border-bottom: 2px solid transparent;
      transition: all 0.15s; opacity: 0.6;
    }
    .stfold-tab:hover { opacity: 0.85; }
    .stfold-tab.active {
      opacity: 1; border-bottom-color: var(--SmartThemeQuoteColor, #7aa2f7);
      color: var(--SmartThemeQuoteColor, #7aa2f7);
    }
    .stfold-page { display: none; }
    .stfold-page.active { display: block; }

    #${POPUP_ID} .stfold-body {
      padding: 4px 18px; overflow-y: auto; flex: 1 1 auto;
      -webkit-overflow-scrolling: touch;
    }
    #${POPUP_ID} .stfold-row { margin: 10px 0; }
    #${POPUP_ID} .stfold-row-main {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px;
    }
    #${POPUP_ID} label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    #${POPUP_ID} input[type="number"], #${POPUP_ID} input[type="text"] {
      background: rgba(0,0,0,0.25); color: inherit;
      border: 1px solid var(--SmartThemeBorderColor, #555);
      border-radius: 4px; padding: 3px 6px; font-size: 14px;
    }
    #${POPUP_ID} input[type="number"] { width: 60px; }
    #${POPUP_ID} input[type="text"] { width: 100%; box-sizing: border-box; }
    #${POPUP_ID} select {
      background: rgba(0,0,0,0.25); color: inherit;
      border: 1px solid var(--SmartThemeBorderColor, #555);
      border-radius: 4px; padding: 3px 6px; font-size: 14px;
    }
    #${POPUP_ID} .stfold-hint { font-size: 11px; opacity: 0.55; margin-top: 3px; line-height: 1.4; }
    #${POPUP_ID} .stfold-footer {
      padding: 10px 18px 14px;
      border-top: 1px solid var(--SmartThemeBorderColor, #333); flex-shrink: 0;
    }
    #${POPUP_ID} .stfold-close {
      display: block; width: 100%; padding: 9px;
      background: var(--SmartThemeQuoteColor, #7aa2f7); color: #fff;
      border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;
    }
    #${POPUP_ID} .stfold-close:hover { opacity: 0.88; }
    #${POPUP_ID} .stfold-batch-btns { display: flex; gap: 8px; margin-bottom: 10px; }
    #${POPUP_ID} .stfold-batch-btn {
      flex: 1; padding: 8px; background: rgba(255,255,255,0.08); color: inherit;
      border: 1px solid var(--SmartThemeBorderColor, #555);
      border-radius: 6px; cursor: pointer; font-size: 13px; transition: background 0.15s;
    }
    #${POPUP_ID} .stfold-batch-btn:hover { background: rgba(255,255,255,0.15); }

    /* 收纳管理页 */
    .stfold-pack-form { margin-bottom: 12px; }
    .stfold-pack-form .stfold-row-main { margin-bottom: 6px; }
    .stfold-create-btn {
      width: 100%; padding: 9px; margin-top: 8px;
      background: var(--SmartThemeQuoteColor, #7aa2f7); color: #fff;
      border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;
    }
    .stfold-create-btn:hover { opacity: 0.88; }
    .stfold-pack-list { margin-top: 12px; }
    .stfold-pack-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; margin: 4px 0;
      background: rgba(255,255,255,0.04); border-radius: 6px;
    }
    .stfold-pack-item .pack-item-info { flex: 1; min-width: 0; }
    .stfold-pack-item .pack-item-name {
      font-weight: 600; font-size: 13px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .stfold-pack-item .pack-item-range { font-size: 11px; opacity: 0.6; }
    .stfold-pack-item .pack-item-del {
      width: 28px; height: 28px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,80,80,0.15); color: #f55; cursor: pointer;
      border: none; font-size: 14px; flex-shrink: 0;
    }
    .stfold-pack-item .pack-item-del:hover { background: rgba(255,80,80,0.3); }
    .stfold-pack-item .pack-item-edit {
      width: 28px; height: 28px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(122,162,247,0.15); cursor: pointer;
      border: none; font-size: 13px; flex-shrink: 0;
    }
    .stfold-pack-item .pack-item-edit:hover { background: rgba(122,162,247,0.3); }
    .stfold-pack-item .pack-item-note {
      font-size: 11px; opacity: 0.55; margin-top: 1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .stfold-section-title {
      font-size: 12px; opacity: 0.5; margin: 14px 0 6px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
  `;
}

function injectStyle() {
  const doc = getDoc();
  let style = doc.getElementById('stfold-style');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'stfold-style';
    doc.head.appendChild(style);
  }
  style.textContent = buildCss();
}

// ==================== 小折叠 (保留 v3 所有逻辑) ====================
function applyState($mes, state) {
  const $mesText = $mes.find('.mes_text').first();
  const $btn = $mes.find('.' + FOLD_BTN_CLASS);
  $mes.find('.stfold-link').remove();
  if (state === 'off') {
    $mesText.removeClass(FOLDED_CLASS + ' ' + FADE_CLASS);
    $btn.removeClass('active').attr('title', '折叠消息').html(SVG_UNFOLDED);
    return;
  }
  $btn.addClass('active').attr('title', '关闭折叠模式').html(SVG_FOLDED);
  if (state === 'folded') {
    $mesText.addClass(FOLDED_CLASS);
    if (settings.truncateStyle === 'fade') $mesText.addClass(FADE_CLASS);
    addLink($mes, 'expand');
  } else {
    $mesText.removeClass(FOLDED_CLASS + ' ' + FADE_CLASS);
    addLink($mes, 'collapse');
  }
}

function addLink($mes, type) {
  const doc = getDoc();
  const $mesText = $mes.find('.mes_text').first();
  const link = doc.createElement('span');
  link.className = 'stfold-link';
  if (type === 'expand') {
    link.textContent = '▼ 展开剩余内容';
    link.addEventListener('click', (e) => { e.stopPropagation(); setState($mes, 'expanded'); });
  } else {
    link.textContent = '▲ 收起折叠';
    link.addEventListener('click', (e) => { e.stopPropagation(); setState($mes, 'folded'); });
  }
  $mesText.after(link);
}

function setState($mes, newState) {
  applyState($mes, newState);
  if (!settings.persist) return;
  const states = loadStates();
  const key = stateKeyForMes($mes);
  if (newState === 'off') delete states[key];
  else states[key] = newState;
  saveStates(states);
}

function getDesiredState($mes, isNewMessage = false) {
  if (settings.persist) {
    const states = loadStates();
    const saved = states[stateKeyForMes($mes)];
    if (saved === 'folded' || saved === 'expanded') return saved;
  }
  if (isNewMessage && settings.autoFoldNew) return 'folded';
  return 'off';
}

function onFoldButtonClick($mes) {
  const $mesText = $mes.find('.mes_text').first();
  const isOn = $mesText.hasClass(FOLDED_CLASS) || $mes.find('.stfold-link').length > 0;
  setState($mes, isOn ? 'off' : 'folded');
}

function addFoldButton(messageId, isNewMessage = false) {
  const doc = getDoc();
  let $mes;
  try {
    const $mesBlock = retrieveDisplayedMessage(messageId);
    if ($mesBlock && $mesBlock.length > 0) $mes = $mesBlock.closest('.mes');
  } catch (e) {}
  if (!$mes || $mes.length === 0) {
    const nativeMes = doc.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (nativeMes) $mes = getParent$()(nativeMes);
  }
  if (!$mes || $mes.length === 0) return;
  if ($mes.attr('is_user') === 'true' && !settings.foldUserMessages) return;
  const $mesText = $mes.find('.mes_text').first();
  if (!isLongEnough($mesText)) return;
  const $buttons = $mes.find('.mes_buttons').first();
  if ($buttons.length === 0) return;
  if ($buttons.find('.' + FOLD_BTN_CLASS).length === 0) {
    const btnEl = doc.createElement('div');
    btnEl.className = FOLD_BTN_CLASS;
    btnEl.title = '折叠消息';
    btnEl.innerHTML = SVG_UNFOLDED;
    btnEl.addEventListener('click', (e) => { e.stopPropagation(); onFoldButtonClick($mes); });
    $buttons.prepend(btnEl);
  }
  applyState($mes, getDesiredState($mes, isNewMessage));
}

function refreshAllMessages() {
  let lastId;
  try { lastId = getLastMessageId(); } catch (e) { return; }
  for (let i = 0; i <= lastId; i++) addFoldButton(i);
}

// 一键折叠/展开所有 (小折叠)
function foldAllMessages() {
  const doc = getDoc(); const $p = getParent$();
  const allMes = doc.querySelectorAll('#chat .mes');
  let count = 0;
  allMes.forEach(mesEl => {
    const $mes = $p(mesEl);
    if ($mes.attr('is_user') === 'true' && !settings.foldUserMessages) return;
    const $mesText = $mes.find('.mes_text').first();
    if (!isLongEnough($mesText)) return;
    const mid = $mes.attr('mesid');
    if (mid != null) addFoldButton(parseInt(mid));
    setState($mes, 'folded');
    count++;
  });
  if (typeof toastr !== 'undefined') toastr.info(`已折叠 ${count} 条消息`, 'stfold');
}

function unfoldAllMessages() {
  const doc = getDoc(); const $p = getParent$();
  const allMes = doc.querySelectorAll('#chat .mes');
  let count = 0;
  allMes.forEach(mesEl => {
    const $mes = $p(mesEl);
    const $mesText = $mes.find('.mes_text').first();
    if ($mesText.hasClass(FOLDED_CLASS) || $mes.find('.stfold-link').length > 0) {
      setState($mes, 'off');
      count++;
    }
  });
  if (typeof toastr !== 'undefined') toastr.info(`已展开 ${count} 条消息`, 'stfold');
}

function reapplyAllSettings() {
  const doc = getDoc();
  injectStyle();
  $(doc).find('.' + FOLD_BTN_CLASS).remove();
  $(doc).find('.stfold-link').remove();
  $(doc).find('.mes_text').removeClass(FOLDED_CLASS + ' ' + FADE_CLASS);
  refreshAllMessages();
}

// ==================== 大折叠 (收纳包系统) ====================

function generatePackId() {
  return 'pack_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// 在聊天界面里渲染一个收纳包的卡头卡尾 + 隐藏中间消息
function renderPack(pack) {
  const doc = getDoc();
  const $p = getParent$();

  // 先清掉旧的卡头卡尾 (如果有)
  cleanPackDom(pack.id);

  // 找到起止消息的 DOM
  const startMes = doc.querySelector(`#chat .mes[mesid="${pack.startMesId}"]`);
  const endMes = doc.querySelector(`#chat .mes[mesid="${pack.endMesId}"]`);
  if (!startMes || !endMes) return;

  const count = pack.endMesId - pack.startMesId + 1;
  const modeLabel = pack.mode === 'hide' ? '<span class="pack-mode-badge">已隐藏</span>' : '';
  const noteHtml = pack.note ? `<div class="pack-note">${escHtml(pack.note)}</div>` : '';
  const collapsed = pack.collapsed !== false;

  // ---- 卡头 ----
  const header = doc.createElement('div');
  header.className = PACK_HEADER_CLASS;
  header.dataset.packId = pack.id;
  header.innerHTML = `
    <div class="pack-bar">
      <span class="pack-icon">📦</span>
      <div class="pack-info">
        <div class="pack-name">${escHtml(pack.name)} ${modeLabel}</div>
        ${noteHtml}
        <div class="pack-meta">第 ${pack.startMesId} - ${pack.endMesId} 楼 · ${count} 条消息</div>
      </div>
      <span class="pack-toggle">${collapsed ? '展开 ▼' : '收起 ▲'}</span>
    </div>
  `;
  header.addEventListener('click', () => togglePack(pack.id));
  startMes.parentNode.insertBefore(header, startMes);

  // ---- 卡尾 ----
  const footer = doc.createElement('div');
  footer.className = PACK_FOOTER_CLASS;
  footer.dataset.packId = pack.id;
  footer.style.display = collapsed ? 'none' : '';
  footer.innerHTML = `
    <div class="pack-bar">
      <span class="pack-icon">📦</span>
      <div class="pack-info">
        <div class="pack-name">${escHtml(pack.name)} · 结束</div>
      </div>
      <span class="pack-toggle">收起 ▲</span>
    </div>
  `;
  footer.addEventListener('click', () => togglePack(pack.id));
  // 插到最后一条消息的后面
  if (endMes.nextSibling) {
    endMes.parentNode.insertBefore(footer, endMes.nextSibling);
  } else {
    endMes.parentNode.appendChild(footer);
  }

  // ---- 隐藏/显示中间消息 ----
  applyPackVisibility(pack);
}

// 切换收纳包展开/折叠
function togglePack(packId) {
  const packs = getPacksForChat();
  const pack = packs.find(p => p.id === packId);
  if (!pack) return;

  pack.collapsed = !pack.collapsed;
  setPacksForChat(packs);
  applyPackVisibility(pack);

  // 更新卡头卡尾的文字
  const doc = getDoc();
  const header = doc.querySelector(`.${PACK_HEADER_CLASS}[data-pack-id="${packId}"]`);
  const footer = doc.querySelector(`.${PACK_FOOTER_CLASS}[data-pack-id="${packId}"]`);
  if (header) {
    header.querySelector('.pack-toggle').textContent = pack.collapsed ? '展开 ▼' : '收起 ▲';
  }
  if (footer) {
    footer.style.display = pack.collapsed ? 'none' : '';
  }
}

// 根据收纳包状态隐藏/显示中间消息
function applyPackVisibility(pack) {
  const doc = getDoc();
  for (let mid = pack.startMesId; mid <= pack.endMesId; mid++) {
    const mesEl = doc.querySelector(`#chat .mes[mesid="${mid}"]`);
    if (!mesEl) continue;
    if (pack.collapsed) {
      mesEl.classList.add(PACK_HIDDEN_CLASS);
    } else {
      mesEl.classList.remove(PACK_HIDDEN_CLASS);
    }
  }
}

// 清除某个收纳包的 DOM 元素 (卡头卡尾 + 取消隐藏)
function cleanPackDom(packId) {
  const doc = getDoc();
  doc.querySelectorAll(`[data-pack-id="${packId}"]`).forEach(el => el.remove());
}

// 渲染当前聊天的所有收纳包
function renderAllPacks() {
  const doc = getDoc();
  // 先清掉所有旧的卡头卡尾
  doc.querySelectorAll('.' + PACK_HEADER_CLASS + ', .' + PACK_FOOTER_CLASS).forEach(el => el.remove());
  // 取消所有大折叠隐藏
  doc.querySelectorAll('.' + PACK_HIDDEN_CLASS).forEach(el => el.classList.remove(PACK_HIDDEN_CLASS));

  const packs = getPacksForChat();
  packs.forEach(pack => renderPack(pack));
}

// 创建收纳包
function createPack(name, startId, endId, mode, note) {
  if (startId > endId) { const t = startId; startId = endId; endId = t; }

  const packs = getPacksForChat();

  // 检查是否跟已有收纳包重叠
  for (const p of packs) {
    if (startId <= p.endMesId && endId >= p.startMesId) {
      if (typeof toastr !== 'undefined') {
        toastr.error(`跟已有收纳包 "${p.name}" (${p.startMesId}-${p.endMesId}楼) 重叠`, 'stfold');
      }
      return false;
    }
  }

  const pack = {
    id: generatePackId(),
    name: name || `收纳包 ${packs.length + 1}`,
    note: note || '',
    startMesId: startId,
    endMesId: endId,
    mode: mode,
    collapsed: true,
  };

  packs.push(pack);
  setPacksForChat(packs);

  // 如果是 hide 模式, 执行酒馆原生 /hide 命令
  if (mode === 'hide') {
    executeHideCommand(startId, endId);
  }

  renderPack(pack);
  return true;
}

// 删除收纳包
function deletePack(packId) {
  let packs = getPacksForChat();
  const pack = packs.find(p => p.id === packId);
  if (!pack) return;

  // 取消隐藏中间消息
  const doc = getDoc();
  for (let mid = pack.startMesId; mid <= pack.endMesId; mid++) {
    const mesEl = doc.querySelector(`#chat .mes[mesid="${mid}"]`);
    if (mesEl) mesEl.classList.remove(PACK_HIDDEN_CLASS);
  }

  // 如果是 hide 模式, 执行 /unhide
  if (pack.mode === 'hide') {
    executeUnhideCommand(pack.startMesId, pack.endMesId);
  }

  cleanPackDom(packId);
  packs = packs.filter(p => p.id !== packId);
  setPacksForChat(packs);
}

// 调用酒馆的 /hide 和 /unhide 斜杠命令
function executeHideCommand(startId, endId) {
  try {
    const ctx = window.parent.SillyTavern?.getContext?.();
    if (ctx && ctx.executeSlashCommands) {
      ctx.executeSlashCommands(`/hide ${startId}-${endId}`);
    } else if (window.executeSlashCommands) {
      window.executeSlashCommands(`/hide ${startId}-${endId}`);
    }
  } catch (e) {
    console.warn('[stfold] /hide 执行失败:', e);
  }
}

function executeUnhideCommand(startId, endId) {
  try {
    const ctx = window.parent.SillyTavern?.getContext?.();
    if (ctx && ctx.executeSlashCommands) {
      ctx.executeSlashCommands(`/unhide ${startId}-${endId}`);
    } else if (window.executeSlashCommands) {
      window.executeSlashCommands(`/unhide ${startId}-${endId}`);
    }
  } catch (e) {
    console.warn('[stfold] /unhide 执行失败:', e);
  }
}

function escHtml(str) {
  const d = getDoc().createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ==================== 魔法棒菜单项 ====================
function addMenuItem() {
  const doc = getDoc();
  if (doc.getElementById(MENU_ITEM_ID)) return;
  const menu = doc.getElementById('extensionsMenu');
  if (!menu) { console.warn('[stfold] 找不到 #extensionsMenu'); return; }

  const itemHtml = `
    <div id="${MENU_ITEM_ID}" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
      <div style="width: 20px; display: inline-flex; justify-content: center; align-items: center;">
        ${SVG_MENU_ICON}
      </div>
      <span>消息折叠设置</span>
    </div>
  `;
  $(menu).append(itemHtml);
  $(doc).find('#' + MENU_ITEM_ID).on('click', () => openSettingsPopup());
}

// ==================== 设置弹窗 (双页 tab) ====================

// 生成收纳包列表 HTML
function buildPackListHtml() {
  const packs = getPacksForChat();
  if (packs.length === 0) {
    return { html: '<div class="stfold-hint" style="text-align:center; padding: 12px 0;">当前对话暂无收纳包</div>', count: 0 };
  }
  const html = packs.map(p => `
    <div class="stfold-pack-item" data-pack-id="${p.id}">
      <span class="pack-icon">📦</span>
      <div class="pack-item-info">
        <div class="pack-item-name">${escHtml(p.name)}${p.mode === 'hide' ? ' <span class="pack-mode-badge">已隐藏</span>' : ''}</div>
        ${p.note ? `<div class="pack-item-note">${escHtml(p.note)}</div>` : ''}
        <div class="pack-item-range">第 ${p.startMesId} - ${p.endMesId} 楼 · ${p.endMesId - p.startMesId + 1} 条</div>
      </div>
      <button class="pack-item-edit" data-edit-id="${p.id}" title="编辑">✏️</button>
      <button class="pack-item-del" data-del-id="${p.id}" title="删除">✕</button>
    </div>
  `).join('');
  return { html, count: packs.length };
}

// 局部刷新收纳包列表 (不关弹窗, 不闪烁)
function refreshPackList() {
  const doc = getDoc();
  const listEl = doc.getElementById('stfold-pack-list');
  if (!listEl) return;
  const { html, count } = buildPackListHtml();
  listEl.innerHTML = html;

  // 更新标题里的计数
  const titleEl = listEl.previousElementSibling;
  if (titleEl && titleEl.classList.contains('stfold-section-title')) {
    titleEl.textContent = `已有收纳包 (${count})`;
  }

  // 重新绑定编辑/删除事件
  bindPackListEvents(listEl);
}

// 绑定列表里的编辑/删除按钮事件
function bindPackListEvents(container) {
  container.querySelectorAll('.pack-item-edit').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openEditPopup(this.dataset.editId);
    });
  });
  container.querySelectorAll('.pack-item-del').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      deletePack(this.dataset.delId);
      if (typeof toastr !== 'undefined') toastr.info('收纳包已删除', 'stfold');
      refreshPackList();
    });
  });
}

function openSettingsPopup() {
  const doc = getDoc();
  if (doc.getElementById(POPUP_ID)) return;

  const packs = getPacksForChat();
  let lastId = 0;
  try { lastId = getLastMessageId(); } catch (e) {}

  const { html: packListHtml, count: packCount } = buildPackListHtml();

  const html = `
    <div id="${POPUP_ID}_mask">
      <div id="${POPUP_ID}">

        <div class="stfold-tabs">
          <div class="stfold-tab active" data-tab="fold">📐 折叠设置</div>
          <div class="stfold-tab" data-tab="pack">📦 收纳管理</div>
        </div>

        <div class="stfold-body">
          <!-- ===== 页1: 折叠设置 ===== -->
          <div class="stfold-page active" data-page="fold">

            <div class="stfold-row">
              <div class="stfold-row-main">
                <label>预览长度:</label>
                <input type="number" id="stfold-preview-amount" min="1" max="9999" value="${settings.previewAmount}">
                <select id="stfold-preview-unit">
                  <option value="lines" ${settings.previewUnit === 'lines' ? 'selected' : ''}>行</option>
                  <option value="chars" ${settings.previewUnit === 'chars' ? 'selected' : ''}>字</option>
                </select>
              </div>
              <div class="stfold-hint">折叠后保留多少内容作为预览</div>
            </div>

            <div class="stfold-row">
              <div class="stfold-row-main">
                <label><input type="checkbox" id="stfold-auto-fold" ${settings.autoFoldNew ? 'checked' : ''}> 新消息自动折叠</label>
              </div>
              <div class="stfold-hint">开启后, AI 每条新回复都会自动进入折叠状态</div>
            </div>

            <div class="stfold-row">
              <div class="stfold-row-main">
                <label>最小折叠长度:</label>
                <input type="number" id="stfold-min-length" min="1" max="9999" value="${settings.minFoldLength}">
                <span style="opacity: 0.75;">(单位同上)</span>
              </div>
              <div class="stfold-hint">达到这个长度才显示折叠按钮, 短消息不挂图标</div>
            </div>

            <div class="stfold-row">
              <div class="stfold-row-main">
                <label><input type="checkbox" id="stfold-persist" ${settings.persist ? 'checked' : ''}> 刷新后保留折叠状态</label>
              </div>
              <div class="stfold-hint">按 聊天+消息+swipe 独立记忆</div>
            </div>

            <div class="stfold-row">
              <div class="stfold-row-main">
                <label>截断样式:</label>
                <select id="stfold-truncate-style">
                  <option value="hard" ${settings.truncateStyle === 'hard' ? 'selected' : ''}>硬截断</option>
                  <option value="fade" ${settings.truncateStyle === 'fade' ? 'selected' : ''}>渐变淡出</option>
                </select>
              </div>
              <div class="stfold-hint">渐变淡出: 底部文字逐渐变透明, 视觉更柔和</div>
            </div>

            <div class="stfold-row">
              <div class="stfold-row-main">
                <label><input type="checkbox" id="stfold-fold-user" ${settings.foldUserMessages ? 'checked' : ''}> 允许折叠用户消息</label>
              </div>
              <div class="stfold-hint">默认只折叠 AI 消息</div>
            </div>

            <div class="stfold-batch-btns">
              <button class="stfold-batch-btn" id="stfold-fold-all">📥 一键折叠所有</button>
              <button class="stfold-batch-btn" id="stfold-unfold-all">📤 一键展开所有</button>
            </div>

          </div>

          <!-- ===== 页2: 收纳管理 ===== -->
          <div class="stfold-page" data-page="pack">

            <div class="stfold-section-title">创建收纳包</div>
            <div class="stfold-pack-form">
              <div class="stfold-row">
                <div class="stfold-row-main">
                  <label>名称:</label>
                  <input type="text" id="stfold-pack-name" placeholder="给这个收纳包起个名字" maxlength="50">
                </div>
              </div>
              <div class="stfold-row">
                <div class="stfold-row-main">
                  <label>备注:</label>
                  <input type="text" id="stfold-pack-note" placeholder="可选备注 (显示在卡片名称下方)" maxlength="200">
                </div>
              </div>
              <div class="stfold-row">
                <div class="stfold-row-main">
                  <label>从第</label>
                  <input type="number" id="stfold-pack-start" min="0" max="${lastId}" value="0" style="width:60px;">
                  <label>楼到第</label>
                  <input type="number" id="stfold-pack-end" min="0" max="${lastId}" value="${lastId}" style="width:60px;">
                  <label>楼</label>
                </div>
                <div class="stfold-hint">当前对话共 ${lastId + 1} 条消息 (0 - ${lastId} 楼)</div>
              </div>
              <div class="stfold-row">
                <div class="stfold-row-main">
                  <label>模式:</label>
                  <select id="stfold-pack-mode">
                    <option value="fold">仅收纳 (视觉折叠)</option>
                    <option value="hide">收纳 + 隐藏 (不发送给AI)</option>
                  </select>
                </div>
                <div class="stfold-hint">隐藏模式会调用酒馆的 /hide 命令</div>
              </div>
              <button class="stfold-create-btn" id="stfold-create-pack">📦 创建收纳包</button>
            </div>

            <div class="stfold-section-title">已有收纳包 (${packCount})</div>
            <div class="stfold-pack-list" id="stfold-pack-list">
              ${packListHtml}
            </div>

          </div>
        </div>

        <div class="stfold-footer">
          <button class="stfold-close">完成</button>
        </div>

      </div>
    </div>
  `;

  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html;
  const maskEl = wrapper.firstElementChild;
  doc.body.appendChild(maskEl);

  // ---- 事件绑定 ----
  maskEl.addEventListener('click', function (e) { if (e.target === maskEl) closePopup(); });
  maskEl.querySelector('.stfold-close').addEventListener('click', closePopup);

  // tab 切换
  maskEl.querySelectorAll('.stfold-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      maskEl.querySelectorAll('.stfold-tab').forEach(t => t.classList.remove('active'));
      maskEl.querySelectorAll('.stfold-page').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      maskEl.querySelector(`.stfold-page[data-page="${this.dataset.tab}"]`).classList.add('active');
    });
  });

  // 折叠设置事件 (跟 v3 一样)
  maskEl.querySelector('#stfold-preview-amount').addEventListener('change', function () {
    settings.previewAmount = Math.max(1, parseInt(this.value) || 1);
    saveSettings(); reapplyAllSettings();
  });
  maskEl.querySelector('#stfold-preview-unit').addEventListener('change', function () {
    settings.previewUnit = this.value;
    saveSettings(); reapplyAllSettings();
  });
  maskEl.querySelector('#stfold-auto-fold').addEventListener('change', function () {
    settings.autoFoldNew = this.checked; saveSettings();
  });
  maskEl.querySelector('#stfold-min-length').addEventListener('change', function () {
    settings.minFoldLength = Math.max(1, parseInt(this.value) || 1);
    saveSettings(); reapplyAllSettings();
  });
  maskEl.querySelector('#stfold-persist').addEventListener('change', function () {
    settings.persist = this.checked; saveSettings();
    if (!settings.persist) { try { localStorage.removeItem(STATES_KEY); } catch (e) {} }
  });
  maskEl.querySelector('#stfold-truncate-style').addEventListener('change', function () {
    settings.truncateStyle = this.value;
    saveSettings(); reapplyAllSettings();
  });
  maskEl.querySelector('#stfold-fold-user').addEventListener('change', function () {
    settings.foldUserMessages = this.checked;
    saveSettings(); reapplyAllSettings();
  });
  maskEl.querySelector('#stfold-fold-all').addEventListener('click', () => foldAllMessages());
  maskEl.querySelector('#stfold-unfold-all').addEventListener('click', () => unfoldAllMessages());

  // 收纳包: 创建
  maskEl.querySelector('#stfold-create-pack').addEventListener('click', function () {
    const name = maskEl.querySelector('#stfold-pack-name').value.trim();
    const note = maskEl.querySelector('#stfold-pack-note').value.trim();
    const startId = parseInt(maskEl.querySelector('#stfold-pack-start').value) || 0;
    const endId = parseInt(maskEl.querySelector('#stfold-pack-end').value) || 0;
    const mode = maskEl.querySelector('#stfold-pack-mode').value;

    if (startId === endId) {
      if (typeof toastr !== 'undefined') toastr.warning('起止楼层不能相同', 'stfold');
      return;
    }

    const ok = createPack(name, startId, endId, mode, note);
    if (ok) {
      if (typeof toastr !== 'undefined') toastr.success(`收纳包 "${name || '未命名'}" 创建成功`, 'stfold');
      // 清空表单
      maskEl.querySelector('#stfold-pack-name').value = '';
      maskEl.querySelector('#stfold-pack-note').value = '';
      // 局部刷新列表, 不关弹窗
      refreshPackList();
    }
  });

  // 收纳包列表: 绑定编辑/删除事件
  const packListEl = maskEl.querySelector('#stfold-pack-list');
  if (packListEl) bindPackListEvents(packListEl);
}

// 编辑收纳包的小弹窗
function openEditPopup(packId) {
  const doc = getDoc();
  const packs = getPacksForChat();
  const pack = packs.find(p => p.id === packId);
  if (!pack) return;

  const editId = 'stfold_edit_popup';
  if (doc.getElementById(editId + '_mask')) return;

  const html = `
    <div id="${editId}_mask" style="
      position:fixed!important; top:0!important; left:0!important; right:0!important; bottom:0!important;
      width:100vw!important; height:100vh!important; height:100dvh!important;
      background:rgba(0,0,0,0.82)!important; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
      z-index:2147483646!important; display:flex!important; align-items:center!important;
      justify-content:center!important; padding:12px!important; box-sizing:border-box!important; margin:0!important;">
      <div style="
        background:var(--SmartThemeBlurTintColor,#1e1e2e); color:var(--SmartThemeBodyColor,#d4d4d4);
        border:1px solid var(--SmartThemeBorderColor,#444); border-radius:12px;
        width:min(380px,100%); padding:20px; box-shadow:0 10px 40px rgba(0,0,0,0.6); z-index:2147483647;">
        <h3 style="margin:0 0 14px; font-size:15px; color:var(--SmartThemeEmColor,#fff);">✏️ 编辑收纳包</h3>
        <div style="margin:10px 0;">
          <label style="font-size:14px;">名称:</label>
          <input type="text" id="stfold-edit-name" value="${escHtml(pack.name)}" maxlength="50"
            style="width:100%; box-sizing:border-box; margin-top:4px; background:rgba(0,0,0,0.25);
            color:inherit; border:1px solid var(--SmartThemeBorderColor,#555); border-radius:4px;
            padding:6px 8px; font-size:14px;">
        </div>
        <div style="margin:10px 0;">
          <label style="font-size:14px;">备注:</label>
          <input type="text" id="stfold-edit-note" value="${escHtml(pack.note || '')}" maxlength="200"
            placeholder="可选备注"
            style="width:100%; box-sizing:border-box; margin-top:4px; background:rgba(0,0,0,0.25);
            color:inherit; border:1px solid var(--SmartThemeBorderColor,#555); border-radius:4px;
            padding:6px 8px; font-size:14px;">
        </div>
        <div style="margin:10px 0;">
          <label style="font-size:14px;">可见性:</label>
          <select id="stfold-edit-mode"
            style="width:100%; box-sizing:border-box; margin-top:4px; background:rgba(0,0,0,0.25);
            color:inherit; border:1px solid var(--SmartThemeBorderColor,#555); border-radius:4px;
            padding:6px 8px; font-size:14px;">
            <option value="fold" ${pack.mode === 'fold' ? 'selected' : ''}>仅收纳 (用户看不见, AI 仍可见)</option>
            <option value="hide" ${pack.mode === 'hide' ? 'selected' : ''}>收纳 + 隐藏 (用户和 AI 都看不见)</option>
          </select>
          <div style="font-size:11px; opacity:0.55; margin-top:3px;">
            切换后会自动执行 /hide 或 /unhide 命令
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:16px;">
          <button id="stfold-edit-save" style="flex:1; padding:9px; background:var(--SmartThemeQuoteColor,#7aa2f7);
            color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:500;">保存</button>
          <button id="stfold-edit-cancel" style="flex:1; padding:9px; background:rgba(255,255,255,0.08);
            color:inherit; border:1px solid var(--SmartThemeBorderColor,#555); border-radius:6px;
            cursor:pointer; font-size:14px;">取消</button>
        </div>
      </div>
    </div>
  `;

  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html;
  const maskEl = wrapper.firstElementChild;
  doc.body.appendChild(maskEl);

  function closeEdit() { maskEl.remove(); }

  maskEl.addEventListener('click', function (e) { if (e.target === maskEl) closeEdit(); });
  maskEl.querySelector('#stfold-edit-cancel').addEventListener('click', closeEdit);
  maskEl.querySelector('#stfold-edit-save').addEventListener('click', function () {
    const newName = maskEl.querySelector('#stfold-edit-name').value.trim();
    const newNote = maskEl.querySelector('#stfold-edit-note').value.trim();
    const newMode = maskEl.querySelector('#stfold-edit-mode').value;

    if (newName) pack.name = newName;
    pack.note = newNote;

    // 模式变化时执行 hide/unhide
    if (newMode !== pack.mode) {
      if (newMode === 'hide') {
        // 从仅收纳 → 隐藏: 执行 /hide
        executeHideCommand(pack.startMesId, pack.endMesId);
      } else {
        // 从隐藏 → 仅收纳: 执行 /unhide
        executeUnhideCommand(pack.startMesId, pack.endMesId);
      }
      pack.mode = newMode;
    }

    setPacksForChat(packs);
    renderAllPacks();
    if (typeof toastr !== 'undefined') toastr.success('收纳包已更新', 'stfold');
    closeEdit();
    // 局部刷新主弹窗里的列表, 不关主弹窗
    refreshPackList();
  });
}

function closePopup() {
  const doc = getDoc();
  const el = doc.getElementById(POPUP_ID + '_mask');
  if (el) el.remove();
}

// ==================== 启动 ====================
$(() => {
  injectStyle();
  addMenuItem();
  refreshAllMessages();
  renderAllPacks();   // 渲染已有收纳包

  eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, (message_id) => {
    addFoldButton(message_id, true);
  });
  eventOn(tavern_events.USER_MESSAGE_RENDERED, (message_id) => {
    if (settings.foldUserMessages) addFoldButton(message_id, true);
  });
  eventOn(tavern_events.MESSAGE_UPDATED, (message_id) => {
    addFoldButton(message_id);
  });
  eventOn(tavern_events.MESSAGE_SWIPED, (message_id) => {
    setTimeout(() => addFoldButton(message_id), 100);
  });
  eventOn(tavern_events.CHAT_CHANGED, () => {
    setTimeout(() => {
      refreshAllMessages();
      renderAllPacks();
    }, 300);
  });
  eventOn(tavern_events.MORE_MESSAGES_LOADED, () => {
    setTimeout(() => {
      refreshAllMessages();
      renderAllPacks();
    }, 100);
  });

  console.log('[stfold] v4.6 已启动');
  if (typeof toastr !== 'undefined') {
    toastr.success('折叠脚本 v4.6 已启动', 'stfold');
  }
});
