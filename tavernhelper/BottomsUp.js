/**
 * ============================================================================
 * 插件名称: 🍺自动续杯BottomsUp
 * 寓意概念: 就像酒馆里不知疲倦的自动续杯啤酒机 —— 出错自动重倒，断流自动续满！
 * 适用平台: SillyTavern (ST) & TauriTavern (TT) [PC / 手机端完美自适应]
 * 运行环境: 酒馆助手 (JS-Slash-Runner / Tavern-Helper)
 * 版本: v2.6.7 Debug (Synthetic Tool Anti-Truncation Edition)
 * ============================================================================
 */

(function () {
  'use strict';

  const SCRIPT_NAME = '🍺自动续杯BottomsUp';
  const STORAGE_KEY = 'tavern_helper_bottom_up_settings';

  // 统一默认配置
  const DEFAULT_SETTINGS = {
    // === 模块 1: 错误自动重试 (Auto-Retry) ===
    retryEnabled: true,
    retryMax: 9,                    // 最多重试次数（默认 9 次）
    retryDelayMs: 1500,             // 重试前延迟 (ms)
    retryMinChars: 1,               // 最短有效字数
    requestTimeoutMs: 180000,       // 生成超时时间 (ms，默认 3 分钟，0 为禁用)
    cleanTtErrorMessage: true,      // 启用 TauriTavern 兼容
    retryOnApology: true,           // 启用道歉拒绝重刷 (三段式智能拦截)
    skipUpdateVariableTag: true,    // 启用 MVU 变量更新兼容
    stripHtml: true,                // 启用 HTML 前端兼容
    retryShowToast: true,           // 启用 Toast 弹窗通知
    customErrorKeywords: '',        // 自定义报错特征

    // === 模块 2: 截断自动续写 (Auto-Continue) ===
    continueEnabled: true,          // 启用截断自动续写
    prioritizeContinueOnContent: true, // 启用存在正文时优先续写 (>=5字)
    prioritizeContinueAfterStarted: true, // 兼容旧版键名
    mvuStatusInjectionCompat: true, // 启用 MVU 状态栏注入兼容 (续写前剥除尾部占位符)
    continueMax: 5,                 // 最多连续续写次数
    continueDelayMs: 800,           // 续写前延迟 (ms)
    continueMinChars: 8,            // 最短触发字数
    continueMinIncomp: 30,          // 启发式最短触发字数
    continueOnLength: true,         // 启用最大字数截断续写
    continueOnFilter: true,         // 启用安全审核拦截续写
    continueOnIncomplete: true,     // 启用启发式未收束续写
    continueOnCustomEnder: false,   // 启用未检测到自定义结束标识自动续写
    syntheticToolEnabled: false,    // 启用合成工具抗外审截断 (emit_answer)
    syntheticToolTtStreamSim: false,// 启用 TauriTavern 工具流式模拟
    continueShowToast: true,        // 启用 Toast 弹窗通知
    checkQuotes: true,              // 检查成对引号闭合
    checkBrackets: true,            // 检查成对括号闭合
    checkTags: true,                // 检查 XML/HTML 闭标签
    checkMarkdown: true,            // 检查代码块闭合
    checkPunctuation: true,         // 检查句末标点收束
    customEndMarkers: '',           // 自定义结束标识

    // 通用缓冲
    unlockSettleMs: 150,
  };

  const runtime = {
    settings: { ...DEFAULT_SETTINGS },
    consecutiveRetries: 0,
    isRetryInFlight: false,
    gotStreamToken: false,
    hasToastErrorDuringGen: false,
    lastToastErrorMessage: '',
    generationStartedAt: 0,
    timeoutTimer: null,
    consecutiveContinues: 0,
    isContinueInFlight: false,
    lastGenerationMeta: null,
    pendingAction: null,
    userStopped: false,
    hookInstalled: false,
    listenersBound: false,
    logs: [],                       // 运行时日志缓冲区 (保存诊断记录)
  };

  function appendLog(level, text) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const logItem = `[${timeStr}] [${level.toUpperCase()}] ${text}`;
    runtime.logs.push(logItem);
    if (runtime.logs.length > 120) runtime.logs.shift();
    if (typeof console[level] === 'function') console[level](`[${SCRIPT_NAME}]`, text);
    else console.log(`[${SCRIPT_NAME}]`, text);
  }

  const BUILTIN_ERROR_PATTERNS = [
    /^\s*\{\s*"(?:error|err|message|detail|code)"\s*:/i,
    /\{\s*"error"\s*:\s*\{/i,
    /\{\s*"message"\s*:\s*"(?:Rate limit|Invalid|Unauthorized|Quota|Overloaded|Internal)/i,
    /^(?:\[(?:API\s*(?:错误|Error)|错误|Error|HTTP Error|Proxy Error|Request Error|System Error|Network Error|FetchError|TypeError|OpenAI Error|Claude Error)[^\]]*\]|【(?:API\s*错误|系统错误|网络错误|请求错误)[^】]*】)\s*/i,
    /^(?:Got response status|Failed to fetch|Network error|Request failed)\s*[:\d]/i,
    /(?:HTTP\s+(?:400|401|403|404|408|429|500|502|503|504)|status\s*(?:code)?\s*[:=]\s*(?:400|401|403|404|408|429|500|502|503|504))/i,
    /(?:Rate\s*limit\s*reached|Too\s*many\s*requests|Resource\s*(?:has\s*been)?\s*exhausted|Quota\s*exceeded|insufficient_quota|free_tier_usage_limit)/i,
    /(?:Invalid\s*API\s*key|Incorrect\s*API\s*key|Authentication\s*failed|401\s*Unauthorized|403\s*Forbidden|Permission\s*denied\s*for\s*model)/i,
    /(?:Server\s*(?:is\s*)?(?:currently\s*)?overloaded|502\s*Bad\s*Gateway|504\s*Gateway\s*Timeout|Cloudflare\s+error|520\s+Web\s+Server\s+Returned|521\s+Web\s+Server\s+Is\s+Down|522\s+Connection\s+Timed\s+Out|524\s+A\s+Timeout\s+Occurred)/i,
    /(?:Context\s*length\s*exceeded|maximum\s*context\s*length|Token\s*budget\s*exceeded|prompt\s*is\s*too\s*long)/i,
    /(?:Claude\s*refused\s*the\s*response|model\.provider_refusal|Output\s*blocked\s*by\s*safety\s*filters)/i,
    /(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|Failed\s+to\s+fetch\s+from\s+endpoint|Connection\s*(?:aborted|reset|refused)\s*by\s*peer)/i,
  ];

  function loadSettings() {
    try {
      if (typeof getVariables === 'function') {
        const saved = getVariables({ type: 'script' });
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          runtime.settings = { ...DEFAULT_SETTINGS, ...saved };
          if (saved.prioritizeContinueAfterStarted !== undefined && saved.prioritizeContinueOnContent === undefined) {
            runtime.settings.prioritizeContinueOnContent = !!saved.prioritizeContinueAfterStarted;
          }
          return;
        }
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        runtime.settings = { ...DEFAULT_SETTINGS, ...parsed };
        if (parsed.prioritizeContinueAfterStarted !== undefined && parsed.prioritizeContinueOnContent === undefined) {
          runtime.settings.prioritizeContinueOnContent = !!parsed.prioritizeContinueAfterStarted;
        }
      }
    } catch (e) {}
  }

  function saveSettings(newSettings) {
    runtime.settings = { ...runtime.settings, ...newSettings };
    try {
      if (typeof replaceVariables === 'function') replaceVariables(runtime.settings, { type: 'script' });
    } catch (e) {}
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.settings));
    } catch (e) {}
  }

  function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

  function notify(message, severity = 'info', isContinue = false) {
    const show = isContinue ? runtime.settings.continueShowToast : runtime.settings.retryShowToast;
    if (!show) return;

    let safeMsg = String(message || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (safeMsg.length > 70) safeMsg = safeMsg.slice(0, 67) + '...';

    const t = window.toastr || window.parent?.toastr;
    if (t && typeof t[severity] === 'function') t[severity](safeMsg, `[${SCRIPT_NAME}]`);
    appendLog(severity === 'error' ? 'error' : severity === 'warning' ? 'warn' : 'info', `[Toast] ${safeMsg}`);
  }

  function stripHtmlTags(str) { return str ? str.replace(/<[^>]*>/g, '').trim() : ''; }
  function getRawMessageText(message) { return message ? String(message.message ?? message.mes ?? '').trim() : ''; }

  function stripTrailingErrorContent(text) {
    if (!text || typeof text !== 'string') return '';

    // 1. 匹配 [API 错误] / [API Error] / 【API 错误】 及之后的所有内容（含前置换行与空白）
    const ERROR_HEADER_REGEX = /(?:\s*\[\s*(?:API\s*(?:错误|Error)|错误|Error|HTTP Error|Proxy Error|Request Error|System Error|Network Error|FetchError|TypeError|OpenAI Error|Claude Error)[^\]]*\]|\s*【\s*(?:API\s*错误|系统错误|网络错误|请求错误)[^】]*】|\s*\{\s*"(?:error|err|message|detail|code)"\s*:|\s*(?:Got response status|Failed to fetch|Network error|Request failed|Connection (?:aborted|reset|refused))\s*[:\d]|\s*(?:HTTP\s+(?:400|401|403|404|408|429|500|502|503|504)|status\s*(?:code)?\s*[:=]\s*(?:400|401|403|404|408|429|500|502|503|504)))[\s\S]*$/i;

    let cleaned = text.replace(ERROR_HEADER_REGEX, '');

    // 2. 剥除自定义报错特征及其前置空白与后续所有内容
    if (runtime.settings.customErrorKeywords) {
      const lines = runtime.settings.customErrorKeywords.split('\n').map(s => s.trim()).filter(Boolean);
      for (const kw of lines) {
        if (kw.startsWith('/') && kw.endsWith('/') && kw.length > 2) {
          try {
            const regex = new RegExp('\\s*' + kw.slice(1, -1) + '[\\s\\S]*$', 'i');
            cleaned = cleaned.replace(regex, '');
          } catch (e) {}
        } else {
          const idx = cleaned.toLowerCase().lastIndexOf(kw.toLowerCase());
          if (idx !== -1 && idx >= cleaned.length - kw.length - 120) {
            cleaned = cleaned.slice(0, idx);
          }
        }
      }
    }

    // 3. 剥除 [API 错误] 之前多余的换行与空白
    return cleaned.trimEnd();
  }

  async function updateChatMessageText(messageId, newText, lastMessage) {
    if (lastMessage) {
      if ('mes' in lastMessage) lastMessage.mes = newText;
      if ('message' in lastMessage) lastMessage.message = newText;
    }

    let updated = false;

    try {
      if (typeof setChatMessageText === 'function' && messageId !== null) {
        await setChatMessageText(messageId, newText);
        updated = true;
      }
    } catch (e) {}

    try {
      const parentWin = window.parent || window;
      const ctx = parentWin.SillyTavern?.getContext?.() || window.SillyTavern?.getContext?.();
      if (ctx?.chat && ctx.chat.length > 0) {
        const lastIdx = ctx.chat.length - 1;
        ctx.chat[lastIdx].mes = newText;
        if (typeof ctx.saveChat === 'function') ctx.saveChat();
        if (typeof ctx.updateMessageBlock === 'function') ctx.updateMessageBlock(lastIdx, ctx.chat[lastIdx]);
        updated = true;
      }
    } catch (e) {}

    // 同步更新 DOM 节点，确保 TT / ST 前端界面立即刷新掉错误文本
    try {
      const doc = window.parent?.document || document;
      const mesEl = doc.querySelector(`[mesid="${messageId}"] .mes_text`) || 
                    doc.querySelector(`[data-id="${messageId}"] .mes_text`) ||
                    doc.querySelector('#chat .mes:last-child .mes_text');
      if (mesEl) {
        mesEl.innerText = newText;
        updated = true;
      }
    } catch (e) {}

    return updated;
  }

  function isStartingWithTtError(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    return /^(?:\[\s*(?:API\s*(?:错误|Error)|错误|Error|HTTP Error|Proxy Error|Request Error|System Error|Network Error|FetchError|TypeError|OpenAI Error|Claude Error)[^\]]*\]|【\s*(?:API\s*错误|系统错误|网络错误|请求错误)[^】]*】|\{\s*"(?:error|err|message|detail|code)"\s*:|(?:Got response status|Failed to fetch|Network error|Request failed|Connection (?:aborted|reset|refused))\s*[:\d]|(?:HTTP\s+(?:400|401|403|404|408|429|500|502|503|504)|status\s*(?:code)?\s*[:=]\s*(?:400|401|403|404|408|429|500|502|503|504)))/i.test(trimmed);
  }

  function checkTextMatchesError(text) {
    if (!text || typeof text !== 'string') return { isError: false, reason: '' };
    const trimmed = text.trim();

    if (isStartingWithTtError(trimmed)) {
      const snippet = trimmed.slice(0, 28).replace(/[\r\n\t]+/g, ' ').trim();
      return { isError: true, reason: snippet, isTtError: true };
    }

    for (const p of BUILTIN_ERROR_PATTERNS) {
      const match = trimmed.match(p);
      if (match) {
        const snippet = match[0].replace(/[\r\n\t]+/g, ' ').trim().slice(0, 28);
        return { isError: true, reason: snippet, isTtError: false };
      }
    }

    if (runtime.settings.customErrorKeywords) {
      const lines = runtime.settings.customErrorKeywords.split('\n').map(s => s.trim()).filter(Boolean);
      for (const kw of lines) {
        if (kw.startsWith('/') && kw.endsWith('/') && kw.length > 2) {
          try {
            const regex = new RegExp(kw.slice(1, -1), 'i');
            const match = trimmed.match(regex);
            if (match) {
              const snippet = match[0].replace(/[\r\n\t]+/g, ' ').trim().slice(0, 25);
              return { isError: true, reason: snippet, isTtError: false };
            }
          } catch (e) {}
        } else if (trimmed.toLowerCase().includes(kw.toLowerCase())) {
          return { isError: true, reason: kw.slice(0, 20), isTtError: false };
        }
      }
    }
    return { isError: false, reason: '', isTtError: false };
  }

  function checkApologyAndRefusal(text) {
    if (!text || typeof text !== "string") return { isApology: false, reason: "" };
    const t = text.trim();
    if (t.length === 0) return { isApology: false, reason: "" };

    // 1. 特权直判：AI 自爆身份且包含拒绝动词 (100% 确定度)
    const AI_IDENTITY_REGEX = /(?:作为(?:一个)?(?:AI|人工智能|语言模型|智能助手|虚拟助手)|As an? (?:AI|assistant|language model|responsible AI))/i;
    const REFUSAL_VERB_REGEX = /(?:无法|不能|不可以|必须拒绝|cannot|can't|unable to|must decline)/i;
    if (AI_IDENTITY_REGEX.test(t) && REFUSAL_VERB_REGEX.test(t)) {
      return { isApology: true, reason: "AI身份声明拒绝" };
    }

    // 2. 三段位置特征切片 (开头 / 中间 / 结尾)
    const head150 = t.slice(0, 150);
    const tail150 = t.slice(-150);

    // Zone 1: 开头特征 (Opening Anchor)
    const ZONE1_OPENINGS = [
      /^(?:非常|很|真诚地)?(?:抱歉|对不起|致歉)/i,
      /^(?:I am sorry|I'm sorry|I apologize|Sorry)/i,
      /^(?:我无法|我不能|I cannot|I can't|I am unable)/i,
      /^(?:出于安全考虑|根据安全准则|Due to safety)/i,
      /(?:很抱歉|非常抱歉|对不起|I apologize|I'm sorry)/i
    ];

    // Zone 2: 中间特征 (Core Refusal / Policy Reason)
    const ZONE2_REASONS = [
      /(?:无法|不能|不可以|无法为您|不能为您)(?:提供|生成|创作|协助|继续|满足|回答|探讨|描述)/i,
      /(?:cannot|can't|am unable to|must decline to) (?:fulfill|assist|generate|provide|continue|comply|answer)/i,
      /(?:违反|不符合|触犯)了?(?:使用政策|安全准则|使用条款|社区规范|内容政策|安全政策)/i,
      /(?:violate|violates|against) (?:our|the)? (?:safety guidelines|usage policies|terms of service|content policy)/i,
      /(?:出于|due to) (?:安全|合规|道德|safety) (?:考虑|原因|reasons|concerns)/i,
      /(?:涉及|involves?) (?:敏感|不适当|违规|不合规|有害|色情|暴力|sensitive|explicit|harmful) (?:内容|content)?/i,
      /无法满足(?:您|你)的(?:这个|该)?(?:请求|需求|要求)/i
    ];

    // Zone 3: 结束特征 (Redirection / Closure Suffix)
    const ZONE3_ENDINGS = [
      /(?:建议|让我们|请问能否|不如)换一个话题/i,
      /(?:请问|如果)有什么其他(?:我可以帮您|可以探讨|想聊)的/i,
      /探讨更(?:积极|健康|合适)的话题/i,
      /(?:感谢|希望)(?:您|你)的?理解/i,
      /Let's (?:talk about|discuss) something else/i,
      /Is there (?:anything|something) else I can help you with/i,
      /Thank you for your understanding/i
    ];

    const matchZ1 = ZONE1_OPENINGS.some(r => r.test(head150));
    const matchZ2 = ZONE2_REASONS.some(r => r.test(t));
    const matchZ3 = ZONE3_ENDINGS.some(r => r.test(tail150));

    // 判定组合规则：
    // 1) 命中 Zone 1(开头道歉) + Zone 2(中间拒绝)
    // 2) 命中 Zone 2(中间拒绝) + Zone 3(结尾转移话题)
    // 3) 命中 Zone 1(开头道歉) + Zone 3(结尾转移话题) 且篇幅 <= 300 字
    if (matchZ1 && matchZ2) return { isApology: true, reason: "开头道歉+中间拒绝" };
    if (matchZ2 && matchZ3) return { isApology: true, reason: "中间拒绝+结尾转移" };
    if (matchZ1 && matchZ3 && t.length <= 300) return { isApology: true, reason: "开头道歉+结尾转移" };

    // 极简短拒绝 (< 80 字直接包含 Zone 2 核心词)
    if (t.length <= 80 && matchZ2) {
      return { isApology: true, reason: "短句明确拒绝" };
    }

    return { isApology: false, reason: "" };
  }

  function evaluateErrorState(lastMessage) {
    const rawText = getRawMessageText(lastMessage);
    if (runtime.settings.cleanTtErrorMessage) {
      if (isStartingWithTtError(rawText)) {
        return { shouldRetry: true, reason: 'TT首字API报错', isTtErrorText: true };
      }
      const err = checkTextMatchesError(rawText);
      if (err.isError) return { shouldRetry: true, reason: err.reason, isTtErrorText: err.isTtError };
    }

    // 道歉与安全拒绝三段式智能检测
    if (runtime.settings.retryOnApology) {
      const apology = checkApologyAndRefusal(rawText);
      if (apology.isApology) {
        return { shouldRetry: true, reason: `AI道歉/安全拒绝 (${apology.reason})`, isTtErrorText: false, isApology: true };
      }
    }

    const MVU_TAGS = 'UpdateVariable|update_variables?|setvar|StatusPlaceHolderImpl|StatusPlaceHolder|MvuStatus|DisplayStatus';
    const hasMvu = new RegExp('</?(?:' + MVU_TAGS + ')[^>]*>', 'i').test(rawText);
    let textToEval = rawText;
    if (runtime.settings.skipUpdateVariableTag && hasMvu) {
      const stripped = rawText
        .replace(new RegExp('<(?:' + MVU_TAGS + ')[^>]*>[\\s\\S]*?</(?:' + MVU_TAGS + ')>', 'gi'), '')
        .replace(new RegExp('<(?:' + MVU_TAGS + ')[^>]*\\/?>', 'gi'), '')
        .replace(new RegExp('<(?:' + MVU_TAGS + ')[^>]*>[\\s\\S]*$', 'gi'), '')
        .trim();
      if (stripped.length === 0) return { shouldRetry: false, reason: '纯MVU变量/状态栏更新楼层', isTtErrorText: false };
      textToEval = stripped;
    }
    if (runtime.settings.stripHtml && textToEval.includes('<')) textToEval = stripHtmlTags(textToEval);
    if (textToEval.length < runtime.settings.retryMinChars) {
      const reason = !runtime.gotStreamToken ? '流式断流/无回复' : `回复仅 ${textToEval.length} 字`;
      return { shouldRetry: true, reason, isTtErrorText: false };
    }
    if (runtime.hasToastErrorDuringGen && textToEval.length < 20) {
      const shortToastErr = (runtime.lastToastErrorMessage || '请求异常').replace(/[\r\n\t]+/g, ' ').slice(0, 25);
      return { shouldRetry: true, reason: shortToastErr, isTtErrorText: false };
    }
    return { shouldRetry: false, reason: '', isTtErrorText: false };
  }

  const GENERATION_URL_RE = /\/api\/(?:backends\/|novelai\/|openai\/|chats\/)|chat\/completions|generate|stream/i;
  const GENERATION_ACTION_RE = /generate|chat\/completions|completions|stream/i;

  function extractFinishReason(data) {
    if (!data || typeof data !== 'object') return null;
    const ch = data.choices?.[0];
    if (ch?.finish_reason) return String(ch.finish_reason);
    if (ch?.native_finish_reason) return String(ch.native_finish_reason);
    if (ch?.delta?.native?.claude?.stop_reason) return String(ch.delta.native.claude.stop_reason);
    if (data.stop_reason) return String(data.stop_reason);
    if (data.candidates?.[0]?.finishReason) return String(data.candidates[0].finishReason);
    if (data.results?.[0]?.finish_reason) return String(data.results[0].finish_reason);
    return null;
  }

  function sniffSseFinishReason(sseText) {
    let last = null;
    for (const line of sseText.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.replace(/^data:\s*/, '').trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const r = extractFinishReason(JSON.parse(payload));
        if (r) last = r;
      } catch (e) {}
    }
    return last;
  }

  // ==========================================================================
  // 合成工具 (emit_answer) 引擎与流式解包状态机 (双模全兼容: OpenAI & Vertex AI)
  // ==========================================================================

  const SYNTHETIC_TOOL_NAME = "emit_answer";

  const OPENAI_SYNTHETIC_TOOL = {
    type: "function",
    function: {
      name: SYNTHETIC_TOOL_NAME,
      description: "You MUST call this tool exactly once to output your final user-visible answer. Put the complete answer in the 'content' argument. Do NOT output any text outside this tool call.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The complete final answer to output to the user."
          }
        },
        required: ["content"]
      }
    }
  };

  const VERTEX_SYNTHETIC_DECLARATION = {
    name: SYNTHETIC_TOOL_NAME,
    description: "You MUST call this tool exactly once to output your final user-visible answer. Put the complete answer in the 'content' argument. Do NOT output any text outside this tool call.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The complete final answer to output to the user."
        }
      },
      required: ["content"]
    }
  };

  const SYNTHETIC_RULE_TEXT = "\n\n[System Rule]: 严格执行以下输出规则：1. 必须调用 emit_answer 工具来输出你的最终回答 2. 将完整的回答内容放入该工具的 content 参数中 3. 不要在普通文本中输出任何内容。";

  class StreamingJsonStringExtractor {
    constructor(targetKey = "content") {
      this.targetKey = targetKey;
      this.rawBuffer = "";
      this.inTargetString = false;
      this.isEscaping = false;
      this.keyPattern = new RegExp(`"${targetKey}"\\s*:\\s*"`, "i");
      this.keyMatched = false;
    }

    feed(chunkStr) {
      if (!chunkStr) return "";
      this.rawBuffer += chunkStr;
      let output = "";

      if (!this.keyMatched) {
        const match = this.rawBuffer.match(this.keyPattern);
        if (match) {
          this.keyMatched = true;
          this.inTargetString = true;
          const startIndex = match.index + match[0].length;
          this.rawBuffer = this.rawBuffer.slice(startIndex);
        } else {
          if (this.rawBuffer.length > 40) {
            this.rawBuffer = this.rawBuffer.slice(-40);
          }
          return "";
        }
      }

      if (this.inTargetString) {
        let i = 0;
        let remaining = "";
        while (i < this.rawBuffer.length) {
          const char = this.rawBuffer[i];
          if (this.isEscaping) {
            this.isEscaping = false;
            if (char === 'n') output += '\n';
            else if (char === 't') output += '\t';
            else if (char === 'r') output += '\r';
            else if (char === '"') output += '"';
            else if (char === '\\') output += '\\';
            else if (char === '/') output += '/';
            else if (char === 'u') {
              if (i + 4 < this.rawBuffer.length) {
                const hex = this.rawBuffer.slice(i + 1, i + 5);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                  output += String.fromCharCode(parseInt(hex, 16));
                  i += 4;
                } else {
                  output += 'u' + hex;
                }
              } else {
                this.isEscaping = true;
                remaining = this.rawBuffer.slice(i - 1);
                break;
              }
            } else {
              output += char;
            }
            i++;
          } else {
            if (char === '\\') {
              this.isEscaping = true;
              i++;
            } else if (char === '"') {
              this.inTargetString = false;
              break;
            } else {
              output += char;
              i++;
            }
          }
        }
        this.rawBuffer = remaining;
      }

      return output;
    }
  }

  function isGeminiOrGemmaModel(data) {
    if (!data || typeof data !== 'object') return false;
    const modelName = String(data.model || data.model_name || data.modelName || '').toLowerCase();
    if (modelName) {
      return modelName.includes('gemini') || modelName.includes('gemma');
    }
    // 若请求体中无显式 model 字段（如部分 Vertex AI 原生端点），按 Google contents / systemInstruction 结构判定
    return Array.isArray(data.contents) || !!data.systemInstruction || !!data.system_instruction;
  }

  function injectSyntheticToolToRequest(init) {
    if (!init || !init.body || typeof init.body !== 'string') return false;
    try {
      const data = JSON.parse(init.body);
      if (!data || typeof data !== 'object') return false;

      // 智能模型白名单过滤：仅对 Gemini / Gemma 系列模型生效
      if (!isGeminiOrGemmaModel(data)) {
        const currentModel = data.model || data.model_name || '未知模型';
        appendLog('info', `ℹ️ [合成工具抗外审] 当前模型 (${currentModel}) 非 Gemini/Gemma 系列，已自动跳过工具注入`);
        return false;
      }

      let injected = false;

      // 模式 1: Gemini / Vertex AI 原生格式 (contents / systemInstruction / generationConfig)
      if (Array.isArray(data.contents) || data.systemInstruction || data.system_instruction || data.generationConfig) {
        let tools = data.tools || [];
        const hasVertexTool = tools.some(t => {
          const decls = t.functionDeclarations || t.function_declarations || [];
          return decls.some(d => d.name === SYNTHETIC_TOOL_NAME);
        });

        if (!hasVertexTool) {
          tools.push({ functionDeclarations: [VERTEX_SYNTHETIC_DECLARATION] });
          data.tools = tools;
        }

        data.toolConfig = data.toolConfig || {};
        data.toolConfig.functionCallingConfig = data.toolConfig.functionCallingConfig || { mode: "AUTO" };
        data.tool_config = data.tool_config || {};
        data.tool_config.function_calling_config = data.tool_config.function_calling_config || { mode: "AUTO" };

        if (data.systemInstruction?.parts) {
          data.systemInstruction.parts.push({ text: SYNTHETIC_RULE_TEXT.trim() });
        } else if (data.system_instruction?.parts) {
          data.system_instruction.parts.push({ text: SYNTHETIC_RULE_TEXT.trim() });
        } else {
          data.systemInstruction = { parts: [{ text: SYNTHETIC_RULE_TEXT.trim() }] };
        }

        injected = true;
      }

      // 模式 2: OpenAI 兼容格式 (messages)
      if (Array.isArray(data.messages)) {
        let tools = data.tools || [];
        const hasOpenAITool = tools.some(t => t.function?.name === SYNTHETIC_TOOL_NAME || t.name === SYNTHETIC_TOOL_NAME);
        if (!hasOpenAITool) {
          tools.push(OPENAI_SYNTHETIC_TOOL);
          data.tools = tools;
          data.tool_choice = data.tool_choice || "auto";
        }

        const sysMsg = data.messages.find(m => m.role === 'system');
        if (sysMsg) {
          if (!sysMsg.content.includes(SYNTHETIC_TOOL_NAME)) sysMsg.content += SYNTHETIC_RULE_TEXT;
        } else {
          data.messages.unshift({ role: 'system', content: SYNTHETIC_RULE_TEXT.trim() });
        }

        injected = true;
      }

      if (injected) {
        init.body = JSON.stringify(data);
        const currentModel = data.model || 'Gemini/Vertex';
        appendLog('info', `🛡️ 已为 [${currentModel}] 注入合成工具 (emit_answer) 与防外审系统提示词`);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function emitFastTokens(controller, encoder, dataTemplate, textChunk, updateContentFn) {
    if (!textChunk) return;
    const charsPerBurst = 8; // 每次输出 8 个汉字 (极速高吞吐，适配现代大模型超快语速)
    const cadenceMs = 6;      // 6ms 微延时 (~1200+ 字符/秒，既有肉眼可见的连贯跳字，又绝不卡顿拖慢)

    if (textChunk.length <= charsPerBurst) {
      updateContentFn(dataTemplate, textChunk);
      controller.enqueue(encoder.encode('data: ' + JSON.stringify(dataTemplate) + '\n\n'));
      return;
    }

    for (let i = 0; i < textChunk.length; i += charsPerBurst) {
      const slice = textChunk.slice(i, i + charsPerBurst);
      updateContentFn(dataTemplate, slice);
      controller.enqueue(encoder.encode('data: ' + JSON.stringify(dataTemplate) + '\n\n'));
      if (i + charsPerBurst < textChunk.length && cadenceMs > 0) {
        await delay(cadenceMs);
      }
    }
  }

  function transformSyntheticStreamResponse(res) {
    if (!res.body || typeof ReadableStream === 'undefined') return res;

    const originalReader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const extractor = new StreamingJsonStringExtractor("content");
    let sseBuffer = "";
    let inSyntheticToolCall = false;
    let unpackedCharCount = 0;

    const transformedStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await originalReader.read();
            if (done) {
              if (unpackedCharCount > 0) {
                appendLog('info', `🛡️ [合成工具抗外审] 工具流实时解包完毕，累计还原正文 ${unpackedCharCount} 字`);
                notify(`🛡️ [合成工具抗外审] 成功解包还原 ${unpackedCharCount} 字！`, 'success', true);
              } else {
                appendLog('warn', '⚠️ [合成工具抗外审] 本次模型直接返回了普通文本（未调用 emit_answer），已平滑透传');
              }
              controller.close();
              break;
            }

            const chunkStr = decoder.decode(value, { stream: true });
            sseBuffer += chunkStr;
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop(); // 暂存未闭合的末尾行

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) {
                controller.enqueue(encoder.encode('\n'));
                continue;
              }

              if (trimmed.startsWith('data:')) {
                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]') {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  continue;
                }

                try {
                  const data = JSON.parse(payload);
                  const finishReason = extractFinishReason(data);
                  if (finishReason) {
                    runtime.lastGenerationMeta = { finishReason, at: Date.now(), stream: true };
                  }

                  let modified = false;

                  // 1. OpenAI 格式：解包处理
                  const choice = data.choices?.[0];
                  if (choice) {
                    const tc = choice.delta?.tool_calls?.[0] || choice.message?.tool_calls?.[0];
                    if (tc) {
                      if (tc.function?.name === SYNTHETIC_TOOL_NAME || inSyntheticToolCall) {
                        inSyntheticToolCall = true;
                        const rawArgs = tc.function?.arguments || "";
                        const textChunk = extractor.feed(rawArgs);

                        if (choice.delta) delete choice.delta.tool_calls;
                        if (choice.message) delete choice.message.tool_calls;
                        if (choice.finish_reason === "tool_calls") choice.finish_reason = "stop";

                        if (textChunk) {
                          unpackedCharCount += textChunk.length;
                          if (runtime.settings.syntheticToolTtStreamSim) {
                            // TT 模拟模式：走极速微秒流控器模拟逐字输出
                            await emitFastTokens(controller, encoder, data, textChunk, (d, chunk) => {
                              if (d.choices?.[0]?.delta) d.choices[0].delta.content = chunk;
                              if (d.choices?.[0]?.message) d.choices[0].message.content = chunk;
                            });
                          } else {
                            // ST 原生模式：1:1 零延迟直接透传
                            if (choice.delta) choice.delta.content = textChunk;
                            if (choice.message) choice.message.content = textChunk;
                            controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));
                          }
                        }
                        modified = true;
                        continue;
                      }
                    }
                  }

                  // 2. Google Vertex AI / Gemini Native 格式：解包处理
                  const candidate = data.candidates?.[0];
                  const parts = candidate?.content?.parts;
                  if (Array.isArray(parts)) {
                    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
                      const p = parts[pIdx];
                      if (p.functionCall && (p.functionCall.name === SYNTHETIC_TOOL_NAME || inSyntheticToolCall)) {
                        inSyntheticToolCall = true;
                        let textChunk = "";
                        const args = p.functionCall.args;
                        if (typeof args === "object" && args !== null && typeof args.content === "string") {
                          textChunk = args.content;
                        } else if (typeof args === "string") {
                          textChunk = extractor.feed(args);
                        }

                        delete p.functionCall;
                        if (textChunk) {
                          unpackedCharCount += textChunk.length;
                          if (runtime.settings.syntheticToolTtStreamSim) {
                            // TT 模拟模式：走极速微秒流控器模拟逐字输出
                            await emitFastTokens(controller, encoder, data, textChunk, (d, chunk) => {
                              if (d.candidates?.[0]?.content?.parts?.[pIdx]) {
                                d.candidates[0].content.parts[pIdx] = { text: chunk };
                              }
                            });
                          } else {
                            // ST 原生模式：1:1 零延迟直接透传
                            parts[pIdx] = { text: textChunk };
                            controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));
                          }
                        }
                        modified = true;
                        break;
                      }
                    }
                    if (modified) continue;
                  }

                  if (modified) continue;
                } catch (e) {}
              }

              // 默认原样透传
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
        } catch (err) {
          controller.error(err);
        }
      }
    });

    return new Response(transformedStream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  function installFetchHook() {
    if (runtime.hookInstalled) return;
    for (const w of [window, window.parent].filter(Boolean)) {
      if (w.fetch && !w.__thBottomUpHookInstalled) {
        const nativeFetch = w.fetch.bind(w);
        w.fetch = async (input, init) => {
          let isSynthetic = false;
          try {
            const isPost = (init && init.method === 'POST') || (input instanceof Request && input.method === 'POST');

            if (runtime.settings.syntheticToolEnabled && isPost) {
              if (input instanceof Request) {
                const cloned = input.clone();
                const bodyText = await cloned.text();
                if (bodyText && (bodyText.includes('"messages"') || bodyText.includes('"contents"') || bodyText.includes('"systemInstruction"') || bodyText.includes('"generationConfig"'))) {
                  const dummyInit = { body: bodyText };
                  if (injectSyntheticToolToRequest(dummyInit)) {
                    isSynthetic = true;
                    input = new Request(input, { body: dummyInit.body });
                    notify('🛡️ [合成工具抗外审] 注入中...', 'info', true);
                  }
                }
              } else if (init && init.body && typeof init.body === 'string') {
                if (init.body.includes('"messages"') || init.body.includes('"contents"') || init.body.includes('"systemInstruction"') || init.body.includes('"generationConfig"')) {
                  isSynthetic = injectSyntheticToolToRequest(init);
                  if (isSynthetic) {
                    notify('🛡️ [合成工具抗外审] 注入中...', 'info', true);
                  }
                }
              }
            }
          } catch (e) {}

          const res = await nativeFetch(input, init);

          try {
            const ct = res.headers.get('content-type') || '';
            if (res.ok) {
              if (isSynthetic && ct.includes('text/event-stream')) {
                return transformSyntheticStreamResponse(res);
              }
              void (async () => {
                try {
                  const clone = res.clone();
                  if (ct.includes('application/json')) {
                    const finishReason = extractFinishReason(await clone.json());
                    runtime.lastGenerationMeta = { finishReason, at: Date.now() };
                  } else if (ct.includes('text/event-stream')) {
                    const finishReason = sniffSseFinishReason(await clone.text());
                    runtime.lastGenerationMeta = { finishReason, at: Date.now(), stream: true };
                  }
                } catch (e) {}
              })();
            }
          } catch (e) {}
          return res;
        };
        w.__thBottomUpHookInstalled = true;
      }
    }
    runtime.hookInstalled = true;
  }

  function isMetaFresh(meta = runtime.lastGenerationMeta) {
    return !!(meta?.at && meta.at >= runtime.generationStartedAt);
  }

  async function awaitFreshGenerationMeta(timeoutMs = 2000, intervalMs = 50) {
    const dl = Date.now() + timeoutMs;
    while (Date.now() < dl) {
      if (isMetaFresh(runtime.lastGenerationMeta)) return runtime.lastGenerationMeta;
      await delay(intervalMs);
    }
    return runtime.lastGenerationMeta;
  }

  function isApiFinishReasonTruncated(reason, s) {
    if (!reason) return false;
    const r = String(reason).toLowerCase();
    if (s.continueOnLength && (r === 'length' || r === 'max_tokens' || r === 'max_output_tokens' || r.includes('max_tokens') || r.includes('output_truncated'))) return true;
    if (s.continueOnFilter && (r.includes('content_filter') || r.includes('content') || r.includes('filter') || r.includes('safety') || r.includes('prohibited') || r.includes('recitation') || r.includes('blocked') || r.includes('moderation') || r.includes('provider_refusal'))) return true;
    return false;
  }

  /**
   * 启发式未收束感知 ——【末尾终结符驱动，向前寻根验证】(Anchor-and-Verify Engine)
   */
  function analyzeHeuristicIncomplete(text, s) {
    if (!text || typeof text !== 'string') return { incomplete: false, reason: '' };
    const t = text.trim();
    if (t.length < s.continueMinIncomp) return { incomplete: false, reason: '' };

    // 1. 拦截断开的半截标签 (如 `<status`、`<UpdateVariable` 尚未打完 `>`)
    if (/<[a-zA-Z0-9_\-]+(?:\s+[^>]*)?$/.test(t)) {
      return { incomplete: true, reason: '截断在未完成的标签内' };
    }

    // 取末尾 20 个字符切片进行尾部判定
    const tail20 = t.slice(-20).trim();

    // (A) 单独的非成对终结符 (句号/感叹号/问号/代码块/分隔线/自闭合标签)
    const isStandaloneEnd = 
      /[。！？!?…~～]$/u.test(tail20) || 
      /\/>\s*$/i.test(tail20) || 
      /```\s*$/i.test(tail20) || 
      /---\s*$/i.test(tail20);

    if (isStandaloneEnd) {
      return { incomplete: false, reason: '' };
    }

    // (B) 检查末尾是否以【成对闭合标签】收尾 (如 </status>, </UpdateVariable>, </think>, </cot>)
    if (s.checkTags) {
      const closeTagMatch = tail20.match(/<\/([a-zA-Z0-9_\-]+)>\s*$/i);
      if (closeTagMatch) {
        const tagName = closeTagMatch[1].toLowerCase();
        const openTagRegex = new RegExp('<' + tagName + '(?:\\s+[^>]*)?>', 'i');
        if (openTagRegex.test(t)) {
          return { incomplete: false, reason: '' }; // 向前找到了对应的开始标签，通过！
        }
        return { incomplete: true, reason: '未找到匹配的开始标签 <' + tagName + '>' };
      }
    }

    // (C) 检查末尾是否以【成对闭引号/闭括号】收尾 (如 ”、」、』、）、】、》)
    if (s.checkQuotes || s.checkBrackets) {
      const PAIRS = [
        { open: '“', close: '”', name: '双弯引号', type: 'quotes' },
        { open: '‘', close: '’', name: '单弯引号', type: 'quotes' },
        { open: '「', close: '」', name: '直角引号', type: 'quotes' },
        { open: '『', close: '』', name: '直角双引号', type: 'quotes' },
        { open: '《', close: '》', name: '书名号', type: 'quotes' },
        { open: '（', close: '）', name: '圆括号', type: 'brackets' },
        { open: '(', close: ')', name: '圆括号', type: 'brackets' },
        { open: '【', close: '】', name: '方头括号', type: 'brackets' },
        { open: '[', close: ']', name: '方括号', type: 'brackets' },
        { open: '{', close: '}', name: '花括号', type: 'brackets' },
      ];

      for (const p of PAIRS) {
        if (p.type === 'quotes' && !s.checkQuotes) continue;
        if (p.type === 'brackets' && !s.checkBrackets) continue;

        if (tail20.endsWith(p.close)) {
          const lastOpen = t.lastIndexOf(p.open);
          const lastClose = t.lastIndexOf(p.close);
          if (lastOpen !== -1 && lastOpen < lastClose) {
            return { incomplete: false, reason: '' };
          }
        }
      }

      // 直双引号 (") 结尾检查
      if (s.checkQuotes && /(?<!\\)"\s*$/u.test(tail20)) {
        const quotes = t.match(/"/g);
        if (quotes && quotes.length % 2 === 0) {
          return { incomplete: false, reason: '' };
        }
      }
    }

    // (D) 如果都不满足上述合法的结尾，则判定为截断！
    if (/[，,、：:；;\-—\+=*/\\|&]$/u.test(tail20)) {
      return { incomplete: true, reason: '停在连接标点' };
    }
    if (/[\p{L}\p{N}]$/u.test(tail20)) {
      return { incomplete: true, reason: '句末未正常收束' };
    }
    return { incomplete: true, reason: '末尾未闭合收束' };
  }

  function stripTrailingMvuPlaceholders(text) {
    if (!text || typeof text !== 'string') return { text: '', stripped: false };
    const TRAILING_MVU_REGEX = /\s*<(?:StatusPlaceHolderImpl|StatusPlaceHolder|MvuStatus|DisplayStatus)(?:\s+[^>]*)?\s*\/?>\s*$/i;
    const TRAILING_MVU_BLOCK_REGEX = /\s*<(?:UpdateVariable|update_variables?|setvar|status|status_bar)(?:\s+[^>]*)?>[\s\S]*?<\/(?:UpdateVariable|update_variables?|setvar|status|status_bar)>\s*$/i;
    let t = text;
    let stripped = false;
    while (true) {
      if (TRAILING_MVU_REGEX.test(t)) {
        t = t.replace(TRAILING_MVU_REGEX, '');
        stripped = true;
        continue;
      }
      if (TRAILING_MVU_BLOCK_REGEX.test(t)) {
        t = t.replace(TRAILING_MVU_BLOCK_REGEX, '');
        stripped = true;
        continue;
      }
      break;
    }
    return { text: t, stripped };
  }

  async function evaluateTruncation(text) {
    const s = runtime.settings;
    if (!s.continueEnabled) return { truncated: false, reason: '' };

    const meta = await awaitFreshGenerationMeta();
    if (isMetaFresh(meta) && meta?.finishReason) {
      if (isApiFinishReasonTruncated(meta.finishReason, s)) return { truncated: true, reason: 'API截断 (' + meta.finishReason + ')' };
    }

    let textForHeuristic = text;
    if (s.mvuStatusInjectionCompat) {
      const res = stripTrailingMvuPlaceholders(text);
      if (res.stripped) textForHeuristic = res.text;
    }

    if (s.continueOnIncomplete) {
      const h = analyzeHeuristicIncomplete(textForHeuristic, s);
      if (h.incomplete) return { truncated: true, reason: h.reason };
    }

    if (s.continueOnCustomEnder && s.customEndMarkers) {
      const lines = s.customEndMarkers.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        let matched = false;
        const trimmed = text.trim();
        for (const line of lines) {
          if (line.startsWith('/') && line.endsWith('/') && line.length > 2) {
            try {
              if (new RegExp(line.slice(1, -1), 'i').test(trimmed)) { matched = true; break; }
            } catch (e) {}
          } else {
            if (trimmed.endsWith(line) || (line.startsWith('<') && trimmed.includes(line))) { matched = true; break; }
          }
        }
        if (!matched && trimmed.length >= s.continueMinIncomp) {
          return { truncated: true, reason: '未检测到结束标识' };
        }
      }
    }

    return { truncated: false, reason: '' };
  }

  function startTimeoutTimer() {
    clearTimeoutTimer();
    if (!runtime.settings.retryEnabled || runtime.settings.requestTimeoutMs <= 0) return;
    runtime.timeoutTimer = setTimeout(async () => {
      runtime.timeoutTimer = null;
      if (runtime.userStopped || runtime.isRetryInFlight) return;
      const parentDoc = window.parent?.document || document;
      const isGenerating = parentDoc.body?.dataset?.generating === 'true' || document.body?.dataset?.generating === 'true';
      if (isGenerating) {
        notify(`生成超时（${Math.round(runtime.settings.requestTimeoutMs / 1000)}秒），正在自动处理...`, 'warning');
        try {
          const parentWin = window.parent || window;
          if (typeof parentWin.SillyTavern?.stopGeneration === 'function') parentWin.SillyTavern.stopGeneration();
          else if (typeof parentWin.SillyTavern?.getContext?.()?.stopGeneration === 'function') parentWin.SillyTavern.getContext().stopGeneration();
        } catch (e) {}
        await delay(500);

        if (runtime.settings.prioritizeContinueOnContent) {
          void executeContinue('续写超时自动补续', 0, null);
        } else {
          void executeRegenerate('生成超时');
        }
      }
    }, runtime.settings.requestTimeoutMs);
  }

  function clearTimeoutTimer() {
    if (runtime.timeoutTimer) { clearTimeout(runtime.timeoutTimer); runtime.timeoutTimer = null; }
  }

  async function waitForGenerationUnlock(timeoutMs = 15000) {
    const dl = Date.now() + timeoutMs;
    while (Date.now() < dl) {
      const pDoc = window.parent?.document || document;
      if (document.body?.dataset?.generating !== 'true' && pDoc.body?.dataset?.generating !== 'true') return;
      await delay(100);
    }
    throw new Error('等待生成解锁超时');
  }

  async function invokeNativeAction(type = 'regenerate') {
    const doc = window.parent?.document || window.document;
    const parentWin = window.parent || window;
    const ctx = parentWin.SillyTavern?.getContext?.() || window.SillyTavern?.getContext?.();

    if (type === 'generate') {
      // 全新生成模式：当删除了报错楼层后，触发让 AI 回复用户的最后发言
      try {
        if (ctx && typeof ctx.generate === 'function') {
          await ctx.generate('generate');
          return true;
        }
      } catch (e) {}

      try {
        if (typeof triggerSlash === 'function') {
          await triggerSlash('/generate await=true');
          return true;
        }
      } catch (e) {}

      try {
        if (typeof parentWin.Generate === 'function') {
          await parentWin.Generate();
          return true;
        }
      } catch (e) {}

      const sendBtn = doc.getElementById('send_but') || doc.querySelector('#send_but') || doc.querySelector('.send_but');
      if (sendBtn) {
        sendBtn.click();
        return true;
      }
      throw new Error('未找到可用的 generate 触发方式');
    }

    if (type === 'continue') {
      // 安全熔断：严格禁止对用户楼层执行续写！
      if (ctx?.chat && ctx.chat.length > 0) {
        const lastMsg = ctx.chat[ctx.chat.length - 1];
        if (lastMsg.is_user || lastMsg.role === 'user') {
          appendLog('warn', '⚠️ 安全拦截：最后一楼为用户消息，严禁续写用户楼层！已自动转为全新生成');
          return await invokeNativeAction('generate');
        }
      }

      const btnId = 'option_continue';
      const btn = doc.getElementById(btnId) ||
        doc.querySelector('#' + btnId) ||
        doc.querySelector('.' + btnId) ||
        doc.querySelector('[data-action="continue"]') ||
        doc.querySelector('#chat_options [title*="continue"]') ||
        doc.querySelector('#chat_options [title*="续写"]');

      if (btn) {
        try {
          if (parentWin.$ && typeof parentWin.$(btn).trigger === 'function') {
            parentWin.$(btn).trigger('click');
          } else {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: parentWin }));
            btn.click();
          }
          return true;
        } catch (e) {}
      }

      try {
        if (ctx && typeof ctx.generate === 'function') { await ctx.generate('continue'); return true; }
      } catch (e) {}

      try {
        if (typeof triggerSlash === 'function') { await triggerSlash('/continue await=true'); return true; }
      } catch (e) {}

      throw new Error('未找到可用的 continue 触发方式');
    }

    if (type === 'regenerate') {
      const btnId = 'option_regenerate';
      const btn = doc.getElementById(btnId) ||
        doc.querySelector('#' + btnId) ||
        doc.querySelector('.' + btnId) ||
        doc.querySelector('[data-action="regenerate"]') ||
        doc.querySelector('#chat_options [title*="regenerate"]') ||
        doc.querySelector('#chat_options [title*="重新生成"]');

      if (btn) {
        try {
          if (parentWin.$ && typeof parentWin.$(btn).trigger === 'function') {
            parentWin.$(btn).trigger('click');
          } else {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: parentWin }));
            btn.click();
          }
          return true;
        } catch (e) {}
      }

      try {
        if (ctx && typeof ctx.generate === 'function') { await ctx.generate('regenerate'); return true; }
      } catch (e) {}

      try {
        if (typeof triggerSlash === 'function') { await triggerSlash('/regenerate await=true'); return true; }
      } catch (e) {}

      throw new Error('未找到可用的 regenerate 触发方式');
    }
  }

  async function executeRegenerate(reason, isTtErrorText = false, messageId = null) {
    if (!runtime.settings.retryEnabled || runtime.userStopped || runtime.isRetryInFlight) return false;
    if (runtime.consecutiveRetries >= runtime.settings.retryMax) {
      notify(`已达到连续重刷上限（${runtime.settings.retryMax}次），已停止重试。`, 'error');
      runtime.consecutiveRetries = 0;
      return false;
    }

    runtime.isRetryInFlight = true;
    runtime.consecutiveRetries += 1;
    const attempt = runtime.consecutiveRetries;
    const total = runtime.settings.retryMax;

    notify(`🔄 ${reason}，${runtime.settings.retryDelayMs}ms 后自动重刷 (${attempt}/${total})...`, 'warning');
    appendLog('warn', `触发重试 (${attempt}/${total}): ${reason}`);

    try {
      await waitForGenerationUnlock();
      await delay(runtime.settings.unlockSettleMs);

      let deleted = false;
      if (isTtErrorText && runtime.settings.cleanTtErrorMessage && messageId !== null) {
        try {
          if (typeof deleteChatMessages === 'function') {
            await deleteChatMessages([messageId]);
            deleted = true;
            appendLog('info', `已清理 TT 纯报错楼层 (Message ID: ${messageId})`);
            await delay(150);
          }
        } catch (e) {}

        try {
          const parentWin = window.parent || window;
          const ctx = parentWin.SillyTavern?.getContext?.() || window.SillyTavern?.getContext?.();
          if (!deleted && ctx?.chat && ctx.chat.length > 0) {
            const lastIdx = ctx.chat.length - 1;
            if (ctx.chat[lastIdx].message_id === messageId || lastIdx >= 0) {
              ctx.chat.splice(lastIdx, 1);
              if (typeof ctx.saveChat === 'function') ctx.saveChat();
              deleted = true;
              appendLog('info', '已从上下文删除 TT 报错楼层');
            }
          }
        } catch (e) {}
      }

      if (runtime.settings.retryDelayMs > 0) await delay(runtime.settings.retryDelayMs);

      // 如果成功删除了报错楼层，最后一条变成了用户消息，应触发 'generate' 生成角色新回复；
      // 如果未删除楼层，则触发 'regenerate' 重刷当前楼层。
      const actionType = deleted ? 'generate' : 'regenerate';
      await invokeNativeAction(actionType);
      return true;
    } catch (err) {
      appendLog('error', `自动重刷失败: ${err?.message || err}`);
      notify('自动重刷失败: ' + (err?.message || err), 'error');
      return false;
    } finally {
      runtime.isRetryInFlight = false;
    }
  }

  async function executeContinue(reason, baselineLength, messageIndex) {
    if (!runtime.settings.continueEnabled || runtime.userStopped || runtime.isContinueInFlight) return false;
    if (runtime.consecutiveContinues >= runtime.settings.continueMax) {
      notify(`已达到连续续写上限（${runtime.settings.continueMax}次），已停止续写。`, 'warning', true);
      runtime.consecutiveContinues = 0;
      runtime.pendingAction = null;
      return false;
    }

    runtime.isContinueInFlight = true;
    runtime.consecutiveContinues += 1;
    const attempt = runtime.consecutiveContinues;
    const total = runtime.settings.continueMax;

    notify(`✂️ ${reason}，${runtime.settings.continueDelayMs}ms 后续写 (${attempt}/${total})...`, 'info', true);
    appendLog('info', `触发续写 (${attempt}/${total}): ${reason}`);

    runtime.pendingAction = { baselineLength, messageIndex };

    try {
      await waitForGenerationUnlock();
      await delay(runtime.settings.unlockSettleMs);

      // MVU 状态栏注入兼容：续写前自动切除末尾被抢先注入的占位符/状态栏
      if (runtime.settings.mvuStatusInjectionCompat && messageIndex !== null) {
        try {
          const parentWin = window.parent || window;
          const ctx = parentWin.SillyTavern?.getContext?.() || window.SillyTavern?.getContext?.();
          if (ctx?.chat && ctx.chat.length > 0) {
            const lastIdx = ctx.chat.length - 1;
            const currentMes = ctx.chat[lastIdx].mes || '';
            const res = stripTrailingMvuPlaceholders(currentMes);
            if (res.stripped) {
              await updateChatMessageText(messageIndex, res.text, ctx.chat[lastIdx]);
              baselineLength = res.text.length;
              runtime.pendingAction.baselineLength = baselineLength;
              appendLog('info', '🧹 [MVU状态栏兼容] 续写前已切除末尾占位符，防止状态栏被夹在句子正中间');
              await delay(60);
            }
          }
        } catch (e) {}
      }

      if (runtime.settings.continueDelayMs > 0) await delay(runtime.settings.continueDelayMs);
      await invokeNativeAction('continue');
      return true;
    } catch (err) {
      appendLog('error', `自动续写失败: ${err?.message || err}`);
      notify('自动续写失败: ' + (err?.message || err), 'error', true);
      runtime.consecutiveContinues = 0;
      runtime.pendingAction = null;
      return false;
    } finally {
      runtime.isContinueInFlight = false;
    }
  }

  async function handleGenerationEnded() {
    clearTimeoutTimer();
    if (runtime.isRetryInFlight || runtime.isContinueInFlight || runtime.userStopped) return;
    await delay(runtime.settings.unlockSettleMs);

    let lastMessage = null;
    let messageId = null;
    try {
      if (typeof getChatMessages === 'function') {
        const msgs = getChatMessages(-1);
        if (Array.isArray(msgs) && msgs.length > 0) {
          lastMessage = msgs[0];
          messageId = lastMessage.message_id;
        }
      }
    } catch (e) {}

    if (!lastMessage || lastMessage.role === 'user') {
      if (runtime.settings.retryEnabled && !runtime.userStopped) {
        void executeRegenerate('未生成角色回复楼层', false, null);
      }
      return;
    }

    const rawText = getRawMessageText(lastMessage);
    appendLog('info', `生成结束 (楼层 ${messageId} | 字数: ${rawText.length})`);

    // 阶段 1: 错误检测与智能分流
    if (runtime.settings.retryEnabled) {
      const err = evaluateErrorState(lastMessage);
      if (err.shouldRetry) {
        appendLog('warn', `阶段 1 捕获异常: ${err.reason}`);

        // 升级：存在正文时优先续写自愈 (检测报错前的有效字符数量，最短 5 字；若是 AI 道歉/拒绝则强制整楼重刷)
        if (!err.isApology && runtime.settings.continueEnabled && runtime.settings.prioritizeContinueOnContent) {
          const cleanedText = stripTrailingErrorContent(rawText);
          const minValidChars = 5;

          if (cleanedText.length >= minValidChars) {
            appendLog('info', `检测到有效正文 (${cleanedText.length} 字 >= ${minValidChars} 字)，已清洗末尾报错，优先执行自动续写自愈...`);
            await updateChatMessageText(messageId, cleanedText, lastMessage);
            await delay(150);
            void executeContinue(`异常自愈 (${err.reason})`, cleanedText.length, messageId);
            return;
          } else {
            appendLog('info', `报错前有效正文仅 ${cleanedText.length} 字 (< ${minValidChars} 字)，判定为无效楼层，执行整楼重刷`);
          }
        }

        void executeRegenerate(err.reason, err.isTtErrorText, messageId);
        return;
      }
    }

    runtime.consecutiveRetries = 0;
    runtime.hasToastErrorDuringGen = false;
    runtime.lastToastErrorMessage = '';

    // 阶段 2: 截断判定与续写
    if (!runtime.settings.continueEnabled) return;
    if (checkTextMatchesError(rawText).isError) {
      runtime.consecutiveContinues = 0;
      runtime.pendingAction = null;
      return;
    }

    if (rawText.length < runtime.settings.continueMinChars) {
      runtime.consecutiveContinues = 0;
      runtime.pendingAction = null;
      return;
    }

    if (runtime.pendingAction && runtime.pendingAction.messageIndex === messageId) {
      if (!(rawText.length > runtime.pendingAction.baselineLength)) {
        notify('续写后无新增内容，已停止。', 'warning', true);
        runtime.consecutiveContinues = 0;
        runtime.pendingAction = null;
        return;
      }
    }

    const { truncated, reason } = await evaluateTruncation(rawText);
    if (truncated) {
      appendLog('info', `阶段 2 判定截断: ${reason}`);
      void executeContinue(reason, rawText.length, messageId);
    } else {
      if (runtime.consecutiveContinues > 0) {
        appendLog('info', `回复全部收束完成，累计续写 ${runtime.consecutiveContinues} 次`);
        notify(`✅ 回复续写收束完成！(累计续写 ${runtime.consecutiveContinues} 次)`, 'success', true);
      }
      runtime.consecutiveContinues = 0;
      runtime.pendingAction = null;
    }
  }

  function hookToastrErrors() {
    const pToastr = window.parent?.toastr || window.toastr;
    if (pToastr && !pToastr.__thBottomUpToastHooked) {
      const orig = pToastr.error.bind(pToastr);
      pToastr.error = function (msg, title, opt) {
        const pDoc = window.parent?.document || document;
        if (pDoc.body?.dataset?.generating === 'true' || document.body?.dataset?.generating === 'true') {
          runtime.hasToastErrorDuringGen = true;
          runtime.lastToastErrorMessage = String(msg || title || '');
          appendLog('warn', `捕获到 Toast 报错: ${runtime.lastToastErrorMessage}`);
        }
        return orig(msg, title, opt);
      };
      pToastr.__thBottomUpToastHooked = true;
    }
  }

  function bindEvents() {
    if (runtime.listenersBound) return;
    hookToastrErrors();
    installFetchHook();

    if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined') {
      eventOn(tavern_events.GENERATION_STARTED, (_t, _p, dry) => {
        if (dry) return;
        runtime.generationStartedAt = Date.now();
        runtime.gotStreamToken = false;
        runtime.userStopped = false;
        runtime.hasToastErrorDuringGen = false;
        runtime.lastToastErrorMessage = '';
        runtime.lastGenerationMeta = null;
        appendLog('info', '🚀 生成开始 (Generation Started)');
        startTimeoutTimer();
      });

      eventOn(tavern_events.STREAM_TOKEN_RECEIVED, () => { runtime.gotStreamToken = true; });
      eventOn(tavern_events.GENERATION_STOPPED, () => {
        runtime.userStopped = true;
        clearTimeoutTimer();
        runtime.pendingAction = null;
        runtime.consecutiveContinues = 0;
        appendLog('warn', '🛑 用户手动停止了生成');
      });

      eventOn(tavern_events.GENERATION_ENDED, () => { void handleGenerationEnded(); });
      eventOn(tavern_events.CHAT_CHANGED, () => {
        runtime.consecutiveRetries = 0;
        runtime.isRetryInFlight = false;
        runtime.consecutiveContinues = 0;
        runtime.isContinueInFlight = false;
        runtime.userStopped = false;
        runtime.pendingAction = null;
        runtime.lastGenerationMeta = null;
        clearTimeoutTimer();
        appendLog('info', '💬 聊天上下文已切换');
      });
    }
    runtime.listenersBound = true;
  }

  // --------------------------------------------------------------------------
  // 分页设置面板 UI
  // --------------------------------------------------------------------------

  function openSettingsPopup() {
    const s = runtime.settings;
    const parentWin = window.parent || window;
    const popupFn = parentWin.SillyTavern?.callGenericPopup || window.SillyTavern?.callGenericPopup;
    let pendingSettings = null;

    const contentHtml = `
      <div id="bottom_up_popup_root" style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: var(--SmartThemeBodyColor, #e0e0e0); width: 100%; max-width: 520px; box-sizing: border-box; margin: 0 auto; padding: 2px; min-height: 480px; max-height: 80vh; overflow-y: auto; -webkit-overflow-scrolling: touch;">
        
        <!-- 弹窗头部 -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 16px; font-weight: bold; display: flex; align-items: center; gap: 8px;">
            <span>🍺自动续杯BottomsUp 设置</span>
          </div>
          <div style="font-size: 11px; opacity: 0.6;">v2.6.7 Debug</div>
        </div>

        
        <!-- 顶部 3 个 Tab 切换按钮 -->
        <div style="display: flex; gap: 4px; margin-bottom: 14px; background: rgba(0,0,0,0.25); padding: 4px; border-radius: 8px;">
          <button type="button" id="bu_tab_btn_retry" style="flex: 1; min-height: 36px; padding: 6px 6px; border-radius: 6px; border: none; background: #3b82f6; color: #fff; font-weight: bold; font-size: 12px; cursor: pointer; transition: all 0.2s; touch-action: manipulation;">
            🔄 错误重试
          </button>
          <button type="button" id="bu_tab_btn_continue" style="flex: 1; min-height: 36px; padding: 6px 6px; border-radius: 6px; border: none; background: transparent; color: inherit; font-size: 12px; cursor: pointer; transition: all 0.2s; opacity: 0.75; touch-action: manipulation;">
            ✂️ 截断续写
          </button>
          <button type="button" id="bu_tab_btn_logs" style="flex: 1; min-height: 36px; padding: 6px 6px; border-radius: 6px; border: none; background: transparent; color: inherit; font-size: 12px; cursor: pointer; transition: all 0.2s; opacity: 0.75; touch-action: manipulation;">
            📜 运行日志
          </button>
        </div>

        <!-- Tab 1: 错误自动重试面板 -->
        <div id="bu_tab_content_retry" style="display: flex; flex-direction: column; gap: 12px; min-height: 440px;">
          <label style="min-height: 38px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 4px 0; touch-action: manipulation;">
            <span style="font-weight: 600; font-size: 14px;">启用错误自动重试</span>
            <input type="checkbox" id="bu_retry_enabled" ${s.retryEnabled ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: #3b82f6;" />
          </label>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">最多重试次数</label>
              <input type="number" id="bu_retry_max" value="${s.retryMax}" min="1" max="20" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">重试延迟 (ms)</label>
              <input type="number" id="bu_retry_delay" value="${s.retryDelayMs}" min="0" max="30000" step="100" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">最短有效字数</label>
              <input type="number" id="bu_retry_min_chars" value="${s.retryMinChars}" min="1" max="500" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">超时时间 (秒，0为禁用)</label>
              <input type="number" id="bu_retry_timeout_sec" value="${Math.round(s.requestTimeoutMs / 1000)}" min="0" max="600" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; margin: 4px 0;">
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>启用 TauriTavern 兼容</span>
                <span class="fa-solid fa-circle-question" title="重试前自动清理包含报错信息的楼层，避免污染上下文" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 4px;"></span>
              </div>
              <input type="checkbox" id="bu_retry_clean_tt" ${s.cleanTtErrorMessage ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #3b82f6;" />
            </label>
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>启用道歉拒绝重刷</span>
                <span class="fa-solid fa-circle-question" title="三段式位置特征（开头道歉+中间拒绝+结尾转移话题）智能识别模型道歉与安全说教套话，并在命中时自动触发整楼重新生成，斩断角色变冷和道歉污染（内置防误判机制，不误伤剧情内角色正常对白道歉）" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 4px;"></span>
              </div>
              <input type="checkbox" id="bu_retry_on_apology" ${s.retryOnApology ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #3b82f6;" />
            </label>
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>启用 MVU 变量更新兼容</span>
                <span class="fa-solid fa-circle-question" title="智能识别纯变量楼层与正文内嵌变量，防止误判为空回复" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 4px;"></span>
              </div>
              <input type="checkbox" id="bu_retry_skip_mvu" ${s.skipUpdateVariableTag ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #3b82f6;" />
            </label>
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>启用 HTML 前端兼容</span>
                <span class="fa-solid fa-circle-question" title="判定有效字数前剥除 HTML 标签，仅按纯可见文字计算字数" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 4px;"></span>
              </div>
              <input type="checkbox" id="bu_retry_strip_html" ${s.stripHtml ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #3b82f6;" />
            </label>
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>启用 Toast 弹窗通知</span>
                <span class="fa-solid fa-circle-question" title="在触发重试或完成时弹出系统 Toast 消息提示" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 4px;"></span>
              </div>
              <input type="checkbox" id="bu_retry_toast" ${s.retryShowToast ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #3b82f6;" />
            </label>
          </div>

          <div>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">
              <span>自定义报错特征</span>
              <span class="fa-solid fa-circle-question" title="每行输入一个报错关键词或 /正则表达式/" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 4px;"></span>
            </label>
            <textarea id="bu_retry_custom_kw" rows="2" placeholder="每行一个关键词或 /正则表达式/，例如:&#10;429 Too Many Requests&#10;/error_code_\\d+/" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 13px; resize: vertical;"></textarea>
          </div>
        </div>

        <!-- Tab 2: 截断自动续写面板 -->
        <div id="bu_tab_content_continue" style="display: none; flex-direction: column; gap: 10px; min-height: 440px;">
          <label style="min-height: 38px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
            <span style="font-weight: 600; font-size: 14px;">启用截断自动续写</span>
            <input type="checkbox" id="bu_cont_enabled" ${s.continueEnabled ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: #10b981;" />
          </label>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">最多连续续写次数</label>
              <input type="number" id="bu_cont_max" value="${s.continueMax}" min="1" max="15" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">续写延迟 (ms)</label>
              <input type="number" id="bu_cont_delay" value="${s.continueDelayMs}" min="0" max="30000" step="100" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">最短触发字数</label>
              <input type="number" id="bu_cont_min_chars" value="${s.continueMinChars}" min="1" max="500" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; font-size: 12px; margin-bottom: 4px; opacity: 0.9;">启发式最短触发字数</label>
              <input type="number" id="bu_cont_min_incomp" value="${s.continueMinIncomp}" min="10" max="2000" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 14px;" />
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; margin-top: 4px;">

            <!-- 1. 存在正文时优先续写 (问号后带小折叠符号) -->
            <div style="display: flex; flex-direction: column;">
              <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span>启用存在正文时优先续写</span>
                  <span class="fa-solid fa-circle-question" title="生成中途若遇到异常报错或断流，只要报错前已存在有效正文（>=5字），自动清洗末尾报错并优先顺着正文续写，而非整楼打回重刷" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
                  <span id="bu_toggle_prioritize_btn" title="点击展开/收起子项" style="cursor: pointer; opacity: 0.7; font-size: 11px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.08); user-select: none;">▶</span>
                </div>
                <input type="checkbox" id="bu_cont_prioritize_continue" ${s.prioritizeContinueOnContent ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
              </label>
              <div id="bu_collapse_prioritize" style="display: none; flex-direction: column; gap: 6px; padding: 2px 0 2px 14px;">
                <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation; opacity: 0.95;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span>└─ 启用 MVU 状态栏注入兼容</span>
                    <span class="fa-solid fa-circle-question" title="自动续写前检测并剥除末尾被正则抢先注入的 <StatusPlaceHolderImpl/> 状态栏占位符，防止状态栏被夹在句子正中间，待全文续写收束后再挂载最终状态栏" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
                  </div>
                  <input type="checkbox" id="bu_cont_mvu_status_compat" ${s.mvuStatusInjectionCompat ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
                </label>
              </div>
            </div>

            <!-- 2. 合成工具抗外审截断 (问号后带小折叠符号) -->
            <div style="display: flex; flex-direction: column;">
              <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span>启用合成工具抗外审截断</span>
                  <span class="fa-solid fa-circle-question" title="自动注入 emit_answer 工具声明，将正文包装为工具参数绕过模型外部内容审查（内置智能模型白名单：仅对 Gemini / Gemma 系列模型生效，不会干扰 Claude/GPT/DeepSeek）" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
                  <span id="bu_toggle_synthetic_btn" title="点击展开/收起子项" style="cursor: pointer; opacity: 0.7; font-size: 11px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.08); user-select: none;">▶</span>
                </div>
                <input type="checkbox" id="bu_cont_synthetic_tool" ${s.syntheticToolEnabled ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
              </label>
              <div id="bu_collapse_synthetic" style="display: none; flex-direction: column; gap: 6px; padding: 2px 0 2px 14px;">
                <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation; opacity: 0.95;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span>└─ 启用 TauriTavern 工具流式模拟</span>
                    <span class="fa-solid fa-circle-question" title="针对 TauriTavern (TT) 客户端工具调用时默认不走打字机的机制，启用微秒级极速流控器模拟逐字跳字效果；普通 SillyTavern (ST) 网页端流式正常无需开启" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
                  </div>
                  <input type="checkbox" id="bu_cont_synthetic_tool_tt_sim" ${s.syntheticToolTtStreamSim ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
                </label>
              </div>
            </div>

            <!-- 3. 常规触发条件 -->
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span>启用最大字数截断续写</span>
                <span class="fa-solid fa-circle-question" title="检测到 API 返回 length 或 max_tokens 截断时自动续写" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
              </div>
              <input type="checkbox" id="bu_cont_on_length" ${s.continueOnLength ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
            </label>

            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span>启用安全审核拦截续写</span>
                <span class="fa-solid fa-circle-question" title="检测到 API 返回 content_filter 或 safety 审查截断时自动续写" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
              </div>
              <input type="checkbox" id="bu_cont_on_filter" ${s.continueOnFilter ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
            </label>

            <!-- 4. 启发式未收束续写 (问号后带小折叠符号) -->
            <div style="display: flex; flex-direction: column;">
              <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span>启用启发式未收束续写</span>
                  <span class="fa-solid fa-circle-question" title="检测到末尾未以正常闭合符或标点收束时自动续写" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
                  <span id="bu_toggle_heuristic_btn" title="点击展开/收起子项" style="cursor: pointer; opacity: 0.7; font-size: 11px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.08); user-select: none;">▶</span>
                </div>
                <input type="checkbox" id="bu_cont_on_incomplete" ${s.continueOnIncomplete ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
              </label>
              <div id="bu_collapse_heuristic" style="display: none; flex-direction: column; gap: 6px; padding: 2px 0 2px 14px; font-size: 12.5px;">
                <label style="min-height: 28px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; touch-action: manipulation;">
                  <span>成对引号闭合 (“”「」)</span>
                  <input type="checkbox" id="bu_cont_chk_quotes" ${s.checkQuotes ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981;" />
                </label>
                <label style="min-height: 28px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; touch-action: manipulation;">
                  <span>成对括号闭合 (（）【】)</span>
                  <input type="checkbox" id="bu_cont_chk_brackets" ${s.checkBrackets ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981;" />
                </label>
                <label style="min-height: 28px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; touch-action: manipulation;">
                  <span>XML/HTML 闭标签</span>
                  <input type="checkbox" id="bu_cont_chk_tags" ${s.checkTags ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981;" />
                </label>
                <label style="min-height: 28px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; touch-action: manipulation;">
                  <span>代码块闭合 (\`\`\`)</span>
                  <input type="checkbox" id="bu_cont_chk_md" ${s.checkMarkdown ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981;" />
                </label>
                <label style="min-height: 28px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; touch-action: manipulation;">
                  <span>句末标点收束</span>
                  <input type="checkbox" id="bu_cont_chk_punc" ${s.checkPunctuation ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981;" />
                </label>
              </div>
            </div>

            <!-- 5. 自定义结束标识 (问号后带小折叠符号，多行清晰布局) -->
            <div style="display: flex; flex-direction: column;">
              <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span>启用无结束标识自动续写</span>
                  <span class="fa-solid fa-circle-question" title="消息末尾未出现设定的结束标识时自动续写" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
                  <span id="bu_toggle_custom_ender_btn" title="点击展开/收起子项" style="cursor: pointer; opacity: 0.7; font-size: 11px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.08); user-select: none;">▶</span>
                </div>
                <input type="checkbox" id="bu_cont_on_custom_ender" ${s.continueOnCustomEnder ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
              </label>
              <div id="bu_collapse_custom_ender" style="display: none; flex-direction: column; gap: 6px; padding: 4px 0 6px 14px;">
                <div style="font-size: 12px; opacity: 0.9; line-height: 1.4;">自定义结束标识 (每行一个关键词或 /正则表达式/):</div>
                <textarea id="bu_cont_custom_enders" rows="2" placeholder="每行一个结束标识或 /正则表达式/，例如:&#10;[END]&#10;</response>&#10;/【第.+回合结束】/" style="width: 100%; box-sizing: border-box; padding: 8px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: inherit; font-size: 13px; resize: vertical; margin-top: 2px;"></textarea>
              </div>
            </div>

            <!-- 6. Toast 通知 -->
            <label style="min-height: 34px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 2px 0; touch-action: manipulation;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span>启用 Toast 弹窗通知</span>
                <span class="fa-solid fa-circle-question" title="在触发续写或完成时弹出系统 Toast 消息提示" style="opacity: 0.6; cursor: help; font-size: 14px; padding: 2px 4px;"></span>
              </div>
              <input type="checkbox" id="bu_cont_toast" ${s.continueShowToast ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;" />
            </label>

          </div>
        </div>

        
        <!-- Tab 3: 运行日志面板 (Debug 专属) -->
        <div id="bu_tab_content_logs" style="display: none; flex-direction: column; gap: 10px; min-height: 440px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 13px; font-weight: bold; opacity: 0.9;">实时运行诊断日志:</div>
            <div style="display: flex; gap: 6px;">
              <button type="button" id="bu_log_btn_copy" style="padding: 4px 8px; font-size: 11px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: inherit; cursor: pointer;">📋 复制全部</button>
              <button type="button" id="bu_log_btn_clear" style="padding: 4px 8px; font-size: 11px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: inherit; cursor: pointer;">🗑️ 清空</button>
            </div>
          </div>
          <div id="bu_log_container" style="background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; line-height: 1.4; color: #a7f3d0; max-height: 380px; min-height: 380px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; -webkit-overflow-scrolling: touch;">
            ${runtime.logs.length > 0 ? runtime.logs.join('\n') : '// 暂无运行日志，触发重试或续写时将在此处实时记录诊断信息'}
          </div>
        </div>

      </div>
    `;

    const popupOptions = {
      okButton: '保存全部设置',
      cancelButton: '取消',
      onClosing: (popup) => {
        try {
          const root = popup?.dlg || (window.parent?.document || document).getElementById('bottom_up_popup_root');
          if (root) {
            const retryEnabledEl = root.querySelector('#bu_retry_enabled');
            const retryMaxEl = root.querySelector('#bu_retry_max');
            const retryDelayEl = root.querySelector('#bu_retry_delay');
            const retryMinCharsEl = root.querySelector('#bu_retry_min_chars');
            const retryTimeoutEl = root.querySelector('#bu_retry_timeout_sec');
            const cleanTtEl = root.querySelector('#bu_retry_clean_tt');
            const retryApologyEl = root.querySelector('#bu_retry_on_apology');
            const skipMvuEl = root.querySelector('#bu_retry_skip_mvu');
            const stripHtmlEl = root.querySelector('#bu_retry_strip_html');
            const retryToastEl = root.querySelector('#bu_retry_toast');
            const customKwEl = root.querySelector('#bu_retry_custom_kw');

            const contEnabledEl = root.querySelector('#bu_cont_enabled');
            const prioritizeContEl = root.querySelector('#bu_cont_prioritize_continue');
            const mvuStatusCompatEl = root.querySelector('#bu_cont_mvu_status_compat');
            const syntheticToolEl = root.querySelector('#bu_cont_synthetic_tool');
            const syntheticToolTtSimEl = root.querySelector('#bu_cont_synthetic_tool_tt_sim');
            const contMaxEl = root.querySelector('#bu_cont_max');
            const contDelayEl = root.querySelector('#bu_cont_delay');
            const contMinCharsEl = root.querySelector('#bu_cont_min_chars');
            const contMinIncompEl = root.querySelector('#bu_cont_min_incomp');
            const onLengthEl = root.querySelector('#bu_cont_on_length');
            const onFilterEl = root.querySelector('#bu_cont_on_filter');
            const onIncompEl = root.querySelector('#bu_cont_on_incomplete');
            const onCustomEnderEl = root.querySelector('#bu_cont_on_custom_ender');
            const customEndersEl = root.querySelector('#bu_cont_custom_enders');
            const quotesEl = root.querySelector('#bu_cont_chk_quotes');
            const bracketsEl = root.querySelector('#bu_cont_chk_brackets');
            const tagsEl = root.querySelector('#bu_cont_chk_tags');
            const mdEl = root.querySelector('#bu_cont_chk_md');
            const puncEl = root.querySelector('#bu_cont_chk_punc');
            const contToastEl = root.querySelector('#bu_cont_toast');

            pendingSettings = {
              retryEnabled: retryEnabledEl ? retryEnabledEl.checked : s.retryEnabled,
              retryMax: retryMaxEl ? Math.max(1, Math.min(20, Number(retryMaxEl.value) || s.retryMax)) : s.retryMax,
              retryDelayMs: retryDelayEl ? Math.max(0, Number(retryDelayEl.value) || s.retryDelayMs) : s.retryDelayMs,
              retryMinChars: retryMinCharsEl ? Math.max(1, Number(retryMinCharsEl.value) || s.retryMinChars) : s.retryMinChars,
              requestTimeoutMs: retryTimeoutEl ? Math.max(0, (Number(retryTimeoutEl.value) || 0) * 1000) : s.requestTimeoutMs,
              cleanTtErrorMessage: cleanTtEl ? cleanTtEl.checked : s.cleanTtErrorMessage,
              retryOnApology: retryApologyEl ? retryApologyEl.checked : s.retryOnApology,
              skipUpdateVariableTag: skipMvuEl ? skipMvuEl.checked : s.skipUpdateVariableTag,
              stripHtml: stripHtmlEl ? stripHtmlEl.checked : s.stripHtml,
              retryShowToast: retryToastEl ? retryToastEl.checked : s.retryShowToast,
              customErrorKeywords: customKwEl ? customKwEl.value : s.customErrorKeywords,

              continueEnabled: contEnabledEl ? contEnabledEl.checked : s.continueEnabled,
              prioritizeContinueAfterStarted: prioritizeContEl ? prioritizeContEl.checked : s.prioritizeContinueAfterStarted,
              mvuStatusInjectionCompat: mvuStatusCompatEl ? mvuStatusCompatEl.checked : s.mvuStatusInjectionCompat,
              syntheticToolEnabled: syntheticToolEl ? syntheticToolEl.checked : s.syntheticToolEnabled,
              syntheticToolTtStreamSim: syntheticToolTtSimEl ? syntheticToolTtSimEl.checked : s.syntheticToolTtStreamSim,
              continueMax: contMaxEl ? Math.max(1, Math.min(15, Number(contMaxEl.value) || s.continueMax)) : s.continueMax,
              continueDelayMs: contDelayEl ? Math.max(0, Number(contDelayEl.value) || s.continueDelayMs) : s.continueDelayMs,
              continueMinChars: contMinCharsEl ? Math.max(1, Number(contMinCharsEl.value) || s.continueMinChars) : s.continueMinChars,
              continueMinIncomp: contMinIncompEl ? Math.max(10, Number(contMinIncompEl.value) || s.continueMinIncomp) : s.continueMinIncomp,
              continueOnLength: onLengthEl ? onLengthEl.checked : s.continueOnLength,
              continueOnFilter: onFilterEl ? onFilterEl.checked : s.continueOnFilter,
              continueOnIncomplete: onIncompEl ? onIncompEl.checked : s.continueOnIncomplete,
              continueOnCustomEnder: onCustomEnderEl ? onCustomEnderEl.checked : s.continueOnCustomEnder,
              customEndMarkers: customEndersEl ? customEndersEl.value : s.customEndMarkers,
              checkQuotes: quotesEl ? quotesEl.checked : s.checkQuotes,
              checkBrackets: bracketsEl ? bracketsEl.checked : s.checkBrackets,
              checkTags: tagsEl ? tagsEl.checked : s.checkTags,
              checkMarkdown: mdEl ? mdEl.checked : s.checkMarkdown,
              checkPunctuation: puncEl ? puncEl.checked : s.checkPunctuation,
              continueShowToast: contToastEl ? contToastEl.checked : s.continueShowToast,
            };
          }
        } catch (e) {}
        return true;
      },
    };

    if (typeof popupFn === 'function') {
      popupFn(contentHtml, 2, '', popupOptions).then(result => {
        if (result === 1 || result === true) {
          if (pendingSettings) {
            saveSettings(pendingSettings);
            notify('设置已成功保存并应用！', 'success');
          }
        }
      });

      setTimeout(() => {
        const root = (window.parent?.document || document).getElementById('bottom_up_popup_root');
        if (root) {
          const customKwEl = root.querySelector('#bu_retry_custom_kw');
          if (customKwEl) customKwEl.value = s.customErrorKeywords || '';
          const customEndersEl = root.querySelector('#bu_cont_custom_enders');
          if (customEndersEl) customEndersEl.value = s.customEndMarkers || '';

          const questionIcons = root.querySelectorAll('.fa-circle-question');
          questionIcons.forEach(icon => {
            icon.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const tip = icon.getAttribute('title');
              if (tip) notify(tip, 'info');
            });
          });

          // 显式折叠/展开符号绑定
          const setupToggle = (btnId, colId) => {
            const btn = root.querySelector('#' + btnId);
            const col = root.querySelector('#' + colId);
            if (btn && col) {
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isHidden = (col.style.display === 'none' || !col.style.display);
                col.style.display = isHidden ? 'flex' : 'none';
                btn.innerText = isHidden ? '▼' : '▶';
              });
            }
          };
          setupToggle('bu_toggle_prioritize_btn', 'bu_collapse_prioritize');
          setupToggle('bu_toggle_synthetic_btn', 'bu_collapse_synthetic');
          setupToggle('bu_toggle_heuristic_btn', 'bu_collapse_heuristic');
          setupToggle('bu_toggle_custom_ender_btn', 'bu_collapse_custom_ender');

          
          const tabBtnRetry = root.querySelector('#bu_tab_btn_retry');
          const tabBtnContinue = root.querySelector('#bu_tab_btn_continue');
          const tabBtnLogs = root.querySelector('#bu_tab_btn_logs');

          const tabContentRetry = root.querySelector('#bu_tab_content_retry');
          const tabContentContinue = root.querySelector('#bu_tab_content_continue');
          const tabContentLogs = root.querySelector('#bu_tab_content_logs');

          const btnCopy = root.querySelector('#bu_log_btn_copy');
          const btnClear = root.querySelector('#bu_log_btn_clear');
          const logBox = root.querySelector('#bu_log_container');

          if (btnCopy && logBox) {
            btnCopy.onclick = () => {
              const text = runtime.logs.join('\n');
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => notify('日志已成功复制到剪贴板！', 'success'));
              } else {
                notify('已选中全部日志，请手动复制', 'info');
              }
            };
          }

          if (btnClear && logBox) {
            btnClear.onclick = () => {
              runtime.logs = [];
              logBox.innerText = '// 日志已清空';
              notify('运行日志已清空', 'info');
            };
          }

          function resetTabs() {
            tabBtnRetry.style.background = 'transparent';
            tabBtnRetry.style.color = 'inherit';
            tabBtnRetry.style.fontWeight = 'normal';
            tabBtnRetry.style.opacity = '0.75';

            tabBtnContinue.style.background = 'transparent';
            tabBtnContinue.style.color = 'inherit';
            tabBtnContinue.style.fontWeight = 'normal';
            tabBtnContinue.style.opacity = '0.75';

            tabBtnLogs.style.background = 'transparent';
            tabBtnLogs.style.color = 'inherit';
            tabBtnLogs.style.fontWeight = 'normal';
            tabBtnLogs.style.opacity = '0.75';

            tabContentRetry.style.display = 'none';
            tabContentContinue.style.display = 'none';
            tabContentLogs.style.display = 'none';
          }

          if (tabBtnRetry && tabBtnContinue && tabBtnLogs) {
            tabBtnRetry.onclick = () => {
              resetTabs();
              tabBtnRetry.style.background = '#3b82f6';
              tabBtnRetry.style.color = '#fff';
              tabBtnRetry.style.fontWeight = 'bold';
              tabBtnRetry.style.opacity = '1';
              tabContentRetry.style.display = 'flex';
            };

            tabBtnContinue.onclick = () => {
              resetTabs();
              tabBtnContinue.style.background = '#10b981';
              tabBtnContinue.style.color = '#fff';
              tabBtnContinue.style.fontWeight = 'bold';
              tabBtnContinue.style.opacity = '1';
              tabContentContinue.style.display = 'flex';
            };

            tabBtnLogs.onclick = () => {
              resetTabs();
              tabBtnLogs.style.background = '#8b5cf6';
              tabBtnLogs.style.color = '#fff';
              tabBtnLogs.style.fontWeight = 'bold';
              tabBtnLogs.style.opacity = '1';
              tabContentLogs.style.display = 'flex';
              if (logBox) {
                logBox.innerText = runtime.logs.length > 0 ? runtime.logs.join('\n') : '// 暂无运行日志';
                logBox.scrollTop = logBox.scrollHeight;
              }
            };
          }
        }
      }, 50);
    }
  }

  function initButtons() {
    if (typeof replaceScriptButtons === 'function' && typeof getButtonEvent === 'function') {
      replaceScriptButtons([
        { name: '🍺 自动续杯设置', visible: true },
      ]);
      eventOn(getButtonEvent('🍺 自动续杯设置'), () => { openSettingsPopup(); });
    }
  }

  function init() {
    loadSettings();
    bindEvents();
    initButtons();
    appendLog('info', `插件已加载就绪 —— 自动续杯啤酒机已启动！`);
  }

  init();
})();
