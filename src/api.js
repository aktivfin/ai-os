import { CONFIG } from './config.js';

function sanitize(s) { return typeof s === 'string' ? s.trim().slice(0, 2000) : ''; }

function safeCtx(state) {
    return {
        view: state.view,
        activeProjectId: state.activeProjectId,
        projects: state.projects.map(p => ({ id: p.id, name: p.name, type: p.type })),
        taskCount: state.tasks.filter(t => !t.done).length,
        balance: state.user.balance,
    };
}

async function fetchRetry(url, opts, tries = CONFIG.MAX_RETRIES) {
    for (let i = 0; i <= tries; i++) {
        try {
            const r = await fetch(url, opts);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } catch (e) {
            if (i === tries) throw e;
            await new Promise(r => setTimeout(r, 300 * 2 ** i));
        }
    }
}

export const API = {
    async callAI(prompt, state) {
        const p = sanitize(prompt);
        if (!p) return { action: null, reply: '' };
        try {
            return await fetchRetry(CONFIG.AI_PROXY, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: p, context: safeCtx(state) }),
            });
        } catch { return { action: 'error', reply: 'Нет связи с ядром.' }; }
    },

    async generateVideoPrompts(content, segCount = 5) {
        const prompt = `Раздели этот сценарий на ${segCount} сегментов по 6 секунд.\nДля каждого дай:\n1. Промт для изображения (English, detailed)\n2. Текст озвучки (русский)\n\nСценарий:\n${sanitize(content)}\n\nОтвет строго JSON массивом: [{"seg":1,"prompt":"...","voiceover":"..."},...]\nТолько JSON, без пояснений.`;
        try {
            const data = await fetchRetry(CONFIG.AI_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt }) });
            const raw = data.reply || '';
            const match = raw.match(/\[[\s\S]*\]/);
            return match ? JSON.parse(match[0]) : null;
        } catch { return null; }
    },

    async generateImages(prompt, state) {
        const p = sanitize(prompt);
        try {
            return await fetchRetry(CONFIG.AI_PROXY, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: `Generate image: ${p}`, type: 'image', context: safeCtx(state) }),
            });
        } catch { return { error: 'Ошибка генерации' }; }
    },

    async analyzeMusic(text, state) {
        const prompt = `Проанализируй этот трек/текст: ${sanitize(text)}\nОпредели: жанр, настроение, BPM (примерно), тональность, целевая аудитория.\nОтвет JSON: {"genre":"...","mood":"...","bpm":120,"key":"Am","audience":"...","tips":["..."]}\nТолько JSON.`;
        try {
            const data = await fetchRetry(CONFIG.AI_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt }) });
            const raw = data.reply || '{}';
            const match = raw.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : { genre: '—', mood: '—', bpm: '—', key: '—', audience: '—', tips: [] };
        } catch { return null; }
    },

    async getFinanceInsight(finances) {
        const income = finances.filter(f => f.tx_type === 'income').reduce((s, f) => s + Number(f.amount), 0);
        const expense = finances.filter(f => f.tx_type === 'expense').reduce((s, f) => s + Number(f.amount), 0);
        const cats = {};
        finances.filter(f => f.tx_type === 'expense').forEach(f => { cats[f.category || 'Прочее'] = (cats[f.category || 'Прочее'] || 0) + Number(f.amount); });
        const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
        const prompt = `Доходы: ${income}₽, Расходы: ${expense}₽, Баланс: ${income - expense}₽. Топ категория расходов: ${top ? top[0] + ' ' + top[1] + '₽' : 'нет'}. Дай краткий финансовый совет в 2 предложения. Будь прямым.`;
        try {
            const data = await fetchRetry(CONFIG.AI_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt }) });
            return data.reply || '';
        } catch { return null; }
    },

    async extractTags(content) {
        const tags = ['финансы','задачи','маскоты','музыка','идеи','планирование','личное','работа','YouTube'];
        const prompt = `Проанализируй сообщение и выбери 1-3 подходящих тега из списка: ${tags.join(', ')}.\nСообщение: "${sanitize(content)}"\nОтвет строго JSON массивом строк: ["тег1","тег2"]\nТолько JSON, без пояснений.`;
        try {
            const data = await fetchRetry(CONFIG.AI_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt }) });
            const raw = data.reply || '[]';
            const match = raw.match(/\[[\s\S]*?\]/);
            const result = match ? JSON.parse(match[0]) : [];
            return Array.isArray(result) ? result.slice(0, 3) : [];
        } catch { return []; }
    },

    async loadYouTubeStats(state) {
        try {
            const data = await fetchRetry(CONFIG.AI_PROXY, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'youtube_stats', context: safeCtx(state) }),
            });
            return data;
        } catch { return null; }
    },
};

// ─── WebSocket ─────────────────────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;

export const WS = {
    connect(onMsg, onStatus) {
        if (!CONFIG.WS_URL) { onStatus(false, 'WS не настроен'); return; }
        clearTimeout(wsReconnectTimer);
        try {
            ws = new WebSocket(CONFIG.WS_URL);
            ws.onopen    = () => onStatus(true,  'WS подключён');
            ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch {} };
            ws.onclose   = () => { onStatus(false, 'WS отключён'); wsReconnectTimer = setTimeout(() => WS.connect(onMsg, onStatus), 5000); };
            ws.onerror   = () => { onStatus(false, 'WS ошибка'); };
        } catch { onStatus(false, 'WS недоступен'); }
    },
    send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); },
    disconnect() { clearTimeout(wsReconnectTimer); ws?.close(); ws = null; },
};
