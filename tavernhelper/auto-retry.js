// ==========================================
// 断流自动重发（检测 API 请求内容末尾是否有指定文本，可自定义）
// ==========================================

const STORAGE_KEY = 'auto_regen_settings_single_tail';

const SKIP_TAGS = [
    /<UpdateVariable>/i,
];

const DEFAULTS = {
    maxRegenCount: 3,
    minTokenLength: 50,
    retryDelay: 600,
    requestTimeout: 360000,
    isEnabled: true,
    inputTailPattern: '',
    inputTailEnabled: false,
};

// ==========================================
// 调试控制台 - 日志系统
// ==========================================
const MAX_LOG_ENTRIES = 500;
const debugLog = [];

function log(type, message, data = null) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });

    const entry = { timestamp, type, message, data };
    debugLog.push(entry);

    if (debugLog.length > MAX_LOG_ENTRIES) {
        debugLog.splice(0, debugLog.length - MAX_LOG_ENTRIES);
    }

    const prefix = `[断流重发][${type}]`;
    if (type === 'ERROR') {
        console.error(prefix, message, data ?? '');
    } else if (type === 'WARN') {
        console.warn(prefix, message, data ?? '');
    } else {
        console.log(prefix, message, data ?? '');
    }
}

function getLogTypeColor(type) {
    const colors = {
        'EVENT': '#4fc3f7',
        'STATE': '#81c784',
        'RETRY': '#ffb74d',
        'ERROR': '#e57373',
        'WARN': '#fff176',
        'ACTION': '#ce93d8',
        'INFO': '#90a4ae',
        'REQUEST': '#64b5f6',
    };
    return colors[type] || '#ccc';
}

function formatLogEntry(entry) {
    const color = getLogTypeColor(entry.type);
    const dataStr = entry.data !== null && entry.data !== undefined
        ? `<span style="color:#888;margin-left:8px;">${escapeHtml(typeof entry.data === 'object' ? JSON.stringify(entry.data) : String(entry.data))}</span>`
        : '';

    return `<div style="padding:3px 6px;border-bottom:1px solid #333;font-family:monospace;font-size:12px;line-height:1.6;word-break:break-all;">` +
        `<span style="color:#666;">${entry.timestamp}</span> ` +
        `<span style="color:${color};font-weight:bold;min-width:60px;display:inline-block;">[${entry.type}]</span> ` +
        `<span style="color:#ddd;">${escapeHtml(entry.message)}</span>` +
        dataStr +
        `</div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// 控制台弹窗
// ==========================================
async function openConsole() {
    let currentFilter = 'ALL';

    function renderLogs(filter) {
        const filtered = filter === 'ALL' ? debugLog : debugLog.filter(e => e.type === filter);
        if (filtered.length === 0) {
            return '<div style="text-align:center;color:#666;padding:40px;">暂无日志</div>';
        }
        return filtered.map(formatLogEntry).join('');
    }

    const types = ['ALL', 'EVENT', 'STATE', 'RETRY', 'ACTION', 'REQUEST', 'INFO', 'WARN', 'ERROR'];

    const html = `
    <div style="padding:8px;display:flex;flex-direction:column;height:70vh;">
        <div style="font-size:16px;font-weight:bold;margin-bottom:8px;text-align:center;">
            📋 调试控制台 <span style="font-size:12px;color:#888;">(共 ${debugLog.length} 条)</span>
        </div>
        <div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
            ${types.map(t => `<button class="console-filter-btn" data-filter="${t}" style="
                padding:3px 8px;border:1px solid #555;border-radius:3px;
                background:${t === 'ALL' ? '#555' : '#2a2a2a'};color:${t === 'ALL' ? getLogTypeColor(t) : getLogTypeColor(t)};
                cursor:pointer;font-size:11px;
            ">${t}</button>`).join('')}
            <button id="console_clear_btn" style="
                margin-left:auto;padding:3px 10px;border:1px solid #e57373;border-radius:3px;
                background:#2a2a2a;color:#e57373;cursor:pointer;font-size:11px;
            ">🗑️ 清空</button>
            <button id="console_refresh_btn" style="
                padding:3px 10px;border:1px solid #4fc3f7;border-radius:3px;
                background:#2a2a2a;color:#4fc3f7;cursor:pointer;font-size:11px;
            ">🔄 刷新</button>
        </div>
        <div style="margin-bottom:6px;display:flex;gap:6px;font-size:11px;color:#888;flex-wrap:wrap;">
            <span>状态:
                <span style="color:${state.isEnabled ? '#81c784' : '#e57373'};">${state.isEnabled ? '已启用' : '已禁用'}</span>
            </span>
            <span>|</span>
            <span>重试计数: ${state.regenCount}/${state.maxRegenCount}</span>
            <span>|</span>
            <span>gotToken: ${state.gotToken}</span>
            <span>|</span>
            <span>isRetrying: ${state.isRetrying}</span>
            <span>|</span>
            <span>isDryRun: ${state.isDryRun}</span>
            <span>|</span>
            <span>forceStop: ${state.forceStopFlag}</span>
            <span>|</span>
            <span>apiTailActive: ${state.apiTailActive}</span>
            <span>|</span>
            <span>isSwipe: ${state.isSwipeGeneration}</span>
        </div>
        <div style="margin-bottom:6px;display:flex;gap:6px;font-size:11px;color:#888;flex-wrap:wrap;">
            <span>tail检测: ${state.inputTailEnabled ? '开启' : '关闭'}</span>
            <span>|</span>
            <span>source: ${escapeHtml(state.lastRequestSource || '(无)')}</span>
            <span>|</span>
            <span>genType: ${escapeHtml(state.currentGenerationType || '(无)')}</span>
        </div>
        <div style="margin-bottom:6px;font-size:11px;color:#888;word-break:break-all;max-height:70px;overflow:auto;border:1px solid #333;padding:6px;border-radius:4px;background:#151515;">
            <div style="color:#aaa;margin-bottom:4px;">最近一次 API 请求内容末尾预览：</div>
            <div>${escapeHtml((state.lastRequestText || '').slice(-500) || '(空)')}</div>
        </div>
        <div id="console_log_container" style="
            flex:1;overflow-y:auto;background:#1a1a1a;border:1px solid #444;border-radius:4px;
        ">${renderLogs('ALL')}</div>
    </div>`;

    const popup = new SillyTavern.Popup(
        html,
        SillyTavern.POPUP_TYPE.TEXT,
        '',
        {
            wide: true,
            large: true,
            okButton: '关闭',
            onOpen: async (popup) => {
                const dlg = popup.dlg;
                const container = dlg.querySelector('#console_log_container');

                if (container) {
                    container.scrollTop = container.scrollHeight;
                }

                dlg.querySelectorAll('.console-filter-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        currentFilter = btn.dataset.filter;
                        dlg.querySelectorAll('.console-filter-btn').forEach(b => {
                            b.style.background = b.dataset.filter === currentFilter ? '#555' : '#2a2a2a';
                        });
                        if (container) {
                            container.innerHTML = renderLogs(currentFilter);
                            container.scrollTop = container.scrollHeight;
                        }
                    });
                });

                const clearBtn = dlg.querySelector('#console_clear_btn');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        debugLog.length = 0;
                        if (container) {
                            container.innerHTML = renderLogs(currentFilter);
                        }
                        log('INFO', '日志已清空');
                    });
                }

                const refreshBtn = dlg.querySelector('#console_refresh_btn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        if (container) {
                            container.innerHTML = renderLogs(currentFilter);
                            container.scrollTop = container.scrollHeight;
                        }
                    });
                }
            },
        }
    );
    await popup.show();
}

// ==========================================
// 配置读写
// ==========================================
function loadSettings() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const result = saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };

        if (typeof result.inputTailPattern !== 'string') {
            result.inputTailPattern = '';
        }

        log('INFO', '设置已加载', result);
        return result;
    } catch (e) {
        log('ERROR', '读取设置失败', e.message);
        return { ...DEFAULTS };
    }
}

function saveSettings() {
    try {
        const data = {
            maxRegenCount: state.maxRegenCount,
            minTokenLength: state.minTokenLength,
            retryDelay: state.retryDelay,
            requestTimeout: state.requestTimeout,
            isEnabled: state.isEnabled,
            inputTailPattern: state.inputTailPattern,
            inputTailEnabled: state.inputTailEnabled,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        log('INFO', '设置已保存', data);
    } catch (e) {
        log('ERROR', '保存设置失败', e.message);
    }
}

// ==========================================
// API 请求文本捕获
// ==========================================
function promptPartToText(part) {
    if (part === null || part === undefined) return '';

    if (typeof part === 'string') {
        return part;
    }

    if (Array.isArray(part)) {
        return part.map(item => {
            if (!item) return '';
            if (typeof item === 'string') return item;
            if (item.type === 'text') return item.text || '';
            if (item.type === 'image_url') return '[image]';
            if (item.type === 'video_url') return '[video]';
            return '';
        }).join('');
    }

    if (typeof part === 'object') {
        if ('content' in part) {
            return promptPartToText(part.content);
        }
        return JSON.stringify(part);
    }

    return String(part);
}

function captureRequestText(text, source) {
    state.lastRequestText = String(text ?? '');
    state.lastRequestSource = source || '';
    log('REQUEST', `捕获 API 请求内容 (${source})`, {
        length: state.lastRequestText.length,
        tail: state.lastRequestText.slice(-200)
    });
}

function normalizeLooseTailText(text) {
    return String(text ?? '')
        .replace(/[\s\u3000]+/g, '')
        .trim();
}

function checkApiRequestTail() {
    if (!state.inputTailEnabled || !state.inputTailPattern) {
        return true;
    }

    const normalizedRequest = normalizeLooseTailText(state.lastRequestText);
    const normalizedPattern = normalizeLooseTailText(state.inputTailPattern);

    if (!normalizedPattern) {
        return true;
    }

    if (normalizedRequest.endsWith(normalizedPattern)) {
        log('INFO', 'API 请求末尾匹配通过', {
            pattern: state.inputTailPattern,
            source: state.lastRequestSource,
            requestTail: normalizedRequest.slice(-Math.max(60, normalizedPattern.length))
        });
        state.apiTailActive = true;
        return true;
    }

    log('INFO', 'API 请求末尾不匹配，脚本本次不生效', {
        pattern: state.inputTailPattern,
        source: state.lastRequestSource,
        requestTail: normalizedRequest.slice(-120)
    });
    state.apiTailActive = false;
    return false;
}

// ==========================================
// swipe 检测
// ==========================================
function isSwipeContext() {
    return state.isSwipeGeneration
        || state.currentGenerationType === 'swipe'
        || state.lastMessageType === 'swipe';
}

// ==========================================
// 状态管理
// ==========================================
const saved = loadSettings();

const state = {
    maxRegenCount: saved.maxRegenCount,
    minTokenLength: saved.minTokenLength,
    retryDelay: saved.retryDelay,
    requestTimeout: saved.requestTimeout,
    isEnabled: saved.isEnabled,

    inputTailPattern: saved.inputTailPattern,
    inputTailEnabled: saved.inputTailEnabled,
    apiTailActive: false,

    lastRequestText: '',
    lastRequestSource: '',

    regenCount: 0,
    gotToken: false,
    isRetrying: false,
    isDryRun: false,
    forceStopFlag: false,
    abortController: null,
    timeoutTimer: null,

    currentGenerationType: '',
    lastMessageType: '',
    isSwipeGeneration: false,

    resetRuntime() {
        log('STATE', '运行时状态重置', {
            regenCount: this.regenCount,
            gotToken: this.gotToken,
            isRetrying: this.isRetrying,
        });
        this.regenCount = 0;
        this.gotToken = false;
        this.isRetrying = false;
        this.isDryRun = false;
        this.forceStopFlag = false;
        this.apiTailActive = false;
        this.lastRequestText = '';
        this.lastRequestSource = '';
        this.currentGenerationType = '';
        this.lastMessageType = '';
        this.isSwipeGeneration = false;
        this.clearTimeoutRetryTimer();
        this.cancelPending();
    },

    cancelPending() {
        if (this.abortController) {
            log('STATE', 'AbortController 已取消');
            this.abortController.abort();
            this.abortController = null;
        }
    },

    clearTimeoutRetryTimer() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
            log('STATE', '超时计时器已清除');
        }
    },

    startTimeoutRetryTimer() {
        this.clearTimeoutRetryTimer();

        if (!this.isEnabled || this.requestTimeout <= 0 || this.isDryRun || this.forceStopFlag) {
            return;
        }

        if (this.isSwipeGeneration) {
            log('INFO', '当前是 swipe，不启动超时计时器');
            return;
        }

        log('STATE', '启动超时计时器', { requestTimeout: this.requestTimeout });

        this.timeoutTimer = setTimeout(async () => {
            this.timeoutTimer = null;

            if (!this.isEnabled || this.forceStopFlag || this.isRetrying || this.isDryRun) {
                log('INFO', '超时重试跳过', {
                    isEnabled: this.isEnabled,
                    forceStopFlag: this.forceStopFlag,
                    isRetrying: this.isRetrying,
                    isDryRun: this.isDryRun,
                });
                return;
            }

            if (isSwipeContext()) {
                log('INFO', '超时触发时检测到 swipe，跳过');
                return;
            }

            if (!builtin.duringGenerating()) {
                log('INFO', '超时触发时已不在生成中');
                return;
            }

            if (!checkApiRequestTail()) {
                log('INFO', '超时触发时 API 请求末尾不匹配，跳过');
                return;
            }

            log('WARN', `生成超时 ${this.requestTimeout}ms，触发重试`);

            try {
                let stopped = false;

                if (typeof SillyTavern.stopGeneration === 'function') {
                    stopped = SillyTavern.stopGeneration();
                    log('ACTION', `超时停止生成 => ${stopped}`);
                }

                if (!stopped) {
                    try {
                        if (typeof stopAllGeneration === 'function') {
                            stopped = stopAllGeneration();
                            log('ACTION', `超时 stopAllGeneration() => ${stopped}`);
                        }
                    } catch (e) {
                        log('WARN', '超时 stopAllGeneration 失败', e.message);
                    }
                }
            } catch (e) {
                log('WARN', '超时停止生成失败', e.message);
            }

            await performRetry(`生成超时 (${Math.round(this.requestTimeout / 1000)}秒)`);
        }, this.requestTimeout);
    },

    newAbortSignal() {
        this.cancelPending();
        this.abortController = new AbortController();
        log('STATE', '新建 AbortController');
        return this.abortController.signal;
    },
};

// ==========================================
// 可中断的延迟
// ==========================================
function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
        }
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        }
    });
}

function simpleDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// 安全重生成
// ==========================================
async function safeRegenerate() {
    log('ACTION', '尝试执行 SillyTavern.generate("regenerate")');
    try {
        if (typeof SillyTavern.generate === 'function') {
            SillyTavern.generate('regenerate');
            log('ACTION', '重roll 调用成功');
            return true;
        }
    } catch (e) {
        log('ERROR', 'SillyTavern.generate("regenerate") 失败', e.message);
    }

    toastr.error('重roll失败，请手动重试', '断流自动重发');
    return false;
}

// ==========================================
// 统一重试逻辑
// ==========================================
async function performRetry(reason) {
    if (state.forceStopFlag) {
        log('RETRY', '重试被跳过 (forceStopFlag=true)', reason);
        return;
    }

    if (isSwipeContext()) {
        log('INFO', '当前是 swipe/另外回复，跳过自动重试，避免覆盖原回复', {
            reason,
            currentGenerationType: state.currentGenerationType,
            lastMessageType: state.lastMessageType,
            isSwipeGeneration: state.isSwipeGeneration,
        });
        return;
    }

    if (state.regenCount >= state.maxRegenCount) {
        log('WARN', `连续失败 ${state.maxRegenCount} 次，停止重试`, reason);
        toastr.error(
            `⚠️ 连续失败 ${state.maxRegenCount} 次，已停止重试`,
            '断流自动重发'
        );
        state.regenCount = 0;
        return;
    }

    state.regenCount++;
    state.isRetrying = true;

    const signal = state.newAbortSignal();

    log('RETRY', `开始重试 ${state.regenCount}/${state.maxRegenCount}`, {
        reason,
        delay: state.retryDelay
    });

    toastr.warning(
        `🔄 ${reason}，重roll ${state.regenCount}/${state.maxRegenCount}`,
        '断流自动重发'
    );

    try {
        await delay(state.retryDelay, signal);

        if (signal.aborted || state.forceStopFlag) {
            log('RETRY', '延迟后检查：已被中断');
            return;
        }

        const success = await safeRegenerate();
        if (!success) {
            log('RETRY', '重roll 调用失败，停止重试');
            state.isRetrying = false;
            return;
        }

        try {
            await delay(5000, signal);
        } catch (_) {
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            log('RETRY', '重试被 AbortError 中断');
            return;
        }
        log('ERROR', '重试过程异常', e.message);
    } finally {
        state.isRetrying = false;
    }
}

// ==========================================
// 强制停止
// ==========================================
async function forceStop() {
    log('ACTION', '执行强制停止');

    state.forceStopFlag = true;
    state.cancelPending();
    state.clearTimeoutRetryTimer();
    state.isRetrying = false;
    state.regenCount = 0;
    state.gotToken = true;

    let stopped = false;

    try {
        if (typeof SillyTavern.stopGeneration === 'function') {
            stopped = SillyTavern.stopGeneration();
            log('ACTION', `SillyTavern.stopGeneration() => ${stopped}`);
        }
    } catch (e) {
        log('WARN', 'SillyTavern.stopGeneration 失败', e.message);
    }

    if (!stopped) {
        try {
            if (typeof stopAllGeneration === 'function') {
                stopped = stopAllGeneration();
                log('ACTION', `stopAllGeneration() => ${stopped}`);
            }
        } catch (e) {
            log('WARN', 'stopAllGeneration 失败', e.message);
        }
    }

    toastr.info('🛑 已强制停止所有重试和生成', '断流自动重发');

    await simpleDelay(1000);
    state.forceStopFlag = false;
    log('STATE', 'forceStopFlag 已重置为 false');
}

// ==========================================
// 切换开关
// ==========================================
function toggle() {
    state.isEnabled = !state.isEnabled;
    state.regenCount = 0;
    saveSettings();

    log('ACTION', `开关切换 => ${state.isEnabled ? '开启' : '关闭'}`);

    if (state.isEnabled) {
        toastr.success(
            `✅ 已开启\n重试: ${state.maxRegenCount}次 | 最短: ${state.minTokenLength}字 | 延迟: ${state.retryDelay}ms | 超时: ${state.requestTimeout}ms`,
            '断流自动重发'
        );
    } else {
        state.cancelPending();
        state.clearTimeoutRetryTimer();
        state.isRetrying = false;
        state.regenCount = 0;
        toastr.info('❌ 已关闭', '断流自动重发');
    }
}

// ==========================================
// 设置弹窗
// ==========================================
async function openSettings() {
    let capturedMaxRegen = state.maxRegenCount;
    let capturedMinLength = state.minTokenLength;
    let capturedRetryDelay = state.retryDelay;
    let capturedRequestTimeout = state.requestTimeout;
    let capturedInputTailPattern = state.inputTailPattern;
    let capturedInputTailEnabled = state.inputTailEnabled;

    const html = `
    <div style="padding:16px;">
        <div style="font-size:16px;font-weight:bold;margin-bottom:16px;text-align:center;">
            ⚙️ 断流自动重发设置
        </div>
        <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;margin-bottom:6px;">🔢 最大重试次数</label>
            <input type="number" id="setting_max_regen" value="${state.maxRegenCount}" min="1"
                style="width:100%;padding:8px;border:1px solid #555;border-radius:4px;background:#333;color:#fff;">
            <div style="font-size:12px;color:#888;margin-top:4px;">连续失败超过此次数将停止重试</div>
        </div>
        <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;margin-bottom:6px;">📏 最小回复长度（字符）</label>
            <input type="number" id="setting_min_length" value="${state.minTokenLength}" min="0"
                style="width:100%;padding:8px;border:1px solid #555;border-radius:4px;background:#333;color:#fff;">
            <div style="font-size:12px;color:#888;margin-top:4px;">回复低于此长度自动重试，设为0禁用此功能</div>
        </div>
        <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;margin-bottom:6px;">⏱️ 重试延迟（毫秒）</label>
            <input type="number" id="setting_retry_delay" value="${state.retryDelay}" min="0" step="100"
                style="width:100%;padding:8px;border:1px solid #555;border-radius:4px;background:#333;color:#fff;">
            <div style="font-size:12px;color:#888;margin-top:4px;">触发重试前的等待时间（1000ms = 1秒）</div>
        </div>
        <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;margin-bottom:6px;">⏳ 超时自动重试（毫秒）</label>
            <input type="number" id="setting_request_timeout" value="${state.requestTimeout}" min="0" step="1000"
                style="width:100%;padding:8px;border:1px solid #555;border-radius:4px;background:#333;color:#fff;">
            <div style="font-size:12px;color:#888;margin-top:4px;">默认 360000（6分钟），设为0禁用此功能</div>
        </div>

        <div style="border-top:1px solid #444;padding-top:16px;margin-top:8px;">
            <div style="display:flex;align-items:center;margin-bottom:10px;">
                <label style="font-size:14px;flex:1;">🔍 API 请求末尾检测</label>
                <label style="display:flex;align-items:center;cursor:pointer;gap:6px;font-size:13px;">
                    <input type="checkbox" id="setting_input_tail_enabled" ${state.inputTailEnabled ? 'checked' : ''}
                        style="width:16px;height:16px;cursor:pointer;">
                    启用
                </label>
            </div>
            <textarea id="setting_input_tail_pattern" rows="4" placeholder="输入要检测的唯一文本"
                style="width:100%;padding:8px;border:1px solid #555;border-radius:4px;background:#333;color:#fff;
                font-family:monospace;font-size:13px;resize:vertical;overflow:auto;">${escapeHtml(state.inputTailPattern)}</textarea>
            <div style="font-size:12px;color:#888;margin-top:6px;">
                只检测这一个文本。<br>
                检测的不是用户输入，而是 API 请求内容末尾。<br>
                检测格式不需要严格匹配，但字一定要一样。
            </div>
        </div>
    </div>`;

    const result = await SillyTavern.callGenericPopup(
        html,
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: '保存',
            cancelButton: '取消',
            wide: false,
            onClosing: async () => {
                capturedMaxRegen = parseInt($('#setting_max_regen').val(), 10);
                capturedMinLength = parseInt($('#setting_min_length').val(), 10);
                capturedRetryDelay = parseInt($('#setting_retry_delay').val(), 10);
                capturedRequestTimeout = parseInt($('#setting_request_timeout').val(), 10);
                capturedInputTailPattern = ($('#setting_input_tail_pattern').val() ?? '').toString();
                capturedInputTailEnabled = $('#setting_input_tail_enabled').is(':checked');
                return true;
            },
        }
    );

    if (result !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;

    const validMax = !isNaN(capturedMaxRegen) && capturedMaxRegen >= 1;
    const validMin = !isNaN(capturedMinLength) && capturedMinLength >= 0;
    const validDelay =  !isNaN(capturedRetryDelay) && capturedRetryDelay >= 0;
    const validTimeout = !isNaN(capturedRequestTimeout) && capturedRequestTimeout >= 0;

    if (!validMax && !validMin && !validDelay && !validTimeout) {
        toastr.error('请输入有效的数值', '保存失败');
        return;
    }

    if (validMax) state.maxRegenCount = capturedMaxRegen;
    if (validMin) state.minTokenLength = capturedMinLength;
    if (validDelay) state.retryDelay = capturedRetryDelay;
    if (validTimeout) state.requestTimeout = capturedRequestTimeout;

    state.inputTailEnabled = capturedInputTailEnabled;
    state.inputTailPattern = capturedInputTailPattern.trim();

    state.regenCount = 0;
    saveSettings();

    const tailStatus = state.inputTailEnabled
        ? 'API末尾检测: 已开启'
        : 'API末尾检测: 关闭';

    toastr.success(
        `✅ 重试: ${state.maxRegenCount}次 | 最短: ${state.minTokenLength}字 | 延迟: ${state.retryDelay}ms | 超时: ${state.requestTimeout}ms\n${tailStatus}`,
        '设置已保存'
    );
}

// ==========================================
// 解析楼层输入
// ==========================================
function parseFloorInput(input, lastMsgId) {
    const floors = new Set();
    const parts = input.split(',').map(p => p.trim()).filter(Boolean);

    for (const part of parts) {
        const rangeMatch = part.match(/^(-?\d+)\s*[-~.]{1,2}\s*(-?\d+)$/);
        if (rangeMatch) {
            let start = parseInt(rangeMatch[1], 10);
            let end = parseInt(rangeMatch[2], 10);
            if (start < 0) start = lastMsgId + 1 + start;
            if (end < 0) end = lastMsgId + 1 + end;
            const actualStart = Math.max(0, Math.min(start, end));
            const actualEnd = Math.min(lastMsgId, Math.max(start, end));
            for (let i = actualStart; i <= actualEnd; i++) {
                floors.add(i);
            }
            continue;
        }

        let num = parseInt(part, 10);
        if (isNaN(num)) continue;
        if (num < 0) num = lastMsgId + 1 + num;
        if (num >= 0 && num <= lastMsgId) {
            floors.add(num);
        }
    }

    return Array.from(floors);
}

// ==========================================
// 删除指定楼层
// ==========================================
async function deleteFloor() {
    const lastMsgId = getLastMessageId();
    let capturedInput = '';

    const html = `
    <div style="padding:16px;">
        <div style="font-size:16px;font-weight:bold;margin-bottom:12px;text-align:center;">
            🗑️ 删除指定楼层
        </div>
        <div style="font-size:13px;color:#aaa;margin-bottom:12px;text-align:center;">
            当前聊天共 ${lastMsgId + 1} 条消息（楼层 0 ~ ${lastMsgId}）
        </div>
        <div style="margin-bottom:8px;">
            <label style="display:block;font-size:14px;margin-bottom:6px;">输入要删除的楼层号</label>
            <input type="text" id="delete_floor_input" placeholder="例如: 5 或 3,5,7 或 2-5"
                style="width:100%;padding:8px;border:1px solid #555;border-radius:4px;background:#333;color:#fff;">
            <div style="font-size:12px;color:#888;margin-top:6px;">
                支持格式：<br>
                • 单个楼层：<code>5</code><br>
                • 多个楼层：<code>3,5,7</code><br>
                • 范围：<code>2-5</code>（删除2到5楼）<br>
                • 负数表示倒数：<code>-1</code>（最后一楼）
            </div>
        </div>
    </div>`;

    const result = await SillyTavern.callGenericPopup(
        html,
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: '删除',
            cancelButton: '取消',
            wide: false,
            onClosing: async () => {
                capturedInput = $('#delete_floor_input').val()?.trim() || '';
                return true;
            },
        }
    );

    if (result !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;

    if (!capturedInput) {
        toastr.error('请输入楼层号', '无效输入');
        return;
    }

    try {
        const floorsToDelete = parseFloorInput(capturedInput, lastMsgId);

        if (floorsToDelete.length === 0) {
            toastr.error('未找到有效的楼层号', '无效输入');
            return;
        }

        const sorted = floorsToDelete.sort((a, b) => a - b);

        const confirmResult = await SillyTavern.callGenericPopup(
            `<div style="text-align:center;padding:12px;">
                <div style="font-size:15px;margin-bottom:8px;">确定要删除以下楼层吗？</div>
                <div style="font-size:14px;color:#ff6b6b;font-weight:bold;">
                    楼层: ${sorted.join(', ')}
                </div>
                <div style="font-size:12px;color:#888;margin-top:8px;">此操作不可撤销！</div>
            </div>`,
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: '确定删除',
                cancelButton: '取消',
            }
        );

        if (confirmResult === SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
            log('ACTION', `删除楼层: ${sorted.join(', ')}`);
            await deleteChatMessages(floorsToDelete);
            toastr.success(`✅ 已删除 ${floorsToDelete.length} 条消息`, '删除成功');
        }
    } catch (e) {
        toastr.error(e.message || '解析楼层号失败', '错误');
        log('ERROR', '删除楼层失败', e.message);
    }
}

// ==========================================
// 请求内容监听
// ==========================================
eventOn(tavern_events.GENERATE_AFTER_COMBINE_PROMPTS, (result) => {
    try {
        if (result && typeof result.prompt === 'string') {
            captureRequestText(result.prompt, 'GENERATE_AFTER_COMBINE_PROMPTS');
        }
    } catch (e) {
        log('ERROR', '捕获合并提示词失败', e.message);
    }
});

eventOn(tavern_events.GENERATE_AFTER_DATA, (generate_data, dry_run) => {
    try {
        if (!generate_data) return;

        if (Array.isArray(generate_data.prompt)) {
            const text = generate_data.prompt.map(msg => {
                if (!msg) return '';
                const role = msg.role ? `[${msg.role}] ` : '';
                return role + promptPartToText(msg.content);
            }).join('\n');
            captureRequestText(text, `GENERATE_AFTER_DATA${dry_run ? ':dry_run' : ''}`);
            return;
        }

        if (typeof generate_data.prompt === 'string') {
            captureRequestText(generate_data.prompt, `GENERATE_AFTER_DATA${dry_run ? ':dry_run' : ''}`);
        }
    } catch (e) {
        log('ERROR', '捕获请求数据失败', e.message);
    }
});

// ==========================================
// 核心事件监听
// ==========================================
eventOn(tavern_events.CHAT_CHANGED, (chat_file_name) => {
    log('EVENT', `CHAT_CHANGED => ${chat_file_name}`);
    state.resetRuntime();
});

eventOn(tavern_events.GENERATION_STARTED, (_type, _option, dry_run) => {
    log('EVENT', `GENERATION_STARTED`, { type: _type, dry_run: !!dry_run });
    state.gotToken = false;
    state.isDryRun = !!dry_run;

    state.currentGenerationType = _type || '';
    state.isSwipeGeneration = _type === 'swipe';

    if (state.isSwipeGeneration) {
        log('INFO', '检测到 swipe 生成，本轮将跳过自动重试');
    }

    if (state.isRetrying) {
        log('STATE', 'isRetrying 被解锁 (GENERATION_STARTED)');
        state.isRetrying = false;
    }

    state.startTimeoutRetryTimer();
});

eventOn(tavern_events.STREAM_TOKEN_RECEIVED, () => {
    if (!state.gotToken) {
        log('EVENT', 'STREAM_TOKEN_RECEIVED (首次收到 token)');
    }
    state.gotToken = true;
});

eventOn(tavern_events.MESSAGE_RECEIVED, (message_id, type) => {
    log('EVENT', `MESSAGE_RECEIVED`, { message_id, type });

    state.lastMessageType = type || '';
    state.clearTimeoutRetryTimer();
    state.gotToken = true;

    if (type === 'first_message' && message_id === 0) {
        log('INFO', '首条消息，重置重试计数');
        state.regenCount = 0;
        return;
    }

    if (type === 'swipe') {
        log('INFO', 'MESSAGE_RECEIVED 类型为 swipe，跳过检查');
        state.regenCount = 0;
        return;
    }

    if (!state.isEnabled || state.forceStopFlag || state.isRetrying) {
        log('INFO', 'MESSAGE_RECEIVED 跳过检查', {
            isEnabled: state.isEnabled,
            forceStopFlag: state.forceStopFlag,
            isRetrying: state.isRetrying,
        });
        return;
    }

    if (isSwipeContext()) {
        log('INFO', 'MESSAGE_RECEIVED 检测到 swipe 上下文，跳过检查');
        state.regenCount = 0;
        return;
    }

    if (!checkApiRequestTail()) {
        log('INFO', 'API 请求末尾不匹配，脚本本次跳过');
        state.regenCount = 0;
        return;
    }

    const messages = getChatMessages(message_id);
    if (messages.length === 0 || messages[0].role !== 'assistant') {
        log('INFO', '非 assistant 消息，重置重试计数');
        state.regenCount = 0;
        return;
    }

    const replyText = messages[0].message.trim();

    if (SKIP_TAGS.some(tag => tag.test(replyText))) {
        log('INFO', '匹配 SKIP_TAGS，跳过检查');
        state.regenCount = 0;
        return;
    }

    if (state.minTokenLength > 0 && replyText.length < state.minTokenLength) {
        log('WARN', `回复过短: ${replyText.length}/${state.minTokenLength} 字符`, replyText.substring(0, 100));
        performRetry(`回复过短 (${replyText.length}/${state.minTokenLength})`);
        return;
    }

    log('INFO', `回复长度正常: ${replyText.length} 字符，重置重试计数`);
    state.regenCount = 0;
});

eventOn(tavern_events.GENERATION_ENDED, async (_message_id) => {
    state.clearTimeoutRetryTimer();

    log('EVENT', `GENERATION_ENDED`, {
        message_id: _message_id,
        isEnabled: state.isEnabled,
        gotToken: state.gotToken,
        isRetrying: state.isRetrying,
        isDryRun: state.isDryRun,
        forceStopFlag: state.forceStopFlag,
        duringGenerating: builtin.duringGenerating(),
        isSwipe: state.isSwipeGeneration,
        currentGenerationType: state.currentGenerationType,
    });

    if (!state.isEnabled || state.gotToken || state.isRetrying || state.isDryRun || state.forceStopFlag) {
        log('INFO', 'GENERATION_ENDED 跳过 (条件不满足)');
        return;
    }

    if (isSwipeContext()) {
        log('INFO', 'GENERATION_ENDED 检测到 swipe，跳过自动重试');
        return;
    }

    if (builtin.duringGenerating()) {
        log('INFO', 'GENERATION_ENDED 跳过 (仍在生成中)');
        return;
    }

    if (!checkApiRequestTail()) {
        log('INFO', 'GENERATION_ENDED 跳过 (API 请求末尾不匹配)');
        return;
    }

    log('INFO', '等待 300ms 确认 MESSAGE_RECEIVED 是否触发...');
    await simpleDelay(300);

    if (state.gotToken || state.isRetrying || state.forceStopFlag) {
        log('INFO', '等待后检查：已收到 token 或正在重试');
        return;
    }

    if (isSwipeContext()) {
        log('INFO', '等待后检查：检测到 swipe，跳过');
        return;
    }

    log('WARN', '未收到任何回复 token，触发重试');
    await performRetry('未收到回复');
});

eventOn(tavern_events.GENERATION_STOPPED, () => {
    log('EVENT', 'GENERATION_STOPPED (用户手动停止)');
    state.clearTimeoutRetryTimer();
    state.gotToken = true;
});

// ==========================================
// 按钮注册
// ==========================================
replaceScriptButtons([
    { name: '🔄 开关', visible: true },
    { name: '⚙️ 设置', visible: true },
    { name: '🛑 强制停止', visible: true },
    { name: '🗑️ 删除楼层', visible: true },
    { name: '📋 控制台', visible: true },
]);

eventOn(getButtonEvent('🔄 开关'), toggle);
eventOn(getButtonEvent('⚙️ 设置'), openSettings);
eventOn(getButtonEvent('🛑 强制停止'), forceStop);
eventOn(getButtonEvent('🗑️ 删除楼层'), deleteFloor);
eventOn(getButtonEvent('📋 控制台'), openConsole);

// ==========================================
// 启动日志
// ==========================================
log('INFO', '脚本已加载', {
    isEnabled: state.isEnabled,
    maxRegenCount: state.maxRegenCount,
    minTokenLength: state.minTokenLength,
    retryDelay: state.retryDelay,
    requestTimeout: state.requestTimeout,
    inputTailEnabled: state.inputTailEnabled,
});
