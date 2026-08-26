/**
 * 酒馆速贴 (Tavern Quick Paste) v1.0
 * 酒馆助手 (JS-Slash-Runner) 脚本 · 不修改酒馆源码
 *
 * 功能:
 *  - 入口: 可拖动悬浮球 / 输入框旁「扩展」按钮(魔法棒)菜单内的条目(常驻, 原生外观)
 *  - 快捷复制板块: 粘贴文字创建条目, 点一下即复制, 提示可点击关闭, 不阻塞任何操作;
 *    输入框单行起步、超行自动长高; 搜索默认收起为放大镜按钮
 *  - 笔记板块: 标题(可空, 空时显示正文摘要) + 正文; 编辑器为草稿模式,
 *    只有点「确认」才保存, 返回/Esc/切页一律放弃改动; 「贴墙」把笔记钉成独立小窗边聊边改
 *  - 贴墙: 把任意笔记钉成独立小窗悬浮在酒馆中, 可直接查看与编辑
 *  - 主窗口与贴墙窗口均可拖动(头部)与缩放(右下角手柄), 尺寸/位置记忆
 *  - 设置: 默认板块 / 悬浮球开关 / 数据导出导入清空
 *  - 桌面与移动端均可拖动, 移动端触控优化; 数据经脚本变量持久化(跨聊天、随酒馆设置同步)
 *
 * 运行环境: 酒馆助手脚本在页面内嵌的同源隐藏 iframe 中运行,
 * 因此所有 UI 都挂在 parent.document 上, 视口尺寸也取自 parent 窗口。
 */
(() => {
  'use strict';

  if (window.__TSUTIE_BOOTED__) return;
  window.__TSUTIE_BOOTED__ = true;

  // ---------------------------------------------------------------- 基础环境
  const APP = '酒馆速贴';
  const VERSION = '1.0';
  const PFX = 'tsutie';
  const doc = () => window.parent.document;
  const win = () => window.parent;
  const VW = () => win().innerWidth;
  const VH = () => win().innerHeight;

  /** 极简日志 */
  const log = (...a) => console.info(`[${APP}]`, ...a);
  const warn = (...a) => console.warn(`[${APP}]`, ...a);
  const fatal = (err) => {
    console.error(`[${APP}]`, err);
    try { (win().toastr || {}).error?.(`${APP} 初始化失败: ${err?.message || err}`); } catch (_) { /* noop */ }
  };

  /** 创建主文档元素 */
  function el(tag, cls, text) {
    const node = doc().createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------------------------------------------------------------- 数据层
  const DEFAULT_STATE = {
    v: 1,
    settings: {
      defaultTab: 'copy',     // 'copy' | 'notes' 默认板块
      showBall: true,          // 是否显示悬浮球
      ballPos: null,           // {x,y} 悬浮球位置
      appPos: null,            // {x,y} 主窗口位置
      appSize: null,           // {w,h} 主窗口尺寸
    },
    clips: [],                 // {id, text, created, updated}
    notes: [],                 // {id, title, content, created, updated}
    wallsOpen: [],             // 处于贴墙状态的笔记 id
  };
  let state = null;

  /** 深合并: 对象递归合并, 数组与原始值直接覆盖 */
  function mergeInto(base, patch) {
    for (const k of Object.keys(patch || {})) {
      const pv = patch[k];
      if (pv && typeof pv === 'object' && !Array.isArray(pv)
        && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        mergeInto(base[k], pv);
      } else {
        base[k] = clone(pv);
      }
    }
    return base;
  }

  function loadState() {
    let raw = {};
    try {
      raw = getVariables({ type: 'script' }) || {};
    } catch (err) {
      warn('读取脚本变量失败, 使用默认数据', err);
    }
    return mergeInto(clone(DEFAULT_STATE), raw);
  }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      replaceVariables(clone(state), { type: 'script' });
    } catch (err) {
      warn('保存脚本变量失败', err);
    }
  }

  // ---------------------------------------------------------------- 提示 (非阻塞)
  const toasts = el('div', `${PFX}-toasts`);
  toasts.id = `${PFX}-toasts`;
  function toast(msg, opts = {}) {
    const { type = 'success', action, onAction, duration } = opts;
    while (toasts.children.length >= 3) toasts.firstChild.remove();
    const t = el('div', `${PFX}-toast ${PFX}-toast-${type}`);
    const span = el('span', `${PFX}-toast-msg`, msg);
    t.appendChild(span);
    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      if (!t.isConnected) return;
      t.classList.add(`${PFX}-toast-out`);
      setTimeout(() => t.remove(), 200);
    };
    // 单击提示立即关闭
    t.addEventListener('click', (ev) => {
      if (ev.target.closest(`.${PFX}-toast-btn`)) return; // 撤销按钮有自己的处理
      dismiss();
    });
    if (action) {
      t.classList.add(`${PFX}-toast-action`);
      const btn = el('button', `${PFX}-toast-btn`, action);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        dismiss();
        try { onAction && onAction(); } catch (err) { warn(err); }
      });
      t.appendChild(btn);
    }
    toasts.appendChild(t);
    const life = duration ?? (action ? 5000 : 1600);
    timer = setTimeout(dismiss, life);
    return dismiss;
  }
  const toastCopied = () => toast('已复制');

  // ---------------------------------------------------------------- 剪贴板
  async function doCopy(text) {
    // 1) 酒馆助手内置复制
    try {
      if (typeof builtin !== 'undefined' && builtin && typeof builtin.copyText === 'function') {
        builtin.copyText(text);
        return true;
      }
    } catch (_) { /* 降级 */ }
    // 2) 主页面剪贴板 API
    try {
      await win().navigator.clipboard.writeText(text);
      return true;
    } catch (_) { /* 降级 */ }
    // 3) 主页面 execCommand 兜底
    try {
      const ta = doc().createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      doc().body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = doc().execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------- 样式注入
  const styleNode = el('style');
  styleNode.id = `${PFX}-style`;
  styleNode.textContent = `
.${PFX}-ball,.${PFX}-win,.${PFX}-toasts{
  box-sizing:border-box;margin:0;padding:0;font-family:inherit;line-height:1.5;
}
.${PFX}-ball *,.${PFX}-win *{box-sizing:border-box;}
/* ---------- 悬浮球 ---------- */
.${PFX}-ball{
  position:fixed;z-index:99990;width:46px;height:46px;border-radius:50%;
  background:linear-gradient(135deg,#5b8cff,#9a6bff);
  border:1px solid rgba(255,255,255,.25);
  box-shadow:0 4px 18px rgba(60,90,255,.45),inset 0 1px 0 rgba(255,255,255,.25);
  display:flex;align-items:center;justify-content:center;cursor:grab;
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;
  transition:transform .15s ease,opacity .2s ease,box-shadow .2s ease;
}
.${PFX}-ball:hover{box-shadow:0 6px 24px rgba(60,90,255,.65);transform:scale(1.06);}
.${PFX}-ball:active{cursor:grabbing;}
.${PFX}-ball svg{width:22px;height:22px;fill:#fff;pointer-events:none;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));}
.${PFX}-dragging{transition:none!important;}
/* ---------- 输入栏按钮 / 魔法菜单项 ---------- */
/* 扩展菜单条目完全复用酒馆原生 .list-group-item 样式, 不注入任何自定义外观 */
/* ---------- 窗口通用 ---------- */
.${PFX}-win{
  position:fixed;z-index:99991;width:min(430px,calc(100vw - 16px));
  height:min(600px,calc(100vh - 110px));
  height:min(600px,calc(100dvh - 110px));
  min-width:270px;min-height:220px;
  display:flex;flex-direction:column;overflow:hidden;
  background:rgba(23,25,33,.94);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  color:#e8eaf0;border:1px solid rgba(255,255,255,.09);
  border-radius:16px;box-shadow:0 14px 48px rgba(0,0,0,.5);
  opacity:0;transform:scale(.95) translateY(8px);pointer-events:none;
  transition:opacity .18s ease,transform .18s ease;
}
.${PFX}-win.${PFX}-show{opacity:1;transform:none;pointer-events:auto;}
@media (max-width:520px){
  .${PFX}-win{height:min(600px,calc(100vh - 70px));height:min(600px,calc(100dvh - 70px));border-radius:14px;}
}
/* ---------- 主窗口头部(标签页 + 按钮, 兼作拖动柄) ---------- */
.${PFX}-head{
  flex:0 0 auto;display:flex;align-items:center;gap:2px;
  padding:10px 10px 0 12px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
}
.${PFX}-head:active{cursor:grabbing;}
.${PFX}-tabs{display:flex;flex:1 1 auto;min-width:0;background:rgba(255,255,255,.05);
  border-radius:10px;padding:3px;gap:3px;}
.${PFX}-tab{
  flex:1;border:0;background:transparent;color:#9aa0ae;font-size:14px;font-weight:600;
  padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;
  transition:background .15s ease,color .15s ease;touch-action:manipulation;min-height:32px;
}
.${PFX}-tab:hover{color:#c9cede;}
.${PFX}-tab.${PFX}-active{background:linear-gradient(135deg,#5b8cff,#9a6bff);color:#fff;
  box-shadow:0 2px 10px rgba(90,110,255,.4);}
.${PFX}-hbtn{
  flex:0 0 auto;width:34px;height:34px;margin-left:4px;border:0;border-radius:9px;
  background:transparent;color:#9aa0ae;cursor:pointer;font-size:17px;
  display:flex;align-items:center;justify-content:center;
  transition:background .15s,color .15s;touch-action:manipulation;
}
.${PFX}-hbtn:hover{background:rgba(255,255,255,.08);color:#fff;}
.${PFX}-hbtn svg{width:17px;height:17px;fill:currentColor;pointer-events:none;}
.${PFX}-hbtn-danger:hover{background:rgba(255,107,107,.15);color:#ff8080;}
/* ---------- 主体 ---------- */
.${PFX}-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.${PFX}-view{flex:1 1 auto;min-height:0;display:none;flex-direction:column;}
.${PFX}-view.${PFX}-view-show{display:flex;}
.${PFX}-pad{padding:10px 12px 4px;}
/* ---------- 输入控件 ---------- */
.${PFX}-ta,.${PFX}-input{
  width:100%;background:rgba(255,255,255,.06);color:#e8eaf0;
  border:1px solid transparent;border-radius:10px;outline:none;
  font-size:14px;padding:9px 11px;resize:none;
  font-family:inherit;line-height:1.55;
  transition:border-color .15s,background .15s;
}
.${PFX}-ta::placeholder,.${PFX}-input::placeholder{color:#6b7280;}
.${PFX}-ta:focus,.${PFX}-input:focus{border-color:#6f8cff;background:rgba(255,255,255,.08);}
.${PFX}-ta{min-height:64px;max-height:180px;overflow-y:auto;}
.${PFX}-ta-oneline{min-height:40px;max-height:150px;} /* 条目输入框: 单行起步, 内容超行才长高 */
.${PFX}-iconbtn{
  width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:#9aa0ae;
  cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;
  transition:background .15s,color .15s;touch-action:manipulation;
}
.${PFX}-iconbtn svg{width:16px;height:16px;fill:currentColor;pointer-events:none;}
.${PFX}-iconbtn:hover{background:rgba(255,255,255,.08);color:#fff;}
/* ---------- 列表 ---------- */
.${PFX}-listwrap{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:8px 10px 12px;display:flex;flex-direction:column;gap:7px;}
.${PFX}-listwrap::-webkit-scrollbar{width:6px;}
.${PFX}-listwrap::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:3px;}
.${PFX}-item{
  display:flex;align-items:center;gap:6px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.05);
  border-radius:11px;padding:9px 8px 9px 12px;cursor:pointer;
  transition:background .13s,border-color .13s,transform .08s;
  -webkit-tap-highlight-color:transparent;
}
.${PFX}-item:hover{background:rgba(255,255,255,.09);border-color:rgba(122,140,255,.35);}
.${PFX}-item:active{transform:scale(.985);}
.${PFX}-item.${PFX}-flash{animation:${PFX}flash .8s ease;}
@keyframes ${PFX}flash{0%{background:rgba(122,140,255,.35);}100%{background:rgba(255,255,255,.05);}}
.${PFX}-item-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.${PFX}-item-title{
  font-size:14px;font-weight:600;color:#eef0f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.${PFX}-snip{
  font-size:13px;color:#aab0bf;word-break:break-all;white-space:pre-wrap;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.${PFX}-snip-2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:pre-wrap;}
.${PFX}-item-time{font-size:11px;color:#69707f;flex:0 0 auto;}
.${PFX}-ibtns{flex:0 0 auto;display:flex;gap:1px;}
.${PFX}-ibtn{
  width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#79808f;
  cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;
  transition:background .13s,color .13s;touch-action:manipulation;
}
.${PFX}-ibtn svg{width:15px;height:15px;fill:currentColor;pointer-events:none;}
.${PFX}-ibtn:hover{background:rgba(255,255,255,.1);color:#cdd3e0;}
.${PFX}-ibtn-on{color:#8fa5ff!important;}
.${PFX}-ibtn-danger:hover{background:rgba(255,107,107,.14);color:#ff8080;}
.${PFX}-empty{
  margin:auto;text-align:center;color:#6b7280;font-size:13px;line-height:1.9;
  border:1.5px dashed rgba(255,255,255,.13);border-radius:14px;
  padding:26px 20px;width:82%;
}
.${PFX}-empty .${PFX}-empty-ico{font-size:30px;display:block;margin-bottom:4px;filter:grayscale(.2);}
/* ---------- 工具行(搜索/新建) ---------- */
.${PFX}-toolbar{display:flex;gap:7px;align-items:center;}
.${PFX}-toolbar .${PFX}-input{flex:1;min-width:0;height:36px;padding:6px 11px;}
.${PFX}-newbtn{
  flex:0 0 auto;height:36px;padding:0 13px;border:0;border-radius:9px;cursor:pointer;
  background:linear-gradient(135deg,#5b8cff,#9a6bff);color:#fff;font-size:13px;font-weight:600;
  display:flex;align-items:center;gap:5px;white-space:nowrap;
  transition:filter .15s,transform .08s;touch-action:manipulation;
}
.${PFX}-newbtn:hover{filter:brightness(1.12);}
.${PFX}-newbtn:active{transform:scale(.96);}
.${PFX}-composer-foot{display:flex;align-items:center;justify-content:space-between;margin-top:7px;gap:8px;}
.${PFX}-hint{font-size:12px;color:#69707f;}
.${PFX}-primarybtn,.${PFX}-ghostbtn{
  height:34px;padding:0 15px;border:0;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;
  transition:filter .15s,transform .08s;touch-action:manipulation;white-space:nowrap;
}
.${PFX}-primarybtn{background:linear-gradient(135deg,#5b8cff,#9a6bff);color:#fff;}
.${PFX}-primarybtn:hover{filter:brightness(1.12);}
.${PFX}-ghostbtn{background:rgba(255,255,255,.08);color:#c3c9d6;}
.${PFX}-ghostbtn:hover{background:rgba(255,255,255,.14);}
.${PFX}-primarybtn:active,.${PFX}-ghostbtn:active{transform:scale(.96);}
/* ---------- 编辑视图 ---------- */
.${PFX}-edhead{display:flex;align-items:center;gap:6px;padding:10px 12px 2px;}
.${PFX}-backbtn{
  width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:#aab0bf;
  cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;
  transition:background .15s,color .15s;touch-action:manipulation;
}
.${PFX}-backbtn:hover{background:rgba(255,255,255,.09);color:#fff;}
.${PFX}-edtitle{flex:1;font-size:15px;font-weight:700;color:#eef0f6;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${PFX}-edbody{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:8px 12px 4px;}
.${PFX}-edbody .${PFX}-content-ta{flex:1 1 auto;min-height:120px;max-height:none;}
.${PFX}-edfoot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px 12px;}
.${PFX}-danger-text{
  background:linear-gradient(135deg,#e56b6b,#d45050);color:#fff;font-weight:600;
  box-shadow:0 2px 10px rgba(200,80,80,.32);
}
.${PFX}-danger-text:hover{filter:brightness(1.1);background:linear-gradient(135deg,#e56b6b,#d45050);}
.${PFX}-danger-text:active{transform:scale(.96);}
/* ---------- 设置 ---------- */
.${PFX}-setwrap{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px 16px;
  display:flex;flex-direction:column;gap:9px;}
.${PFX}-setwrap::-webkit-scrollbar{width:6px;}
.${PFX}-setwrap::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:3px;}
.${PFX}-sethead{font-size:12px;font-weight:700;color:#69707f;letter-spacing:.08em;margin-top:6px;}
.${PFX}-setrow{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.05);
  border-radius:11px;padding:11px 13px;
}
.${PFX}-setlabel{font-size:14px;color:#dfe3ec;display:flex;flex-direction:column;gap:2px;min-width:0;}
.${PFX}-setdesc{font-size:12px;color:#767d8c;}
.${PFX}-seg{display:flex;background:rgba(255,255,255,.07);border-radius:9px;padding:3px;gap:3px;flex:0 0 auto;}
.${PFX}-segb{
  border:0;background:transparent;color:#9aa0ae;font-size:13px;padding:6px 12px;border-radius:7px;
  cursor:pointer;transition:background .15s,color .15s;touch-action:manipulation;min-height:30px;
}
.${PFX}-segb.${PFX}-active{background:linear-gradient(135deg,#5b8cff,#9a6bff);color:#fff;}
.${PFX}-switch{position:relative;width:44px;height:25px;flex:0 0 auto;cursor:pointer;}
.${PFX}-switch input{opacity:0;width:0;height:0;position:absolute;}
.${PFX}-switch-track{
  position:absolute;inset:0;border-radius:13px;background:rgba(255,255,255,.14);
  transition:background .18s;
}
.${PFX}-switch-knob{
  position:absolute;top:3px;left:3px;width:19px;height:19px;border-radius:50%;background:#fff;
  transition:transform .18s;box-shadow:0 1px 4px rgba(0,0,0,.4);
}
.${PFX}-switch input:checked ~ .${PFX}-switch-track{background:linear-gradient(135deg,#5b8cff,#9a6bff);}
.${PFX}-switch input:checked ~ .${PFX}-switch-knob{transform:translateX(19px);}
.${PFX}-btnrow{display:flex;gap:8px;flex-wrap:wrap;}
.${PFX}-mini{
  flex:1;min-width:86px;height:34px;border:0;border-radius:9px;cursor:pointer;font-size:13px;
  background:rgba(255,255,255,.08);color:#c3c9d6;transition:background .15s,color .15s;
  touch-action:manipulation;
}
.${PFX}-mini:hover{background:rgba(255,255,255,.15);color:#fff;}
.${PFX}-mini-danger{background:rgba(255,107,107,.12);color:#ff9494;}
.${PFX}-mini-danger:hover{background:rgba(255,107,107,.25)!important;color:#ffb3b3!important;}
.${PFX}-about{font-size:12px;color:#69707f;line-height:1.8;margin-top:4px;}
.${PFX}-about b{color:#9fb0e8;font-weight:600;}
/* ---------- 贴墙窗口 ---------- */
.${PFX}-wall{width:min(320px,calc(100vw - 16px));height:min(380px,calc(100vh - 90px));height:min(380px,calc(100dvh - 90px));z-index:99989;}
.${PFX}-wall .${PFX}-wall-head{
  flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:9px 9px 0 12px;
  cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
}
.${PFX}-wall-title{flex:1;min-width:0;font-size:14px;font-weight:700;color:#eef0f6;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${PFX}-wall-body{flex:1;min-height:0;padding:8px 10px 10px;display:flex;}
.${PFX}-wall-body .${PFX}-ta{flex:1;max-height:none;resize:none;}
/* ---------- 缩放手柄 ---------- */
.${PFX}-resize{
  position:absolute;right:0;bottom:0;width:22px;height:22px;z-index:6;
  cursor:nwse-resize;touch-action:none;user-select:none;-webkit-user-select:none;
}
.${PFX}-resize::before{
  content:'';position:absolute;right:5px;bottom:5px;
  border-style:solid;border-width:0 0 11px 11px;
  border-color:transparent transparent rgba(255,255,255,.32) transparent;
  transition:border-color .15s;
}
.${PFX}-resize:hover::before{border-color:transparent transparent rgba(160,175,255,.85) transparent;}
/* ---------- Toast ---------- */
.${PFX}-toasts{
  position:fixed;top:14px;top:max(14px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);
  z-index:99999;display:flex;flex-direction:column;align-items:center;gap:8px;
  pointer-events:none;
}
.${PFX}-toast{
  display:flex;align-items:center;gap:10px;max-width:min(78vw,420px);
  background:rgba(28,30,40,.95);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:#eef0f6;font-size:13.5px;font-weight:500;
  border:1px solid rgba(255,255,255,.12);border-radius:99px;
  padding:9px 18px;box-shadow:0 8px 28px rgba(0,0,0,.45);
  animation:${PFX}toastIn .22s cubic-bezier(.2,.9,.3,1.2);
  pointer-events:auto;cursor:pointer; /* 单击提示可立即关闭 */
}
@keyframes ${PFX}toastIn{from{opacity:0;transform:translateY(-14px) scale(.92);}to{opacity:1;transform:none;}}
.${PFX}-toast-out{opacity:0;transform:translateY(-10px);transition:all .2s ease;}
.${PFX}-toast-success{border-color:rgba(120,220,150,.35);}
.${PFX}-toast-success .${PFX}-toast-msg::before{content:'✓ ';color:#7de29a;font-weight:700;}
.${PFX}-toast-error .${PFX}-toast-msg::before{content:'✕ ';color:#ff8080;font-weight:700;}
.${PFX}-toast-btn{
  border:0;background:linear-gradient(135deg,#5b8cff,#9a6bff);color:#fff;font-size:12.5px;font-weight:700;
  border-radius:99px;padding:4px 12px;cursor:pointer;flex:0 0 auto;touch-action:manipulation;
}
`;

  // ---------------------------------------------------------------- 拖动工具
  /**
   * 让元素可通过 handle 用鼠标/触摸拖动 (Pointer Events 统一处理)
   * @param el 被移动的元素 (position:fixed)
   * @param handle 拖动柄
   * @param opts.onClick 未发生拖动时的点击回调 (用于悬浮球)
   * @param opts.onEnd 拖动结束回调 (参数 x,y 为最终视口坐标)
   * @param opts.mode 'free' 完整限制在视口内 | 'partial' 只需保留部分可见
   */
  function makeDraggable(elx, handle, opts = {}) {
    const { onClick, onEnd, mode = 'partial' } = opts;
    let sx = 0, sy = 0, ox = 0, oy = 0, pid = null, moved = false;

    const clampPos = (x, y) => {
      const w = elx.offsetWidth, h = elx.offsetHeight;
      if (mode === 'free') {
        return [Math.min(Math.max(x, 6), VW() - w - 6), Math.min(Math.max(y, 6), VH() - h - 6)];
      }
      return [
        Math.min(Math.max(x, 66 - w), VW() - 66),
        Math.min(Math.max(y, 2), VH() - Math.min(h, 46)),
      ];
    };
    elx.__tsutieClamp = () => {
      const r = elx.getBoundingClientRect();
      const [x, y] = clampPos(r.left, r.top);
      elx.style.left = `${Math.round(x)}px`;
      elx.style.top = `${Math.round(y)}px`;
    };
    elx.__tsutiePlace = (x, y) => {
      const [cx, cy] = clampPos(x, y);
      elx.style.left = `${Math.round(cx)}px`;
      elx.style.top = `${Math.round(cy)}px`;
    };

    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('[data-nodrag]')) return;
      pid = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      const r = elx.getBoundingClientRect();
      ox = r.left; oy = r.top;
      moved = false;
      // 注意: 此处不做 setPointerCapture / preventDefault ——
      // 立即捕获会把后续指针事件重定向到 handle, 导致浏览器把 click
      // 目标算成 handle 而不是 handle 里的按钮(标签页等)从而点击失效;
      // 立即 preventDefault 则会被部分移动浏览器(如 iOS Safari)吞掉 click。
      // 文本选中已由 handle 的 user-select:none 抑制。
    });
    handle.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      if (!moved) {
        moved = true;
        elx.classList.add(`${PFX}-dragging`);
        // 确认真的开始拖动了才捕获指针与阻止默认行为
        try { handle.setPointerCapture(pid); } catch (_) { /* noop */ }
        try { e.preventDefault(); } catch (_) { /* noop */ }
      }
      elx.__tsutiePlace(ox + dx, oy + dy);
    });
    const end = (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      elx.classList.remove(`${PFX}-dragging`);
      if (moved) {
        const r = elx.getBoundingClientRect();
        onEnd && onEnd(r.left, r.top);
      } else if (onClick) {
        onClick(e);
      }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- 缩放工具
  /**
   * 给窗口右下角添加可拖拽的缩放手柄 (鼠标/触摸统一)
   * @param elx 窗口元素 (position:fixed)
   * @param opts.onEnd 结束回调 (w,h 为最终尺寸)
   */
  function makeResizable(elx, opts = {}) {
    const { onEnd } = opts;
    const grip = el('div', `${PFX}-resize`);
    grip.title = '拖动调整大小';
    elx.appendChild(grip);

    let sx = 0, sy = 0, sw = 0, sh = 0, pid = null;
    let curW = 0, curH = 0, resized = false;
    grip.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pid = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      sw = elx.offsetWidth; sh = elx.offsetHeight;
      curW = sw; curH = sh; resized = false;
      try { grip.setPointerCapture(pid); } catch (_) { /* noop */ }
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!resized && Math.hypot(dx, dy) < 4) return;
      resized = true;
      elx.classList.add(`${PFX}-dragging`);
      const r = elx.getBoundingClientRect();
      const maxW = Math.max(200, VW() - r.left - 8);
      const maxH = Math.max(160, VH() - r.top - 8);
      curW = Math.round(Math.min(Math.max(sw + dx, MIN_W()), maxW));
      curH = Math.round(Math.min(Math.max(sh + dy, MIN_H()), maxH));
      elx.style.width = `${curW}px`;
      elx.style.height = `${curH}px`;
    });
    const end = (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      elx.classList.remove(`${PFX}-dragging`);
      // 记录移动过程中的最终尺寸, 不依赖结束时重新读取布局
      if (resized) onEnd && onEnd(curW, curH);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    return grip;
  }
  /** CSS 里声明的最小尺寸 (与 .tsutie-win 的 min-width/min-height 保持一致) */
  function MIN_W() { return 280; }
  function MIN_H() { return 230; }


  const roots = [];   // 所有注入主文档的元素, 便于清理
  function track(node) { roots.push(node); return node; }
  function cleanup() {
    flush();
    for (const n of roots.splice(0)) { try { n.remove(); } catch (_) { /* noop */ } }
    try { win().removeEventListener('resize', onHostResize); } catch (_) { /* noop */ }
    try { win().removeEventListener('keydown', onEscKey); } catch (_) { /* noop */ }
    walls.clear();
  }

  // ---------------------------------------------------------------- 悬浮球
  let ball = null;
  function buildBall() {
    if (doc().getElementById(`${PFX}-ball`)) doc().getElementById(`${PFX}-ball`).remove();
    ball = el('div', `${PFX}-ball`);
    ball.id = `${PFX}-ball`;
    ball.title = `${APP}`;
    ball.innerHTML = `<svg viewBox="0 0 24 24"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>`;
    track(ball);
    doc().body.appendChild(ball);

    makeDraggable(ball, ball, {
      mode: 'free',
      onClick: () => toggleApp(),
      onEnd: (x, y) => { state.settings.ballPos = { x: Math.round(x), y: Math.round(y) }; persist(); },
    });

    const p = state.settings.ballPos;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      ball.style.left = `${p.x}px`; ball.style.top = `${p.y}px`;
      ball.__tsutieClamp();
    } else {
      placeBallDefault();
    }
    applyBall();
  }
  /** 默认位置: 屏幕右侧垂直居中偏上。统一用 left/top 坐标放置,
   *  避免拖动残留的 left 与重置时设置的 right 冲突(CSS 中 left 优先)导致复位不生效 */
  function placeBallDefault() {
    if (state.settings.ballPos) return;
    const size = ball.offsetWidth || 46;
    ball.__tsutiePlace(VW() - size - 26, Math.round(VH() * 0.42));
  }
  function applyBall() {
    if (!ball) return;
    if (state.settings.showBall) {
      placeBallDefault();
      ball.style.display = 'flex';
    } else {
      ball.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------- 魔法棒(扩展)菜单入口
  /**
   * 在输入框旁的「扩展」按钮 (#extensionsMenuButton) 弹出的菜单里加入口。
   * 完全复用该菜单原生的 .list-group-item 结构 (fa-fw 图标 + span 文本), 外观与原生项完全一致。
   * 找不到容器时静默跳过, 不影响其他功能。
   */
  const MENU_ITEM_ID = `${PFX}-menu-item`;
  let menuHooked = false;
  function hookExtensionsMenu() {
    try {
      const btn = doc().getElementById('extensionsMenuButton');
      if (!btn) return;
      if (!menuHooked) {
        menuHooked = true;
        btn.addEventListener('click', () => setTimeout(injectMenuItem, 150));
      }
      injectMenuItem();
    } catch (_) { /* noop */ }
  }
  function findExtensionsMenu() {
    const btn = doc().getElementById('extensionsMenuButton');
    return doc().getElementById('extensionsMenu')
      || doc().querySelector('.extensions_menu')
      || (btn && btn.parentElement ? btn.parentElement.querySelector('.list-group') : null)
      || null;
  }
  function injectMenuItem() {
    try {
      if (!state) return;
      if (doc().getElementById(MENU_ITEM_ID)) return;
      const menu = findExtensionsMenu();
      if (!menu) return;
      const list = menu.querySelector('.list-group') || menu;
      const item = doc().createElement('div');
      item.id = MENU_ITEM_ID;
      item.className = 'list-group-item'; // 与原生条目同一 class, 外观完全一致
      item.title = '打开酒馆速贴';
      item.innerHTML = '<i class="fa-fw fa-solid fa-thumbtack"></i><span>酒馆速贴</span>';
      item.addEventListener('click', () => {
        toggleApp(true);
        // 扩展按钮是开关, 再点一次收起菜单
        try { doc().getElementById('extensionsMenuButton')?.click(); } catch (_) { /* noop */ }
      });
      track(item);
      list.appendChild(item);
    } catch (_) { /* noop */ }
  }

  // ---------------------------------------------------------------- 主窗口
  let appWin = null;
  const ui = {
    tab: 'copy',            // 当前板块 'copy' | 'notes'
    view: 'list',           // 'list' | 'editor' | 'settings'
    editing: null,          // {kind:'note'|'clip', id}
    searchClip: '',
    searchNote: '',
    editingClipId: null,    // 条目编辑模式(null=新建模式)
  };

  const ICONS = {
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  };

  function buildApp() {
    if (doc().getElementById(`${PFX}-app`)) doc().getElementById(`${PFX}-app`).remove();
    appWin = el('div', `${PFX}-win`);
    appWin.id = `${PFX}-app`;
    track(appWin);
    doc().body.appendChild(appWin);

    // --- 头部 ---
    const head = el('div', `${PFX}-head`);
    const tabs = el('div', `${PFX}-tabs`, null);
    // 标签页区域也作为拖动热区 (仅按钮本身排除), 移动端更好抓
    ui.tabBtnCopy = el('button', `${PFX}-tab`, '快捷复制');
    ui.tabBtnNotes = el('button', `${PFX}-tab`, '笔记');
    tabs.append(ui.tabBtnCopy, ui.tabBtnNotes);
    const btnGear = el('button', `${PFX}-hbtn`);
    btnGear.dataset.nodrag = '';
    btnGear.title = '设置';
    btnGear.innerHTML = ICONS.gear;
    const btnClose = el('button', `${PFX}-hbtn ${PFX}-hbtn-danger`);
    btnClose.dataset.nodrag = '';
    btnClose.title = '关闭';
    btnClose.innerHTML = ICONS.close;
    head.append(tabs, btnGear, btnClose);
    appWin.appendChild(head);

    // --- 主体 ---
    const body = el('div', `${PFX}-body`);
    appWin.appendChild(body);

    // ===== 快捷复制板块 =====
    const viewCopy = el('div', `${PFX}-view`);
    viewCopy.dataset.view = 'copy';

    const composer = el('div', `${PFX}-pad`);
    ui.clipTa = el('textarea', `${PFX}-ta ${PFX}-ta-oneline`);
    ui.clipTa.rows = 1;
    ui.clipTa.placeholder = '粘贴或输入要快速复制的内容…';
    const cFoot = el('div', `${PFX}-composer-foot`);
    const hint = el('span', `${PFX}-hint`, '点击条目即可复制');
    ui.clipSearchBtn = el('button', `${PFX}-iconbtn`);
    ui.clipSearchBtn.type = 'button';
    ui.clipSearchBtn.title = '搜索条目';
    ui.clipSearchBtn.innerHTML = ICONS.search;
    const cBtns = el('div', '', null);
    cBtns.style.cssText = 'display:flex;gap:7px;align-items:center;';
    ui.clipCancelBtn = el('button', `${PFX}-ghostbtn`, '取消');
    ui.clipCancelBtn.style.display = 'none';
    ui.clipSaveBtn = el('button', `${PFX}-primarybtn`, '创建条目');
    cBtns.append(ui.clipSearchBtn, ui.clipCancelBtn, ui.clipSaveBtn);
    cFoot.append(hint, cBtns);
    composer.append(ui.clipTa, cFoot);
    viewCopy.appendChild(composer);

    // 搜索行: 默认隐藏, 点放大镜后展开 (节省空间)
    const clipTools = el('div', `${PFX}-pad`);
    clipTools.style.paddingTop = '6px';
    clipTools.style.display = 'none';
    const clipBar = el('div', `${PFX}-toolbar`);
    ui.clipSearch = el('input', `${PFX}-input`);
    ui.clipSearch.type = 'text';
    ui.clipSearch.placeholder = '搜索条目…';
    ui.clipSearchClose = el('button', `${PFX}-ibtn`);
    ui.clipSearchClose.type = 'button';
    ui.clipSearchClose.title = '收起搜索';
    ui.clipSearchClose.innerHTML = ICONS.close;
    clipBar.append(ui.clipSearch, ui.clipSearchClose);
    clipTools.appendChild(clipBar);
    viewCopy.appendChild(clipTools);

    ui.clipList = el('div', `${PFX}-listwrap`);
    viewCopy.appendChild(ui.clipList);
    body.appendChild(viewCopy);

    // ===== 笔记板块 =====
    const viewNotes = el('div', `${PFX}-view`);
    viewNotes.dataset.view = 'notes';
    const noteTools = el('div', `${PFX}-pad`);
    noteTools.style.paddingTop = '12px';
    const noteBar = el('div', `${PFX}-toolbar`);
    ui.noteSearch = el('input', `${PFX}-input`);
    ui.noteSearch.type = 'text';
    ui.noteSearch.placeholder = '搜索笔记…';
    const newBtn = el('button', `${PFX}-newbtn`, '+ 新建笔记');
    newBtn.dataset.nodrag = '';
    newBtn.type = 'button';
    noteBar.append(ui.noteSearch, newBtn);
    noteTools.appendChild(noteBar);
    viewNotes.appendChild(noteTools);

    ui.noteList = el('div', `${PFX}-listwrap`);
    viewNotes.appendChild(ui.noteList);
    body.appendChild(viewNotes);

    // ===== 编辑器 (笔记/条目共用) =====
    const viewEdit = el('div', `${PFX}-view`);
    viewEdit.dataset.view = 'editor';
    const edHead = el('div', `${PFX}-edhead`);
    const backBtn = el('button', `${PFX}-backbtn`, '‹');
    backBtn.dataset.nodrag = '';
    backBtn.title = '返回';
    ui.edTitleLabel = el('div', `${PFX}-edtitle`, '笔记');
    edHead.append(backBtn, ui.edTitleLabel);
    viewEdit.appendChild(edHead);

    const edBody = el('div', `${PFX}-edbody`);
    ui.edTitleInput = el('input', `${PFX}-input`);
    ui.edTitleInput.type = 'text';
    ui.edTitleInput.placeholder = '标题 (可不填)';
    ui.edContentTa = el('textarea', `${PFX}-ta ${PFX}-content-ta`);
    ui.edContentTa.placeholder = '在这里输入正文…';
    edBody.append(ui.edTitleInput, ui.edContentTa);
    viewEdit.appendChild(edBody);

    const edFoot = el('div', `${PFX}-edfoot`);
    ui.edDeleteBtn = el('button', `${PFX}-ghostbtn ${PFX}-danger-text`, '删除');
    ui.edDeleteBtn.type = 'button';
    ui.edConfirmBtn = el('button', `${PFX}-primarybtn`, '确认');
    ui.edConfirmBtn.type = 'button';
    edFoot.append(ui.edDeleteBtn, ui.edConfirmBtn);
    viewEdit.appendChild(edFoot);
    body.appendChild(viewEdit);

    // ===== 设置 =====
    const viewSettings = el('div', `${PFX}-view`);
    viewSettings.dataset.view = 'settings';
    const setWrap = el('div', `${PFX}-setwrap`);

    setWrap.appendChild(el('div', `${PFX}-sethead`, '常规'));
    const rowTab = el('div', `${PFX}-setrow`);
    rowTab.append(labelCol('默认板块', '点击悬浮球或入口后先打开的板块'));
    const seg = el('div', `${PFX}-seg`);
    ui.segCopy = el('button', `${PFX}-segb`, '快捷复制');
    ui.segNotes = el('button', `${PFX}-segb`, '笔记');
    seg.append(ui.segCopy, ui.segNotes);
    rowTab.appendChild(seg);
    setWrap.appendChild(rowTab);

    setWrap.appendChild(rowSwitch('showBall', '屏幕上的圆形快捷球, 可拖动到任意位置'));

    setWrap.appendChild(el('div', `${PFX}-sethead`, '数据'));
    const rowData = el('div', `${PFX}-setrow`);
    rowData.style.flexDirection = 'column';
    rowData.style.alignItems = 'stretch';
    const dataLabel = labelCol('备份与恢复', '导出/导入 JSON 备份; 清空不可恢复');
    dataLabel.style.marginBottom = '9px';
    rowData.appendChild(dataLabel);
    const btnRow = el('div', `${PFX}-btnrow`);
    ui.btnExport = el('button', `${PFX}-mini`, '导出');
    ui.btnImport = el('button', `${PFX}-mini`, '导入');
    ui.btnClear = el('button', `${PFX}-mini ${PFX}-mini-danger`, '清空全部');
    btnRow.append(ui.btnExport, ui.btnImport, ui.btnClear);
    rowData.appendChild(btnRow);
    setWrap.appendChild(rowData);

    const rowReset = el('div', `${PFX}-setrow`);
    rowReset.append(labelCol('重置悬浮球位置', '把悬浮球放回屏幕右侧默认位置'));
    const resetBtn = el('button', `${PFX}-mini`, '重置');
    resetBtn.style.flex = '0 0 auto';
    resetBtn.addEventListener('click', () => {
      state.settings.ballPos = null;
      persist(); applyBall();
      toast('悬浮球已复位');
    });
    rowReset.appendChild(resetBtn);
    setWrap.appendChild(rowReset);

    const about = el('div', `${PFX}-about`);
    about.innerHTML = `<b>${APP}</b> v${VERSION}`;
    // 版本号钉在设置页底部, 避免内容变少后下方留白显得突兀
    about.style.marginTop = 'auto';
    about.style.borderTop = '1px solid rgba(255,255,255,.07)';
    about.style.paddingTop = '10px';
    setWrap.appendChild(about);
    viewSettings.appendChild(setWrap);
    body.appendChild(viewSettings);

    ui.views = { copy: viewCopy, notes: viewNotes, editor: viewEdit, settings: viewSettings };

    // --- 交互绑定 ---
    ui.tabBtnCopy.addEventListener('click', () => switchTab('copy'));
    ui.tabBtnNotes.addEventListener('click', () => switchTab('notes'));
    btnGear.addEventListener('click', () => { leaveEditor(); ui.view = 'settings'; renderView(); });
    btnClose.addEventListener('click', () => hideApp());
    backBtn.addEventListener('click', () => { leaveEditor(); ui.view = 'list'; renderView(); renderLists(); });
    ui.edDeleteBtn.addEventListener('click', () => deleteEditing());
    newBtn.addEventListener('click', () => openEditor('note'));

    ui.clipSaveBtn.addEventListener('click', () => submitComposer());
    ui.clipCancelBtn.addEventListener('click', () => exitClipEditMode());
    autosize(ui.clipTa, 150);
    ui.clipTa.addEventListener('input', () => autosize(ui.clipTa, 150));
    // 搜索: 默认收起, 点放大镜展开, ✕ 或 Esc 收起并清除过滤
    ui.clipSearchBtn.addEventListener('click', () => setClipSearchOpen(true));
    ui.clipSearchClose.addEventListener('click', () => setClipSearchOpen(false));
    // Esc 统一由全局 onEscKey 处理
    ui.clipSearch.addEventListener('input', () => { ui.searchClip = ui.clipSearch.value; renderClipList(); });
    ui.noteSearch.addEventListener('input', () => { ui.searchNote = ui.noteSearch.value; renderNoteList(); });

    // 列表事件委托
    ui.clipList.addEventListener('click', onClipListClick);
    ui.noteList.addEventListener('click', onNoteListClick);

    ui.edConfirmBtn.addEventListener('click', () => {
      commitEditing();
      leaveEditor();
      ui.view = 'list';
      renderView();
      renderLists();
    });

    // 设置控件
    ui.segCopy.addEventListener('click', () => setDefaultTab('copy'));
    ui.segNotes.addEventListener('click', () => setDefaultTab('notes'));
    bindSwitch('showBall', (v) => { state.settings.showBall = v; persist(); applyBall(); });
    ui.btnExport.addEventListener('click', exportData);
    ui.btnImport.addEventListener('click', importData);
    ui.btnClear.addEventListener('click', clearData);

    // 拖动 + 缩放
    makeDraggable(appWin, head, {
      mode: 'partial',
      onEnd: (x, y) => { state.settings.appPos = { x: Math.round(x), y: Math.round(y) }; persist(); },
    });
    makeResizable(appWin, {
      onEnd: (w, h) => {
        state.settings.appSize = { w, h };
        persist();
      },
    });
    applyAppSize();

    syncSeg();
    renderLists();
    renderView();
  }

  // ---- 设置面板辅助 ----
  function labelCol(text, desc) {
    const col = el('div', `${PFX}-setlabel`);
    col.appendChild(el('span', '', text));
    if (desc) col.appendChild(el('span', `${PFX}-setdesc`, desc));
    return col;
  }
  function rowSwitch(key, desc) {
    const row = el('div', `${PFX}-setrow`);
    row.append(labelCol(switchLabels[key], desc));
    const sw = el('label', `${PFX}-switch`);
    const input = doc().createElement('input');
    input.type = 'checkbox';
    input.checked = !!state.settings[key];
    input.setAttribute('data-tq-switch', key);
    sw.appendChild(input);
    sw.appendChild(el('span', `${PFX}-switch-track`));
    sw.appendChild(el('span', `${PFX}-switch-knob`));
    row.appendChild(sw);
    return row;
  }
  const switchLabels = { showBall: '悬浮球入口' };
  function bindSwitch(key, onChange) {
    const input = appWin.querySelector(`input[data-tq-switch="${key}"]`);
    if (!input) return;
    input.addEventListener('change', () => onChange(input.checked));
  }
  function syncSwitches() {
    for (const key of ['showBall']) {
      const input = appWin?.querySelector(`input[data-tq-switch="${key}"]`);
      if (input) input.checked = !!state.settings[key];
    }
  }
  function syncSeg() {
    const isNotes = state.settings.defaultTab === 'notes';
    ui.segCopy.classList.toggle(`${PFX}-active`, !isNotes);
    ui.segNotes.classList.toggle(`${PFX}-active`, isNotes);
  }
  function setDefaultTab(tab) {
    state.settings.defaultTab = tab;
    persist();
    syncSeg();
  }

  // ---- 打开 / 关闭 ----
  function applyAppSize() {
    const s = state.settings.appSize;
    if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) {
      appWin.style.width = `${Math.max(s.w, MIN_W())}px`;
      appWin.style.height = `${Math.max(s.h, MIN_H())}px`;
    }
  }
  function ensureAppPos() {
    if (state.settings.appPos) return;
    const w = appWin.offsetWidth || 430, h = appWin.offsetHeight || 600;
    const mobile = VW() <= 520;
    const x = mobile ? Math.round((VW() - w) / 2) : Math.round(VW() - w - 20);
    const y = mobile ? Math.round(VH() - h - 46) : 64;
    state.settings.appPos = { x, y };
  }
  function showApp() {
    ensureAppPos();
    appWin.__tsutiePlace(state.settings.appPos.x, state.settings.appPos.y);
    appWin.classList.add(`${PFX}-show`);
    leaveEditor();
    ui.tab = state.settings.defaultTab === 'notes' ? 'notes' : 'copy';
    ui.view = 'list';
    renderView();
    renderLists();
    syncSeg(); syncSwitches();
    syncComposerSize();
  }
  function hideApp() {
    appWin.classList.remove(`${PFX}-show`);
    const r = appWin.getBoundingClientRect();
    if (r.width > 0) { state.settings.appPos = { x: Math.round(r.left), y: Math.round(r.top) }; persist(); }
  }
  function toggleApp(forceOpen = false) {
    if (forceOpen || !appWin.classList.contains(`${PFX}-show`)) showApp();
    else hideApp();
  }
  function switchTab(tab) {
    ui.tab = tab;
    if (ui.view === 'editor' || ui.view === 'settings') { leaveEditor(); ui.view = 'list'; }
    renderView();
    renderLists();
    syncComposerSize();
  }
  /** 离开编辑器: 草稿模式下直接放弃未确认的改动 (只有「确认」才会保存) */
  function leaveEditor() {
    ui.editing = null;
  }

  // ---- 视图渲染 ----
  function renderView() {
    const views = ui.views;
    let target;
    if (ui.view === 'settings') {
      target = views.settings;
    } else if (ui.view === 'editor') {
      target = views.editor;
    } else {
      target = ui.tab === 'notes' ? views.notes : views.copy;
    }
    for (const v of Object.values(views)) v.classList.toggle(`${PFX}-view-show`, v === target);
    ui.tabBtnCopy.classList.toggle(`${PFX}-active`, ui.tab === 'copy' && ui.view === 'list');
    ui.tabBtnNotes.classList.toggle(`${PFX}-active`, ui.tab === 'notes' && ui.view === 'list');
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ---- 快捷复制列表 ----
  function sortedClips() {
    const kw = ui.searchClip.trim().toLowerCase();
    return [...state.clips]
      .sort((a, b) => b.updated - a.updated)
      .filter((c) => !kw || c.text.toLowerCase().includes(kw));
  }
  function renderClipList() {
    const list = sortedClips();
    ui.clipList.textContent = '';
    if (!list.length) {
      const empty = el('div', `${PFX}-empty`);
      empty.innerHTML = `<span class="${PFX}-empty-ico">📋</span>` +
        (ui.searchClip ? '没有匹配的条目' :
          '还没有快捷条目<br>把常用的句子粘贴到上方<br>点「创建条目」, 以后一键复制');
      ui.clipList.appendChild(empty);
      return;
    }
    for (const c of list) {
      const item = el('div', `${PFX}-item`);
      item.dataset.id = c.id;
      item.dataset.act = 'copy';
      item.title = '点击复制\n(铅笔编辑 / 垃圾桶删除)';
      const main = el('div', `${PFX}-item-main`);
      main.appendChild(el('div', `${PFX}-snip`, c.text.replace(/\n+/g, ' ')));
      item.appendChild(main);
      item.appendChild(el('span', `${PFX}-item-time`, fmtTime(c.updated)));
      const ibtns = el('div', `${PFX}-ibtns`);
      ibtns.dataset.nodrag = '';
      const bE = el('button', `${PFX}-ibtn`);
      bE.title = '编辑'; bE.innerHTML = ICONS.edit; bE.dataset.act = 'edit';
      const bD = el('button', `${PFX}-ibtn ${PFX}-ibtn-danger`);
      bD.title = '删除'; bD.innerHTML = ICONS.trash; bD.dataset.act = 'del';
      ibtns.append(bE, bD);
      item.appendChild(ibtns);
      ui.clipList.appendChild(item);
    }
  }
  async function onClipListClick(e) {
    const btn = e.target.closest('[data-act]');
    const item = e.target.closest(`.${PFX}-item`);
    if (!item) return;
    const clip = state.clips.find((c) => c.id === item.dataset.id);
    if (!clip) return;
    const act = btn ? btn.dataset.act : 'copy';
    if (act === 'copy') {
      const ok = await doCopy(clip.text);
      if (ok) toastCopied();
      else toast('复制失败, 请手动长按选择复制', { type: 'error', duration: 2600 });
    } else if (act === 'edit') {
      enterClipEditMode(clip.id);
    } else if (act === 'del') {
      deleteClip(clip.id);
    }
  }
  /** 展开/收起条目搜索框; 收起时清除过滤条件 */
  function setClipSearchOpen(open) {
    ui.clipSearchOpen = open;
    const row = ui.clipSearch.closest(`.${PFX}-pad`);
    if (row) row.style.display = open ? '' : 'none';
    if (open) {
      ui.clipSearch.focus();
    } else {
      ui.clipSearch.value = '';
      ui.searchClip = '';
      renderClipList();
    }
  }
  function enterClipEditMode(id) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return;
    ui.editingClipId = id;
    ui.clipTa.value = clip.text;
    ui.clipSaveBtn.textContent = '保存修改';
    ui.clipCancelBtn.style.display = '';
    const hintEl = ui.clipTa.parentNode.querySelector(`.${PFX}-hint`);
    if (hintEl) hintEl.style.display = 'none'; // 编辑模式按钮多, 隐藏提示避免拥挤
    autosize(ui.clipTa, 150);
    ui.tab = 'copy'; ui.view = 'list';
    renderView();
    ui.clipTa.focus();
  }
  function exitClipEditMode() {
    ui.editingClipId = null;
    ui.clipTa.value = '';
    ui.clipSaveBtn.textContent = '创建条目';
    ui.clipCancelBtn.style.display = 'none';
    const hintEl = ui.clipTa.parentNode.querySelector(`.${PFX}-hint`);
    if (hintEl) hintEl.style.display = '';
    autosize(ui.clipTa, 150);
  }
  function submitComposer() {
    const text = ui.clipTa.value.trim();
    if (!text) { toast('内容不能为空哦', { type: 'error' }); return; }
    const now = Date.now();
    let affectedId = null;
    if (ui.editingClipId) {
      const clip = state.clips.find((c) => c.id === ui.editingClipId);
      if (clip) { clip.text = text; clip.updated = now; affectedId = clip.id; }
      exitClipEditMode();
    } else {
      const clip = { id: uid(), text, created: now, updated: now };
      state.clips.unshift(clip);
      affectedId = clip.id;
      exitClipEditMode();
    }
    persist();
    renderClipList();
    if (affectedId) flashItem(ui.clipList, affectedId);
  }
  function deleteClip(id) {
    const idx = state.clips.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const [clip] = state.clips.splice(idx, 1);
    if (ui.editingClipId === id) exitClipEditMode();
    persist();
    renderClipList();
    const snippet = clip.text.length > 12 ? `${clip.text.slice(0, 12).replace(/\n/g, ' ')}…` : clip.text.replace(/\n/g, ' ');
    toast(`已删除「${snippet}」`, {
      type: 'info',
      action: '撤销',
      onAction: () => {
        state.clips.splice(Math.min(idx, state.clips.length), 0, clip);
        persist(); renderClipList();
      },
    });
  }
  function flashItem(container, id) {
    const node = container.querySelector(`[data-id="${id}"]`);
    if (node) node.classList.add(`${PFX}-flash`);
  }
  function autosize(ta, max = 180) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, max)}px`;
  }
  /** 输入框在 display:none 时 scrollHeight 为 0, 需在可见后再测一次高度 */
  function syncComposerSize() {
    if (ui.tab !== 'copy' || ui.view !== 'list') return;
    setTimeout(() => autosize(ui.clipTa, 150), 30);
  }

  // ---- 笔记列表 ----
  function sortedNotes() {
    const kw = ui.searchNote.trim().toLowerCase();
    return [...state.notes]
      .sort((a, b) => b.updated - a.updated)
      .filter((n) => !kw
        || (n.title || '').toLowerCase().includes(kw)
        || (n.content || '').toLowerCase().includes(kw));
  }
  function renderNoteList() {
    const list = sortedNotes();
    ui.noteList.textContent = '';
    if (!list.length) {
      const empty = el('div', `${PFX}-empty`);
      empty.innerHTML = `<span class="${PFX}-empty-ico">📝</span>` +
        (ui.searchNote ? '没有匹配的笔记' :
          '还没有笔记<br>点右上角「+ 新建笔记」开始记录<br>写好还能「贴墙」挂到酒坛上');
      ui.noteList.appendChild(empty);
      return;
    }
    for (const n of list) {
      const item = el('div', `${PFX}-item`);
      item.dataset.id = n.id;
      item.dataset.act = 'open';
      const main = el('div', `${PFX}-item-main`);
      const title = (n.title || '').trim();
      const content = (n.content || '').replace(/\s+/g, ' ').trim();
      if (title) {
        // 有标题: 标题一行 + 正文摘要一行
        main.appendChild(el('div', `${PFX}-item-title`, title));
        if (content) main.appendChild(el('div', `${PFX}-snip`, content));
      } else {
        // 无标题: 直接显示正文 (最多两行)
        main.appendChild(el('div', `${PFX}-snip ${PFX}-snip-2`, content || '(空白笔记)'));
      }
      item.appendChild(main);
      item.appendChild(el('span', `${PFX}-item-time`, fmtTime(n.updated)));
      const ibtns = el('div', `${PFX}-ibtns`);
      ibtns.dataset.nodrag = '';
      const bW = el('button', `${PFX}-ibtn${state.wallsOpen.includes(n.id) ? ` ${PFX}-ibtn-on` : ''}`);
      bW.title = state.wallsOpen.includes(n.id) ? '收起贴墙' : '贴墙';
      bW.innerHTML = ICONS.pin; bW.dataset.act = 'wall';
      const bD = el('button', `${PFX}-ibtn ${PFX}-ibtn-danger`);
      bD.title = '删除'; bD.innerHTML = ICONS.trash; bD.dataset.act = 'del';
      ibtns.append(bW, bD);
      item.appendChild(ibtns);
      ui.noteList.appendChild(item);
    }
  }
  function onNoteListClick(e) {
    const btn = e.target.closest('[data-act]');
    const item = e.target.closest(`.${PFX}-item`);
    if (!item) return;
    const act = btn ? btn.dataset.act : 'open';
    if (act === 'wall') {
      toggleWall(item.dataset.id);
      renderNoteList();
    } else if (act === 'del') {
      deleteNote(item.dataset.id);
    } else {
      openEditor('note', item.dataset.id);
    }
  }
  /** 打开笔记编辑器 (草稿模式: id 为空表示新笔记, 改动仅在输入框中, 点「确认」才写入数据) */
  function openEditor(kind, id) {
    if (kind === 'note') {
      if (id) {
        const note = state.notes.find((n) => n.id === id);
        if (!note) return;
        ui.editing = { kind: 'note', id };
        ui.edTitleLabel.textContent = '编辑笔记';
        ui.edTitleInput.value = note.title || '';
        ui.edContentTa.value = note.content || '';
      } else {
        ui.editing = { kind: 'note', id: null };
        ui.edTitleLabel.textContent = '新建笔记';
        ui.edTitleInput.value = '';
        ui.edContentTa.value = '';
        setTimeout(() => ui.edTitleInput.focus(), 120);
      }
    }
    ui.view = 'editor';
    renderView();
  }
  /** 「确认」: 把草稿写入数据并持久化; 返回是否发生了写入 */
  function commitEditing() {
    if (!ui.editing || ui.editing.kind !== 'note') return false;
    const title = ui.edTitleInput.value.trim();
    const content = ui.edContentTa.value;
    const now = Date.now();
    let note;
    if (ui.editing.id) {
      note = state.notes.find((n) => n.id === ui.editing.id);
      if (!note) return false;
      note.title = title;
      note.content = content;
      note.updated = now;
      refreshWall(note.id);
    } else {
      note = { id: uid(), title, content, created: now, updated: now };
      state.notes.unshift(note);
    }
    persist();
    renderNoteList();
    return true;
  }
  function deleteEditing() {
    if (!ui.editing || ui.editing.kind !== 'note') return;
    const id = ui.editing.id;
    if (!id) {
      // 还没保存过的新笔记草稿: 直接丢弃退出
      ui.editing = null;
      ui.view = 'list';
      renderView();
      renderLists();
      toast('已取消新建');
      return;
    }
    ui.view = 'list';
    ui.editing = null;
    renderView();
    deleteNote(id);
  }
  function deleteNote(id) {
    const idx = state.notes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const [note] = state.notes.splice(idx, 1);
    closeWall(id, { silent: true });
    if (ui.editing && ui.editing.kind === 'note' && ui.editing.id === id) {
      ui.editing = null; ui.view = 'list'; renderView();
    }
    persist();
    renderNoteList();
    const name = (note.title || '').trim()
      || (note.content || '').replace(/\s+/g, ' ').trim().slice(0, 12)
      || '空白笔记';
    toast(`已删除「${name.length > 12 ? `${name.slice(0, 12)}…` : name}」`, {
      type: 'info',
      action: '撤销',
      onAction: () => {
        state.notes.splice(Math.min(idx, state.notes.length), 0, note);
        persist(); renderNoteList();
      },
    });
  }
  function renderLists() {
    renderClipList();
    renderNoteList();
  }

  // ---- 数据导出/导入/清空 ----
  function armGuard(btn, confirmText, fn) {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      clearTimeout(+btn.dataset.timer);
      btn.textContent = btn.dataset.origin;
      fn();
      return;
    }
    btn.dataset.armed = '1';
    btn.dataset.origin = btn.textContent;
    btn.textContent = confirmText;
    btn.dataset.timer = String(setTimeout(() => {
      delete btn.dataset.armed;
      if (btn.isConnected) btn.textContent = btn.dataset.origin;
    }, 3000));
  }
  function exportData() {
    if (!state.clips.length && !state.notes.length) {
      toast('还没有条目或笔记, 无需导出', { type: 'error' });
      return;
    }
    try {
      const filename = `酒馆速贴备份_${new Date().toISOString().slice(0, 10)}.json`;
      const payload = { app: APP, version: VERSION, exportedAt: new Date().toISOString(), state: clone(state) };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc().createElement('a');
      a.href = url;
      a.download = filename;
      doc().body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 800);
      // 浏览器不向网页暴露真实磁盘路径, 只能告知文件名与默认下载位置
      toast(`已导出「${filename}」到浏览器默认下载文件夹`, {
        duration: 6000,
        action: '复制文件名',
        onAction: async () => {
          const ok = await doCopy(filename);
          toast(ok ? '文件名已复制' : '复制失败', { type: ok ? 'success' : 'error' });
        },
      });
    } catch (err) {
      warn(err); toast('导出失败', { type: 'error' });
    }
  }
  function importData() {
    const fi = doc().createElement('input');
    fi.type = 'file';
    fi.accept = '.json,application/json';
    fi.style.display = 'none';
    doc().body.appendChild(fi);
    fi.addEventListener('change', () => {
      const file = fi.files && fi.files[0];
      fi.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(String(reader.result));
          const incoming = payload.state || payload;
          if (!incoming || !Array.isArray(incoming.clips) || !Array.isArray(incoming.notes)) {
            throw new Error('不是有效的酒馆速贴备份');
          }
          state.clips = incoming.clips;
          state.notes = incoming.notes;
          if (incoming.settings) mergeInto(state.settings, incoming.settings);
          delete state.settings.showMenuEntry; // 旧备份残留的废弃设置
          state.wallsOpen = Array.isArray(incoming.wallsOpen) ? incoming.wallsOpen.filter((id) => state.notes.some((n) => n.id === id)) : [];
          persist();
          rebuildAllWalls();
          syncSeg(); syncSwitches(); applyBall();
          renderLists();
          toast(`导入成功: ${state.clips.length} 条目 / ${state.notes.length} 笔记`);
        } catch (err) {
          warn(err);
          toast(`导入失败: ${err.message}`, { type: 'error', duration: 3000 });
        }
      };
      reader.readAsText(file);
    });
    fi.click();
  }
  function clearData() {
    armGuard(ui.btnClear, '确认清空?', () => {
      state.clips = [];
      state.notes = [];
      state.wallsOpen = [];
      for (const id of [...walls.keys()]) closeWall(id, { silent: true });
      persist();
      renderLists();
      toast('已清空全部条目与笔记');
    });
  }

  // ---------------------------------------------------------------- 贴墙
  const walls = new Map();   // noteId -> {root, ta}
  function wallTitleOf(note) {
    const t = (note.title || '').trim();
    return t || (note.content || '').replace(/\s+/g, ' ').trim().slice(0, 14) || '空白笔记';
  }
  function openWall(id, opts = {}) {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;
    if (walls.has(id)) {
      if (!opts.silent) walls.get(id).ta.focus();
      return;
    }
    const root = el('div', `${PFX}-win ${PFX}-wall`);
    root.dataset.note = id;
    const head = el('div', `${PFX}-wall-head`);
    const titleEl = el('div', `${PFX}-wall-title`, `📌 ${wallTitleOf(note)}`);
    const btnClose = el('button', `${PFX}-hbtn ${PFX}-hbtn-danger`);
    btnClose.dataset.nodrag = '';
    btnClose.title = '收起贴墙';
    btnClose.innerHTML = ICONS.close;
    head.append(titleEl, btnClose);
    root.appendChild(head);

    const bodyBox = el('div', `${PFX}-wall-body`);
    const ta = el('textarea', `${PFX}-ta`);
    ta.placeholder = '这个贴墙是空的, 直接输入内容…';
    ta.value = note.content || '';
    bodyBox.appendChild(ta);
    root.appendChild(bodyBox);
    track(root);
    doc().body.appendChild(root);

    // 位置与尺寸: 优先用上次记忆, 否则级联排开
    const idx = walls.size;
    const defX = Math.round(Math.min(VW() - 340, 60 + idx * 30));
    const defY = Math.round(VH() * 0.18 + idx * 26);
    const saved = note.wallPos;
    root.style.left = `${saved && Number.isFinite(saved.x) ? saved.x : defX}px`;
    root.style.top = `${saved && Number.isFinite(saved.y) ? saved.y : defY}px`;
    if (note.wallSize && Number.isFinite(note.wallSize.w) && Number.isFinite(note.wallSize.h)) {
      root.style.width = `${Math.max(note.wallSize.w, MIN_W())}px`;
      root.style.height = `${Math.max(note.wallSize.h, MIN_H())}px`;
    }
    // 隐藏 iframe 中 requestAnimationFrame 可能被浏览器暂停, 用 setTimeout 代替
    setTimeout(() => root.__tsutieClamp(), 50);

    makeDraggable(root, head, {
      mode: 'partial',
      onEnd: (x, y) => {
        note.wallPos = { x: Math.round(x), y: Math.round(y) };
        persist();
      },
    });
    makeResizable(root, {
      onEnd: (w, h) => {
        note.wallSize = { w, h };
        persist();
      },
    });
    btnClose.addEventListener('click', () => closeWall(id));

    let timer = null;
    let listTimer = null;
    ta.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const cur = state.notes.find((n) => n.id === id);
        if (cur) {
          cur.content = ta.value;
          cur.updated = Date.now();
          persist();
          titleEl.textContent = `📌 ${wallTitleOf(cur)}`;
        }
      }, 400);
      clearTimeout(listTimer);
      listTimer = setTimeout(() => renderNoteList(), 900);
    });

    walls.set(id, { root, ta });
    if (!state.wallsOpen.includes(id)) { state.wallsOpen.push(id); persist(); }
    root.classList.add(`${PFX}-show`);
  }
  function closeWall(id, opts = {}) {
    const w = walls.get(id);
    if (w) {
      w.root.classList.remove(`${PFX}-show`);
      const node = w.root;
      setTimeout(() => node.remove(), 200);
      walls.delete(id);
    }
    const i = state.wallsOpen.indexOf(id);
    if (i >= 0) { state.wallsOpen.splice(i, 1); if (!opts.noPersist) persist(); }
    renderNoteList();
  }
  function toggleWall(id) {
    if (walls.has(id)) closeWall(id);
    else openWall(id);
  }
  /** 笔记在别处被修改后同步贴墙内容 (贴墙正在输入时不覆盖) */
  function refreshWall(id) {
    const w = walls.get(id);
    if (!w) return;
    const note = state.notes.find((n) => n.id === id);
    if (!note) { closeWall(id, { silent: true }); return; }
    if (doc().activeElement !== w.ta) {
      if (w.ta.value !== note.content) w.ta.value = note.content;
    }
    w.root.querySelector(`.${PFX}-wall-title`).textContent = `📌 ${wallTitleOf(note)}`;
  }
  function rebuildAllWalls() {
    for (const id of [...walls.keys()]) closeWall(id, { silent: true, noPersist: true });
    for (const id of state.wallsOpen) openWall(id, { silent: true });
  }
  function restoreWalls() {
    for (const id of [...state.wallsOpen]) {
      if (!state.notes.some((n) => n.id === id)) {
        state.wallsOpen = state.wallsOpen.filter((x) => x !== id);
      }
    }
    for (const id of state.wallsOpen) openWall(id, { silent: true });
  }

  // ---------------------------------------------------------------- 全局事件
  function onHostResize() {
    try {
      ball?.__tsutieClamp?.();
      appWin?.__tsutieClamp?.();
      // 视口变小(如手机旋转)时收缩窗口尺寸, 保证手柄/内容可达
      for (const node of [appWin, ...[...walls.values()].map((w) => w.root)]) {
        if (!node || !node.isConnected) continue;
        const r = node.getBoundingClientRect();
        if (r.width > VW() - 12) node.style.width = `${Math.round(VW() - 12)}px`;
        if (r.height > VH() - 24) node.style.height = `${Math.round(VH() - 24)}px`;
        node.__tsutieClamp?.();
      }
    } catch (_) { /* noop */ }
  }
  // ---------------------------------------------------------------- Esc 后退
  /** 在窗口内按 Esc 逐级后退: 收起搜索 → 退出编辑器 → 退出设置 */
  function onEscKey(e) {
    if (e.key !== 'Escape') return;
    const t = e.target;
    // 仅当事件发生在速贴自己的窗口内时才接管, 避免干扰酒馆原生界面
    if (!t || !t.closest || !t.closest(`.${PFX}-win`)) return;
    if (ui.view === 'list' && ui.tab === 'copy' && ui.clipSearchOpen) {
      setClipSearchOpen(false);
      e.preventDefault();
      return;
    }
    if (ui.view === 'editor') {
      leaveEditor();
      ui.view = 'list';
      renderView();
      renderLists();
      e.preventDefault();
      return;
    }
    if (ui.view === 'settings') {
      ui.view = 'list';
      renderView();
      renderLists();
      e.preventDefault();
    }
  }

  // ---------------------------------------------------------------- 启动
  function waitForTavern(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        try {
          if (doc().body && doc().getElementById('options_button')) return resolve(true);
        } catch (_) { /* noop */ }
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  function removeStaleInstance() {
    // 同一脚本重复启用/热重载时, 清掉上一次留在主页面的旧界面
    const selectors = [`#${PFX}-ball`, `#${PFX}-app`, `#${PFX}-style`, `#${PFX}-bar-btn`, `#${PFX}-option-item`, `#${MENU_ITEM_ID}`, `#${PFX}-toasts`];
    for (const sel of selectors) {
      try { doc().querySelector(sel)?.remove(); } catch (_) { /* noop */ }
    }
    try {
      for (const node of doc().querySelectorAll(`.${PFX}-wall`)) node.remove();
    } catch (_) { /* noop */ }
  }

  async function boot() {
    try {
      removeStaleInstance();
      await waitForTavern();
      state = loadState();

      track(toasts);
      doc().body.appendChild(toasts);

      injectStyle();
      buildApp();
      buildBall();
      hookExtensionsMenu();
      restoreWalls();

      win().addEventListener('resize', onHostResize);
      win().addEventListener('keydown', onEscKey);
      window.addEventListener('unload', cleanup);
      window.addEventListener('pagehide', cleanup);

      log(`v${VERSION} 已启动。悬浮球/魔法棒(扩展)菜单打开面板。`);
    } catch (err) {
      fatal(err);
    }
  }

  function injectStyle() {
    const old = doc().getElementById(`${PFX}-style`);
    if (old) old.remove();
    doc().head.appendChild(styleNode);
    track(styleNode);
  }

  boot();
})();
