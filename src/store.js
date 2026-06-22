import { CONFIG } from './config.js';

// ─── Supabase REST client ─────────────────────────────────────────────────
// Авторизация убрана полностью. Используем anon key напрямую.
// RLS отключён на всех таблицах (см. SQL в конце файла).
// Единственный пользователь системы — фильтрация по user_id не нужна.

export const sb = {
    async req(method, path, body) {
        if (!CONFIG.SUPABASE_URL) throw new Error('Supabase not configured');
        const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, {
            method,
            headers: {
                'apikey':        CONFIG.SUPABASE_KEY,
                'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
                'Content-Type':  'application/json',
                'Prefer':        method === 'POST' ? 'return=representation' : 'return=minimal',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!r.ok) throw new Error(await r.text());
        const text = await r.text();
        return text ? JSON.parse(text) : null;
    },
    get:    (p)    => sb.req('GET',    p),
    post:   (p, b) => sb.req('POST',   p, b),
    patch:  (p, b) => sb.req('PATCH',  p, b),
    delete: (p)    => sb.req('DELETE', p),
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const newUUID  = () => crypto.randomUUID();
const todayStr = () => new Date().toISOString().slice(0, 10);

// ─── Default state ────────────────────────────────────────────────────────

const DEFAULT_AGENTS = [
    { id: 'a1', name: 'Scribe',   role: 'Content Writer',  icon: '✍', status: 'idle',    task: '' },
    { id: 'a2', name: 'Vision',   role: 'Image Generator', icon: '◎', status: 'idle',    task: '' },
    { id: 'a3', name: 'Analyst',  role: 'Data Analyst',    icon: '▦', status: 'idle',    task: '' },
    { id: 'a4', name: 'Director', role: 'Video Pipeline',  icon: '▷', status: 'working', task: 'Mascot Production — render queue' },
    { id: 'a5', name: 'Harmony',  role: 'Music AI',        icon: '♫', status: 'idle',    task: '' },
];

const DEFAULT_PIPELINE = [
    { id: 'concept', name: 'Генерация концепции',   status: 'done',   output: 'Cyberpunk Fox', items: [] },
    { id: 'script',  name: 'Стратегический скрипт', status: 'active', output: null,            items: [] },
    { id: 'images',  name: 'Генерация изображений', status: 'locked', output: null,            items: [] },
    { id: 'video',   name: 'Монтаж и экспорт',      status: 'locked', output: null,            items: [] },
];

const DEFAULT_STATE = {
    view: 'dashboard',
    activeProjectId: null,
    taskFilter: 'all',
    taskView: 'list',
    scriptFilter: 'all',
    activeScriptId: null,
    cockpitTab: 'pipeline',
    wsConnected: false,
    user: { name: 'Operator', balance: 0, efficiency: 87, exp: 2450 },
    projects:  [],
    tasks:     [],
    inbox:     [],   // localStorage only (нет таблицы в БД)
    habits:    [],
    finances:  [],
    goals:     [],   // localStorage only (нет таблицы в БД)
    scripts:   [],
    agents:    DEFAULT_AGENTS,
    pipeline:  DEFAULT_PIPELINE,
    images:    [],
    ytStats:   null,
    musicData: null,
    chatHistory: [],
    chatTagFilter: null,
    finInsight:  null,
    calView:       'week',
    calOffset:     0,
    calSelectedDay: null,
    healthTab:     'workouts',
    studioTab:     'scripts',
    financesTab:   'overview',
    workouts:      [],
    nutritionLogs: [],
    nutritionGoal: { calories: 2000, protein: 100, fat: 60, carbs: 250 },
    workoutWeekGoal: 3,
    focusSessions: [],
    agentFeed: [],  // активность агентов — хранится 7 дней
    lifeFeed:  [],  // активность пользователя — хранится 30 дней
};

// ─── Reducers ─────────────────────────────────────────────────────────────

const R = {
    SET_VIEW:          (s, { view, projectId }) => ({ ...s, view, activeProjectId: projectId ?? s.activeProjectId }),
    SET_TASK_FILTER:   (s, { filter }) => ({ ...s, taskFilter: filter }),
    SET_TASK_VIEW:     (s, { view })   => ({ ...s, taskView: view }),
    SET_SCRIPT_FILTER: (s, { filter }) => ({ ...s, scriptFilter: filter }),
    SET_ACTIVE_SCRIPT: (s, { id })     => ({ ...s, activeScriptId: id }),
    SET_COCKPIT_TAB:   (s, { tab })    => ({ ...s, cockpitTab: tab }),
    SET_WS:            (s, { connected }) => ({ ...s, wsConnected: connected }),
    SET_YT_STATS:      (s, { stats }) => ({ ...s, ytStats: stats }),
    SET_MUSIC_DATA:    (s, { data })  => ({ ...s, musicData: data }),
    SET_FIN_INSIGHT:   (s, { text })  => ({ ...s, finInsight: text }),
    ADD_IMAGE:         (s, img)       => ({ ...s, images: [{ id: newUUID(), ...img }, ...s.images] }),
    CLEAR_IMAGES:      (s)            => ({ ...s, images: [] }),
    ADD_CHAT_MSG: (s, msg) => {
        const newMsg = { id: newUUID(), ...msg, time: Date.now() };
        const chatHistory = [...s.chatHistory, newMsg];
        if (msg.role !== 'user' || (msg.content?.length || 0) < 20) return { ...s, chatHistory };
        const preview = msg.content.slice(0, 40);
        const feedEntry = {
            id: newUUID(), time: Date.now(), type: 'chat', icon: '💬',
            text: `Разговор с AI · «${preview}${msg.content.length > 40 ? '...' : ''}»`,
        };
        return { ...s, chatHistory, lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50) };
    },
    CLEAR_CHAT:        (s)            => ({ ...s, chatHistory: [] }),
    SET_CHAT_TAG_FILTER: (s, { filter }) => ({ ...s, chatTagFilter: filter }),
    STAR_CHAT_MSG:     (s, { id })    => ({ ...s, chatHistory: s.chatHistory.map(m => m.id !== id ? m : { ...m, starred: !m.starred }) }),
    UPDATE_MSG_TAGS:   (s, { id, tags }) => ({ ...s, chatHistory: s.chatHistory.map(m => m.id !== id ? m : { ...m, tags }) }),
    LOAD_ALL:          (s, data)      => ({ ...s, ...data }),

    ADD_TASK: (s, t) => {
        const task = { id: newUUID(), done: false, status: 'todo', source: 'manual', created_at: Date.now(), priority: 'med', project_id: null, ...t };
        const feedEntry = { id: newUUID(), time: Date.now(), type: 'task', icon: '📋', text: `Создана задача «${task.title}»` };
        return { ...s, tasks: [task, ...s.tasks], lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50) };
    },
    TOGGLE_TASK: (s, { id }) => {
        const task = s.tasks.find(t => t.id === id);
        const willDone = task && !task.done;
        const tasks = s.tasks.map(t => t.id !== id ? t : { ...t, done: !t.done, status: !t.done ? 'done' : 'todo', completed_at: !t.done ? new Date().toISOString().slice(0, 10) : null });
        if (!willDone) return { ...s, tasks };
        const feedEntry = { id: newUUID(), time: Date.now(), type: 'task', icon: '✅', text: `Выполнил «${task.title}»` };
        return { ...s, tasks, lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50) };
    },
    UPDATE_TASK: (s, { id, ...p }) => ({ ...s, tasks: s.tasks.map(t => t.id !== id ? t : { ...t, ...p }) }),
    DELETE_TASK: (s, { id }) => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) }),
    MOVE_TASK:   (s, { id, status }) => ({ ...s, tasks: s.tasks.map(t => t.id !== id ? t : { ...t, status, done: status === 'done' }) }),

    ADD_INBOX:    (s, item) => ({ ...s, inbox: [{ id: newUUID(), created_at: Date.now(), type: 'idea', ...item }, ...s.inbox] }),
    DELETE_INBOX: (s, { id }) => ({ ...s, inbox: s.inbox.filter(i => i.id !== id) }),
    INBOX_TO_TASK: (s, { id }) => {
        const item = s.inbox.find(i => i.id === id);
        if (!item) return s;
        return { ...s, inbox: s.inbox.filter(i => i.id !== id), tasks: [{ id: newUUID(), title: item.title, priority: 'med', done: false, status: 'todo', source: 'inbox', created_at: Date.now(), project_id: null }, ...s.tasks] };
    },

    ADD_HABIT:    (s, h) => ({ ...s, habits: [...s.habits, { id: newUUID(), streak: 0, today_done: false, icon: '✓', frequency: 'every_day', custom_days: [], ...h }] }),
    UPDATE_HABIT: (s, { id, ...p }) => ({ ...s, habits: s.habits.map(h => h.id !== id ? h : { ...h, ...p }) }),
    DELETE_HABIT: (s, { id }) => ({ ...s, habits: s.habits.filter(h => h.id !== id) }),
    TOGGLE_HABIT: (s, { id }) => {
        const habit = s.habits.find(h => h.id === id);
        const willDone = habit && !habit.today_done;
        const newStreak = habit ? (!habit.today_done ? (habit.streak || 0) + 1 : Math.max(0, (habit.streak || 0) - 1)) : 0;
        const habits = s.habits.map(h => h.id !== id ? h : { ...h, today_done: !h.today_done, streak: newStreak });
        if (!willDone) return { ...s, habits };
        const streakSuffix = newStreak > 1 ? ` · 🔥 ${newStreak} дней` : '';
        const feedEntry = { id: newUUID(), time: Date.now(), type: 'habit', icon: habit.icon || '↺', text: `«${habit.name}» отмечена${streakSuffix}` };
        return { ...s, habits, lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50) };
    },

    ADD_GOAL:    (s, g) => ({ ...s, goals: [{ id: newUUID(), done: false, deadline: null, created_at: Date.now(), ...g }, ...s.goals] }),
    TOGGLE_GOAL: (s, { id }) => ({ ...s, goals: s.goals.map(g => g.id !== id ? g : { ...g, done: !g.done }) }),
    DELETE_GOAL: (s, { id }) => ({ ...s, goals: s.goals.filter(g => g.id !== id) }),

    ADD_FINANCE: (s, f) => {
        const delta = f.tx_type === 'income' ? +Number(f.amount) : -Number(f.amount);
        const isIncome = f.tx_type === 'income';
        const amtStr = Math.round(Number(f.amount)).toLocaleString('ru-RU') + '₽';
        const feedEntry = {
            id: newUUID(), time: Date.now(), type: 'finance',
            icon: isIncome ? '💵' : '💰',
            text: `${isIncome ? 'Доход' : 'Расход'} ${amtStr}`,
            subtext: f.category && f.category !== 'Прочее' ? f.category : null,
        };
        return {
            ...s,
            finances: [{ id: newUUID(), tx_date: todayStr(), created_at: Date.now(), category: 'Прочее', project_id: null, ...f }, ...s.finances],
            user: { ...s.user, balance: s.user.balance + delta },
            lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50),
        };
    },
    DELETE_FINANCE: (s, { id }) => {
        const f = s.finances.find(x => x.id === id);
        const delta = f ? (f.tx_type === 'income' ? -Number(f.amount) : +Number(f.amount)) : 0;
        return { ...s, finances: s.finances.filter(x => x.id !== id), user: { ...s.user, balance: s.user.balance + delta } };
    },

    ADD_PROJECT:    (s, p) => ({ ...s, projects: [...s.projects, { id: newUUID(), is_archived: false, ...p }] }),
    UPDATE_PROJECT: (s, { id, ...p }) => ({ ...s, projects: s.projects.map(x => x.id !== id ? x : { ...x, ...p }) }),
    DELETE_PROJECT: (s, { id }) => ({ ...s, projects: s.projects.filter(p => p.id !== id) }),
    UPDATE_PROJECT_PARAM: (s, { id, key, value }) => ({ ...s, projects: s.projects.map(p => p.id !== id ? p : { ...p, custom_params: { ...(p.custom_params || {}), [key]: value } }) }),

    ADD_SCRIPT:    (s, sc) => ({ ...s, scripts: [{ id: newUUID(), source: 'manual', segments: [], created_at: Date.now(), body: '', project_id: null, ...sc }, ...s.scripts] }),
    UPDATE_SCRIPT: (s, { id, ...p }) => ({ ...s, scripts: s.scripts.map(sc => sc.id !== id ? sc : { ...sc, ...p }) }),
    DELETE_SCRIPT: (s, { id }) => ({ ...s, scripts: s.scripts.filter(sc => sc.id !== id), activeScriptId: s.activeScriptId === id ? null : s.activeScriptId }),
    SET_SCRIPT_SEGMENTS: (s, { id, segments }) => ({ ...s, scripts: s.scripts.map(sc => sc.id !== id ? sc : { ...sc, segments }) }),

    APPROVE_STEP: (s, { stepId }) => ({
        ...s, pipeline: s.pipeline.map((step, i, arr) => {
            if (step.id === stepId) return { ...step, status: 'done' };
            if (i > 0 && arr[i - 1].id === stepId && step.status === 'locked') return { ...step, status: 'active' };
            return step;
        }),
    }),
    ADD_PIPELINE_ITEM:    (s, { stepId, text })    => ({ ...s, pipeline: s.pipeline.map(st => st.id !== stepId ? st : { ...st, items: [...(st.items || []), { id: newUUID(), text, done: false }] }) }),
    TOGGLE_PIPELINE_ITEM: (s, { stepId, itemId }) => ({ ...s, pipeline: s.pipeline.map(st => st.id !== stepId ? st : { ...st, items: (st.items || []).map(it => it.id !== itemId ? it : { ...it, done: !it.done }) }) }),

    SET_AGENT: (s, { id, ...p }) => {
        const agent = s.agents.find(a => a.id === id);
        const isFinishing = agent?.status === 'working' && p.status === 'idle';
        const agents = s.agents.map(a => a.id !== id ? a : { ...a, ...p });
        if (!isFinishing) return { ...s, agents };
        const feedEntry = {
            id: newUUID(), time: Date.now(), agent: agent.name, icon: agent.icon || '🤖',
            text: `${agent.name} завершил задачу${agent.task ? ` · «${agent.task.slice(0, 40)}»` : ''}`,
            actions: [{ label: 'Студия →', view: 'studio' }],
        };
        return { ...s, agents, agentFeed: [feedEntry, ...s.agentFeed].slice(0, 20) };
    },

    // ── calendar ──────────────────────────────────────────────────────────
    SET_CAL_VIEW:   (s, { view })   => ({ ...s, calView: view }),
    SET_CAL_OFFSET: (s, { offset }) => ({ ...s, calOffset: offset }),
    SET_CAL_DAY:    (s, { day })    => ({ ...s, calSelectedDay: day }),

    // Обновить дату дедлайна задачи (drag & drop в календаре)
    SET_TASK_DUE: (s, { id, due_date }) => ({ ...s, tasks: s.tasks.map(t => t.id !== id ? t : { ...t, due_date: due_date || null }) }),

    // ── health ────────────────────────────────────────────────────────────
    SET_HEALTH_TAB:       (s, { tab })  => ({ ...s, healthTab: tab }),
    SET_STUDIO_TAB:       (s, tab)     => ({ ...s, studioTab: tab }),
    SET_FINANCES_TAB:     (s, tab)     => ({ ...s, financesTab: tab }),
    SET_WORKOUT_WEEK_GOAL:(s, { goal }) => ({ ...s, workoutWeekGoal: goal }),
    SET_NUTRITION_GOAL:   (s, goal)     => ({ ...s, nutritionGoal: { ...s.nutritionGoal, ...goal } }),
    ADD_WORKOUT: (s, w) => {
        const workout = { id: newUUID(), date: w.date || todayStr(), created_at: Date.now(), ...w };
        const workoutDate = workout.date;
        const today = todayStr();
        let habits = s.habits;
        if (workoutDate === today) {
            const workoutHabit = s.habits.find(h => /тренир|workout|gym|sport|фитнес/i.test(h.name) && !h.today_done);
            if (workoutHabit) {
                habits = s.habits.map(h => h.id !== workoutHabit.id ? h : { ...h, today_done: true, streak: h.streak + 1 });
            }
        }
        const exCount = (w.exercises || []).length;
        const feedEntry = {
            id: newUUID(), time: Date.now(), type: 'workout', icon: '💪',
            text: `Тренировка${w.type ? ` · ${w.type}` : ''}`,
            subtext: exCount ? `${exCount} упражнений` : null,
        };
        return { ...s, workouts: [workout, ...s.workouts], habits, lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50) };
    },
    DELETE_WORKOUT: (s, { id }) => ({ ...s, workouts: s.workouts.filter(w => w.id !== id) }),
    ADD_NUTRITION: (s, n) => {
        const entry = { id: newUUID(), date: todayStr(), created_at: Date.now(), ...n };
        const feedEntry = {
            id: newUUID(), time: Date.now(), type: 'nutrition', icon: '🥗',
            text: `Приём пищи · «${n.name}»`,
            subtext: n.calories ? `${n.calories} ккал` : null,
        };
        return { ...s, nutritionLogs: [entry, ...s.nutritionLogs], lifeFeed: [feedEntry, ...s.lifeFeed].slice(0, 50) };
    },
    DELETE_NUTRITION: (s, { id }) => ({ ...s, nutritionLogs: s.nutritionLogs.filter(n => n.id !== id) }),

    ADD_FOCUS_SESSION: (s, sess) => ({ ...s, focusSessions: [{ id: newUUID(), created_at: Date.now(), ...sess }, ...s.focusSessions] }),

    ADD_AGENT_FEED: (s, item) => ({ ...s, agentFeed: [{ id: newUUID(), time: Date.now(), ...item }, ...s.agentFeed].slice(0, 20) }),
    ADD_LIFE_FEED:  (s, item) => ({ ...s, lifeFeed:  [{ id: newUUID(), time: Date.now(), ...item }, ...s.lifeFeed ].slice(0, 50) }),
};

// ─── Supabase sync (async, не блокирует UI) ───────────────────────────────

async function syncToSupabase(action, payload, state) {
    if (!CONFIG.SUPABASE_URL) return;
    try {
        switch (action) {

            // ── tasks ──────────────────────────────────────────────────────
            case 'ADD_TASK': {
                const t = state.tasks[0];
                await sb.post('tasks', {
                    id: t.id, title: t.title,
                    priority: t.priority, status: t.status, done: t.done,
                    source: t.source, project_id: t.project_id || null,
                    due_date: t.due_date || null,
                });
                break;
            }
            case 'TOGGLE_TASK':
            case 'UPDATE_TASK':
            case 'MOVE_TASK': {
                const t = state.tasks.find(x => x.id === payload.id);
                if (t) await sb.patch(`tasks?id=eq.${t.id}`, { done: t.done, status: t.status, priority: t.priority, title: t.title, due_date: t.due_date || null });
                break;
            }
            case 'SET_TASK_DUE': {
                const t = state.tasks.find(x => x.id === payload.id);
                if (t) await sb.patch(`tasks?id=eq.${t.id}`, { due_date: t.due_date || null });
                break;
            }
            case 'DELETE_TASK':
                await sb.delete(`tasks?id=eq.${payload.id}`);
                break;
            case 'INBOX_TO_TASK': {
                const t = state.tasks[0];
                await sb.post('tasks', {
                    id: t.id, title: t.title,
                    priority: 'med', status: 'todo', done: false, source: 'inbox',
                });
                break;
            }

            // ── habits ─────────────────────────────────────────────────────
            case 'ADD_HABIT': {
                const h = state.habits[state.habits.length - 1];
                // custom_days колонки нет в таблице — не включаем в INSERT
                await sb.post('habits', { id: h.id, name: h.name, icon: h.icon, streak: 0, today_done: false, frequency: h.frequency || 'every_day' });
                break;
            }
            case 'UPDATE_HABIT': {
                const h = state.habits.find(x => x.id === payload.id);
                // custom_days колонки нет в таблице — не включаем в PATCH
                if (h) await sb.patch(`habits?id=eq.${h.id}`, { name: h.name, icon: h.icon, frequency: h.frequency });
                break;
            }
            case 'TOGGLE_HABIT': {
                const h = state.habits.find(x => x.id === payload.id);
                if (!h) break;
                await sb.patch(`habits?id=eq.${h.id}`, { today_done: h.today_done, streak: h.streak });
                if (h.today_done) {
                    await sb.post('habit_logs', { habit_id: h.id, log_date: todayStr(), done: true });
                } else {
                    await sb.delete(`habit_logs?habit_id=eq.${h.id}&log_date=eq.${todayStr()}`);
                }
                break;
            }
            case 'DELETE_HABIT':
                await sb.delete(`habits?id=eq.${payload.id}`);
                break;

            // ── finances ───────────────────────────────────────────────────
            case 'ADD_FINANCE': {
                const f = state.finances[0];
                await sb.post('finance_transactions', {
                    id: f.id,
                    tx_type: f.tx_type, amount: Number(f.amount), currency: 'RUB',
                    description: f.description || f.desc || null,
                    category: f.category || 'Прочее',
                    tx_date: f.tx_date || todayStr(),
                    project_id: f.project_id || null,
                    is_recurring: f.is_recurring || false,
                    recurrence_day: f.recurrence_day || null,
                });
                break;
            }
            case 'DELETE_FINANCE':
                await sb.delete(`finance_transactions?id=eq.${payload.id}`);
                break;

            // ── projects ───────────────────────────────────────────────────
            case 'ADD_PROJECT': {
                const p = state.projects[state.projects.length - 1];
                await sb.post('projects', { id: p.id, name: p.name, type: p.type || 'other', icon: p.icon || null });
                break;
            }
            case 'UPDATE_PROJECT':
            case 'UPDATE_PROJECT_PARAM': {
                const p = state.projects.find(x => x.id === payload.id);
                if (p) await sb.patch(`projects?id=eq.${p.id}`, { name: p.name, type: p.type, icon: p.icon });
                break;
            }
            case 'DELETE_PROJECT':
                await sb.patch(`projects?id=eq.${payload.id}`, { is_archived: true });
                break;

            // ── scripts ────────────────────────────────────────────────────
            case 'ADD_SCRIPT': {
                const sc = state.scripts[0];
                await sb.post('scripts', {
                    id: sc.id, title: sc.title,
                    body: sc.body || '', source: sc.source || 'manual',
                    project_id: sc.project_id || null,
                });
                break;
            }
            case 'UPDATE_SCRIPT':
            case 'SET_SCRIPT_SEGMENTS': {
                const sc = state.scripts.find(x => x.id === payload.id);
                if (sc) await sb.patch(`scripts?id=eq.${sc.id}`, { title: sc.title, body: sc.body || '' });
                break;
            }
            case 'DELETE_SCRIPT':
                await sb.delete(`scripts?id=eq.${payload.id}`);
                break;

            // ── chat_messages ──────────────────────────────────────────────
            case 'ADD_CHAT_MSG': {
                const msg = state.chatHistory[state.chatHistory.length - 1];
                if (msg?.id) {
                    // chat_role ENUM: 'user' и 'ai' — 'assistant' не валиден
                    const dbRole = msg.role === 'assistant' ? 'ai' : msg.role;
                    await sb.post('chat_messages', {
                        id: msg.id,
                        role: dbRole,
                        content: msg.content,
                        tags: msg.tags || [],
                        is_important: msg.starred || false,
                    });
                }
                break;
            }
            case 'STAR_CHAT_MSG': {
                const msg = state.chatHistory.find(m => m.id === payload.id);
                if (msg) await sb.patch(`chat_messages?id=eq.${msg.id}`, { is_important: msg.starred });
                break;
            }
            case 'UPDATE_MSG_TAGS': {
                const msg = state.chatHistory.find(m => m.id === payload.id);
                if (msg) await sb.patch(`chat_messages?id=eq.${msg.id}`, { tags: msg.tags });
                break;
            }

            // ── workouts ───────────────────────────────────────────────────
            case 'ADD_WORKOUT': {
                const w = state.workouts[0];
                await sb.post('workouts', { id: w.id, date: w.date, type: w.type, exercises: w.exercises || [] });
                break;
            }
            case 'DELETE_WORKOUT':
                await sb.delete(`workouts?id=eq.${payload.id}`);
                break;

            // ── nutrition_logs ─────────────────────────────────────────────
            case 'ADD_NUTRITION': {
                const n = state.nutritionLogs[0];
                await sb.post('nutrition_logs', { id: n.id, date: n.date, name: n.name, calories: n.calories || 0, protein: n.protein || 0, fat: n.fat || 0, carbs: n.carbs || 0 });
                break;
            }
            case 'DELETE_NUTRITION':
                await sb.delete(`nutrition_logs?id=eq.${payload.id}`);
                break;

            // ── focus_sessions ─────────────────────────────────────────────
            case 'ADD_FOCUS_SESSION': {
                const fs = state.focusSessions[0];
                if (fs) await sb.post('focus_sessions', {
                    id: fs.id,
                    started_at: fs.started_at,
                    ended_at: fs.ended_at,
                    planned_minutes: fs.planned_minutes,
                    actual_minutes: fs.actual_minutes,
                    tasks_completed: fs.tasks_completed || [],
                }).catch(() => {}); // graceful — таблица может не существовать
                break;
            }

            // goals, inbox — localStorage only, нет таблиц в БД
        }
    } catch (e) {
        console.error(`[Store] sync failed (${action}):`, e);
        if (action === 'ADD_HABIT' || action === 'UPDATE_HABIT') {
            window.uiToast?.(`Ошибка сохранения привычки: ${e.message}`, 'e');
        }
    }
}

// ─── Local persistence (fallback + goals/inbox) ───────────────────────────

function loadLocal() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return { ...DEFAULT_STATE };
        const saved = JSON.parse(raw);
        const now   = Date.now();
        const ms7d  = 7  * 86400000;
        const ms30d = 30 * 86400000;
        return {
            ...DEFAULT_STATE, ...saved,
            agents:   saved.agents?.length   ? saved.agents   : DEFAULT_AGENTS,
            pipeline: saved.pipeline?.length ? saved.pipeline : DEFAULT_PIPELINE,
            chatHistory: saved.chatHistory?.slice(-50) || [],
            ytStats: null, musicData: null, finInsight: null,
            calOffset: 0, calSelectedDay: null,
            // Очистка устаревших записей лент
            agentFeed: (saved.agentFeed || []).filter(e => now - (e.time || 0) < ms7d),
            lifeFeed:  (saved.lifeFeed  || []).filter(e => now - (e.time || 0) < ms30d),
        };
    } catch { return { ...DEFAULT_STATE }; }
}

function persistLocal(state) {
    try {
        const { ytStats, musicData, finInsight, ...save } = state;
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(save));
    } catch (e) { console.error('[Store] persist:', e); }
}

// ─── Store ────────────────────────────────────────────────────────────────

export const Store = {
    _state: loadLocal(),
    get state() { return this._state; },

    dispatch(action, payload = {}) {
        const reducer = R[action];
        if (!reducer) { console.warn(`[Store] Unknown: ${action}`); return; }
        this._state = reducer(this._state, payload);
        persistLocal(this._state);
        window.dispatchEvent(new CustomEvent('stateChange', { detail: { action } }));
        syncToSupabase(action, payload, this._state); // async, не блокирует
    },

    // Совместимость: initAuth больше не нужен, но оставлен чтобы не ломать main.js
    async initAuth() {},

    // Загрузить ВСЕ данные из Supabase (без фильтрации по user_id)
    async loadFromSupabase() {
        if (!CONFIG.SUPABASE_URL) return false;
        try {
            const today = todayStr();
            const [tasks, finances, habits, habitLogs, projects, scripts, chatMsgs, workouts, nutritionLogs] = await Promise.all([
                sb.get(`tasks?order=created_at.desc`),
                sb.get(`finance_transactions?order=created_at.desc`),
                sb.get(`habits`),
                sb.get(`habit_logs?log_date=eq.${today}`),
                sb.get(`projects?is_archived=eq.false&order=created_at.asc`),
                sb.get(`scripts?order=created_at.desc`),
                sb.get(`chat_messages?order=created_at.desc&limit=50`).catch(() => []),
                sb.get(`workouts?order=date.desc&limit=100`).catch(() => []),
                sb.get(`nutrition_logs?order=date.desc&limit=200`).catch(() => []),
            ]);

            // Баланс из транзакций
            const balance = (finances || []).reduce((sum, f) =>
                sum + (f.tx_type === 'income' ? +Number(f.amount) : -Number(f.amount)), 0);

            // today_done из habit_logs (не из поля habits.today_done — оно может быть устаревшим)
            const todayDone = new Set((habitLogs || []).map(l => l.habit_id));

            // Сохраняем completed_at из localStorage (не хранится в Supabase)
            const localCompletedAt = {};
            this._state.tasks.forEach(t => { if (t.completed_at) localCompletedAt[t.id] = t.completed_at; });

            this._state = {
                ...this._state,

                tasks: (tasks || []).map(t => ({
                    ...t,
                    created_at: t.created_at ? Date.parse(t.created_at) : Date.now(),
                    completed_at: localCompletedAt[t.id] || null,
                })),

                finances: (finances || []).map(f => ({
                    ...f,
                    created_at: f.created_at ? Date.parse(f.created_at) : Date.now(),
                })),

                habits: (habits || []).map(h => ({
                    ...h,
                    today_done: todayDone.has(h.id),
                })),

                goals:   this._state.goals,   // localStorage
                inbox:   this._state.inbox,   // localStorage

                projects: (projects || []).map(p => ({
                    ...p,
                    custom_params: p.custom_params || {},
                    modules: { analytics: true, finance: true },
                })),

                scripts: (scripts || []).map(sc => ({
                    ...sc,
                    segments: [],
                    created_at: sc.created_at ? Date.parse(sc.created_at) : Date.now(),
                })),

                user: { ...this._state.user, balance },

                chatHistory: (() => {
                    const fromSupabase = (chatMsgs || []).reverse().map(m => ({
                        id: m.id,
                        // Маппим 'ai' обратно в 'assistant' для совместимости с UI
                        role: m.role === 'ai' ? 'assistant' : m.role,
                        content: m.content,
                        tags: m.tags || [],
                        starred: m.is_important || false,
                        time: m.created_at ? Date.parse(m.created_at) : Date.now(),
                    }));
                    // If Supabase returned nothing (table missing / error), keep localStorage messages
                    return fromSupabase.length > 0 ? fromSupabase : (this._state.chatHistory || []);
                })(),

                workouts: (workouts || []).map(w => ({
                    ...w,
                    exercises: w.exercises || [],
                    created_at: w.created_at ? Date.parse(w.created_at) : Date.now(),
                })),

                nutritionLogs: (nutritionLogs || []).map(n => ({
                    ...n,
                    created_at: n.created_at ? Date.parse(n.created_at) : Date.now(),
                })),
            };

            console.log('[Store] Loaded from Supabase ✓', {
                tasks: tasks?.length, finances: finances?.length,
                habits: habits?.length, projects: projects?.length, chat: chatMsgs?.length,
            });
            return true;
        } catch (e) {
            console.error('[Store] Supabase load failed, using localStorage:', e.message);
            return false;
        }
    },

    reset() {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        this._state = { ...DEFAULT_STATE };
        window.dispatchEvent(new CustomEvent('stateChange', { detail: { action: 'RESET' } }));
    },
};

/*
 * ══════════════════════════════════════════════════════════════════════════
 * SUPABASE SQL — выполнить один раз в Dashboard → SQL Editor
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Отключаем RLS на всех таблицах — система однопользовательская,
 * авторизация не нужна. Anon key имеет полный доступ.
 *
 * ALTER TABLE tasks                DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE finance_transactions DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE habits               DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE habit_logs           DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE projects             DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE scripts              DISABLE ROW LEVEL SECURITY;
 *
 * Новые колонки для Календаря:
 * ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date date;
 * ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false;
 * ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS recurrence_day integer;
 *
 * Таблица для чата (создать если нет):
 * CREATE TABLE IF NOT EXISTS chat_messages (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   role TEXT NOT NULL,
 *   content TEXT,
 *   tags JSONB DEFAULT '[]',
 *   starred BOOLEAN DEFAULT false,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
 *
 * Расписание привычек:
 * ALTER TABLE habits ADD COLUMN IF NOT EXISTS frequency text DEFAULT 'every_day';
 * ALTER TABLE habits ADD COLUMN IF NOT EXISTS custom_days jsonb DEFAULT '[]';
 *
 * Здоровье — тренировки:
 * CREATE TABLE IF NOT EXISTS workouts (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   date DATE NOT NULL DEFAULT CURRENT_DATE,
 *   type TEXT,
 *   exercises JSONB DEFAULT '[]',
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * ALTER TABLE workouts DISABLE ROW LEVEL SECURITY;
 *
 * Здоровье — питание:
 * CREATE TABLE IF NOT EXISTS nutrition_logs (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   date DATE NOT NULL DEFAULT CURRENT_DATE,
 *   name TEXT NOT NULL,
 *   calories INTEGER DEFAULT 0,
 *   protein NUMERIC(6,1) DEFAULT 0,
 *   fat NUMERIC(6,1) DEFAULT 0,
 *   carbs NUMERIC(6,1) DEFAULT 0,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * ALTER TABLE nutrition_logs DISABLE ROW LEVEL SECURITY;
 *
 * Фокус-сессии:
 * CREATE TABLE IF NOT EXISTS focus_sessions (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   started_at TIMESTAMPTZ NOT NULL,
 *   ended_at TIMESTAMPTZ NOT NULL,
 *   planned_minutes INTEGER NOT NULL DEFAULT 90,
 *   actual_minutes INTEGER NOT NULL DEFAULT 0,
 *   tasks_completed JSONB DEFAULT '[]',
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * ALTER TABLE focus_sessions DISABLE ROW LEVEL SECURITY;
 *
 * Если колонка user_id есть в таблице и NOT NULL — нужно сделать её nullable
 * (или удалить), иначе INSERT без user_id будет падать с ошибкой:
 *
 * ALTER TABLE tasks                ALTER COLUMN user_id DROP NOT NULL;
 * ALTER TABLE finance_transactions ALTER COLUMN user_id DROP NOT NULL;
 * ALTER TABLE habits               ALTER COLUMN user_id DROP NOT NULL;
 * ALTER TABLE habit_logs           ALTER COLUMN user_id DROP NOT NULL;
 * ALTER TABLE projects             ALTER COLUMN user_id DROP NOT NULL;
 * ALTER TABLE scripts              ALTER COLUMN user_id DROP NOT NULL;
 *
 * Проверить что всё работает (должен вернуть массив):
 * SELECT * FROM tasks LIMIT 5;
 * ══════════════════════════════════════════════════════════════════════════
 */
