import { Store }        from './src/store.js';
import { UIEngine }     from './src/ui-engine.js';
import { ActionRouter } from './src/action-router.js';
import { API }          from './src/api.js';

// ─── NLP Intent detection (быстрые команды без AI roundtrip) ──────────────
const INTENTS = [
    { re: /задач[аи]?[:：\s]+(.+)/i,    fn: (m) => Store.dispatch('ADD_TASK',    { title: m[1].trim() }) },
    { re: /расход[:：\s]+(\d[\d.,]*)/i,  fn: (m) => Store.dispatch('ADD_FINANCE', { tx_type: 'expense', amount: parseFloat(m[1].replace(',','.')), description: 'Расход', category: 'Прочее' }) },
    { re: /доход[:：\s]+(\d[\d.,]*)/i,   fn: (m) => Store.dispatch('ADD_FINANCE', { tx_type: 'income',  amount: parseFloat(m[1].replace(',','.')), description: 'Доход',  category: 'Прочее' }) },
    { re: /привычк[аи]?[:：\s]+(.+)/i,  fn: (m) => Store.dispatch('ADD_HABIT',   { name: m[1].trim() }) },
    { re: /цел[ьи]?[:：\s]+(.+)/i,      fn: (m) => Store.dispatch('ADD_GOAL',    { title: m[1].trim() }) },
    { re: /идея[:：\s]+(.+)/i,           fn: (m) => Store.dispatch('ADD_INBOX',   { title: m[1].trim(), type: 'idea' }) },
    { re: /заметка[:：\s]+(.+)/i,        fn: (m) => Store.dispatch('ADD_INBOX',   { title: m[1].trim(), type: 'note' }) },
    { re: /открыть?\s+(.+)/i,            fn: (m) => { const p = Store.state.projects.find(x => x.name.toLowerCase().includes(m[1].toLowerCase())); if (p) Store.dispatch('SET_VIEW', { view: 'cockpit', projectId: p.id }); } },
];

function detectIntent(cmd) {
    for (const intent of INTENTS) {
        const match = cmd.match(intent.re);
        if (match) { intent.fn(match); return true; }
    }
    return false;
}

async function handleCommand(cmd) {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    const inp = document.getElementById('global-action-input');
    if (inp) { inp.value = ''; inp.placeholder = 'Обработка…'; inp.disabled = true; }

    try {
        if (detectIntent(trimmed)) {
            window.uiToast?.('Выполнено', 's');
            return;
        }
        const res = await API.callAI(trimmed, Store.state);
        if (res?.action || res?.actions?.length) ActionRouter.routeAll(res);
        else if (res?.reply) window.uiToast?.(res.reply.slice(0, 80), 'i');
    } finally {
        if (inp) { inp.disabled = false; inp.placeholder = 'Командная строка…'; }
    }
}

// ─── Auth (PIN через SHA-256 hash) ────────────────────────────────────────
async function hashPin(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function doLogin() {
    const inp = document.getElementById('pin-inp');
    const err = document.getElementById('login-err');
    const pin = inp?.value || '';
    if (!pin) return;

    const expectedHash = window.__ENV?.PIN_HASH || '';
    if (expectedHash) {
        const h = await hashPin(pin);
        if (h !== expectedHash) { if (err) err.textContent = 'Неверный пин-код'; inp.value = ''; return; }
    }
    // В dev-режиме (нет PIN_HASH) любой пин разрешён
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').classList.add('on');
    await Store.initAuth();
    await Store.loadFromSupabase();
    UIEngine.init();

    // PWA: Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[SW] Register failed:', e));
    }

    // Предложить уведомления через toast с кнопкой
    if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => _showNotifToast(), 2000);
    }
}

function _showNotifToast() {
    const c = document.getElementById('toasts');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast i';
    const dot = document.createElement('div'); dot.className = 'toast-dot';
    const txt = document.createTextNode('Включить push-уведомления?');
    const btn = document.createElement('button');
    btn.className = 'toast-action-btn'; btn.textContent = 'Включить';
    btn.onclick = () => { Notification.requestPermission(); t.remove(); };
    const x = document.createElement('span'); x.className = 'toast-x'; x.textContent = '✕'; x.onclick = () => t.remove();
    t.append(dot, txt, btn, x);
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 10000);
}

window.doLogin = doLogin;

// ─── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const pinInp = document.getElementById('pin-inp');
    if (pinInp) pinInp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    const cmdInp = document.getElementById('global-action-input');
    if (cmdInp) cmdInp.addEventListener('keydown', e => { if (e.key === 'Enter') handleCommand(cmdInp.value); });
});

// Expose Store for inline HTML nav() helper (same instance as top-level import)
window.__store = Store;
