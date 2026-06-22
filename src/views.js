import { el, mount, fmt, fmtNum, fmtDate, tstamp, typeIcon, esc } from './dom-utils.js';
import { Store } from './store.js';
import { Charts } from './charts.js';

// БАГ #7: дебаунс-таймер для textarea редактора скриптов
let _scriptSaveTimer = null;

// ─── Shared helpers ───────────────────────────────────────────────────────
function card(...children) { return el('div', { class: 'card' }, ...children); }
function label(txt) { return el('div', { class: 'card-label' }, txt); }
function secHead(title, ...btns) { return el('div', { class: 'sec-head' }, el('div', { class: 'sec-title' }, title), ...btns); }
function emptyState(icon, text, btnText, btnAction) {
    return el('div', { class: 'empty' },
        el('div', { class: 'empty-ic' }, icon),
        el('div', { class: 'empty-txt' }, text),
        btnText ? el('button', { class: 'btn btn-p btn-sm', style: { marginTop: '16px' }, onclick: btnAction }, btnText) : null,
    );
}
function tag(cls, text) { return el('span', { class: `tag tag-${cls}` }, text); }
function btn(cls, text, onClick) { return el('button', { class: `btn ${cls}`, onclick: onClick }, text); }

const PRIO_LABEL = { high: 'Высокий', med: 'Средний', low: 'Низкий' };
const PRIO_TAG   = { high: 'high', med: 'med', low: 'low' };

// ─── Feed helpers ─────────────────────────────────────────────────────────
function fmtRelTime(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1)  return 'только что';
    if (min < 60) return `${min} мин назад`;
    const hr = Math.floor(min / 60);
    if (hr < 24)  return `${hr} ч назад`;
    if (hr < 48)  return 'вчера';
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function FeedCard(item) {
    return el('div', { class: 'feed-card' },
        el('div', { class: 'feed-card-icon' }, item.icon || '●'),
        el('div', { class: 'feed-card-body' },
            el('p', { class: 'feed-card-title' }, item.text),
            el('p', { class: 'feed-card-time' }, fmtRelTime(item.time)),
            item.subtext ? el('p', { class: 'feed-card-sub' }, item.subtext) : null,
            item.actions?.length ? el('div', { class: 'feed-card-actions' },
                ...item.actions.map(a =>
                    el('button', { class: 'btn btn-ghost btn-xs', type: 'button',
                        onclick: () => Store.dispatch('SET_VIEW', { view: a.view }),
                    }, a.label)
                ),
            ) : null,
        ),
    );
}

// ─── CALENDAR HELPERS ─────────────────────────────────────────────────────
const CAL_DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function calWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return d.toISOString().slice(0, 10);
}
function calAddDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}
function calWeekDays(weekStart) {
    return Array.from({ length: 7 }, (_, i) => calAddDays(weekStart, i));
}
function calMonthGrid(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const start = new Date(first); const sdow = start.getDay();
    start.setDate(start.getDate() - (sdow === 0 ? 6 : sdow - 1));
    const end = new Date(last); const edow = end.getDay();
    if (edow !== 0) end.setDate(end.getDate() + (7 - edow));
    const weeks = []; const cur = new Date(start);
    while (cur <= end) {
        const week = [];
        for (let i = 0; i < 7; i++) { week.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
        weeks.push(week);
    }
    return weeks;
}
// ─── HABIT SCHEDULING HELPERS ─────────────────────────────────────────────
const WEEKDAY_MAP = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
function isHabitDueOnDate(hb, dateStr) {
    if (!hb.frequency || hb.frequency === 'every_day') return true;
    const d = new Date(dateStr + 'T00:00:00');
    if (hb.frequency === 'every_other') {
        const epochDays = Math.floor(d.getTime() / 86400000);
        return epochDays % 2 === 0;
    }
    if (hb.frequency === 'custom') {
        const dow = d.getDay(); // 0=Sun, 1=Mon...
        const days = hb.custom_days || [];
        return days.some(k => WEEKDAY_MAP[k] === dow);
    }
    return true;
}
function isHabitDueToday(hb) {
    return isHabitDueOnDate(hb, new Date().toISOString().slice(0, 10));
}

function calDayItems(state, dateStr) {
    const dayOfMonth = new Date(dateStr + 'T00:00:00').getDate();
    return {
        tasks:    state.tasks.filter(t => t.due_date === dateStr && !t.done),
        habits:   state.habits.filter(hb => isHabitDueOnDate(hb, dateStr)),
        finances: state.finances.filter(f => f.is_recurring && f.recurrence_day === dayOfMonth),
    };
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────
export function DashboardView(state, h) {
    console.log('[DashboardView] called. tasks=', state.tasks?.length, 'habits=', state.habits?.length, 'finances=', state.finances?.length, 'agents=', state.agents?.length, 'user=', state.user);
    const today   = new Date().toISOString().slice(0, 10);
    const hr      = new Date().getHours();
    const greeting = hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
    const dateLabel = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    const income  = state.finances.filter(f => f.tx_type === 'income').reduce((s, f) => s + Number(f.amount), 0);
    const expense = state.finances.filter(f => f.tx_type === 'expense').reduce((s, f) => s + Number(f.amount), 0);
    const bal     = income - expense;
    const todayHabs = state.habits.filter(hb => isHabitDueToday(hb));
    const habDone   = todayHabs.filter(hb => hb.today_done).length;

    // Welcome banner — только когда совсем пусто
    const isEmpty = !state.tasks.length && !state.habits.length && !state.finances.length;
    const welcomeBanner = isEmpty ? el('div', { class: 'welcome-banner' },
        el('div', { class: 'welcome-title' }, '👋 Добро пожаловать в AI OS'),
        el('div', { class: 'welcome-sub' }, 'Начни с трёх шагов — займёт меньше минуты'),
        el('div', { class: 'welcome-actions' },
            btn('btn-p btn-sm', '+ Первая задача', () => h.openModal('task')),
            btn('btn-ghost btn-sm', '+ Привычка', () => h.openModal('habit')),
            btn('btn-ghost btn-sm', '+ Финансы', () => h.openModal('income')),
        ),
    ) : null;

    // ── HERO section ─────────────────────────────────────────────────────────
    function renderHeroTime() {
        const now = new Date();
        const HH = String(now.getHours()).padStart(2, '0');
        const MM = String(now.getMinutes()).padStart(2, '0');
        const SS = String(now.getSeconds()).padStart(2, '0');
        return [
            document.createTextNode(HH),
            el('span', { class: 'colon' }, ':'),
            document.createTextNode(MM),
            el('span', { class: 'colon' }, ':'),
            el('span', { class: 'hero-sec' }, SS),
        ];
    }

    const topTask = state.tasks.find(t => !t.done && t.priority === 'high')
        || state.tasks.find(t => !t.done && t.due_date === today)
        || null;

    // weekDays
    const todayDate = new Date();
    const dow = (todayDate.getDay() + 6) % 7; // Monday=0
    const startOfWeek = new Date(todayDate);
    startOfWeek.setDate(todayDate.getDate() - dow);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const dayNum = d.getDate();
        const dayName = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'][i];
        const isToday = d.toISOString().slice(0, 10) === today;
        return { dayName, dayNum, isToday };
    });

    const hero = el('div', { class: 'hero' },
        el('div', { class: 'hero-row' },
            el('div', { class: 'hero-greet' },
                el('div', { class: 'hero-mark' }, 'AIOS / ' + dateLabel.toUpperCase()),
                el('h1', { class: 'hero-h' },
                    greeting + ', ',
                    el('span', { class: 'hero-name' }, state.user?.name || 'Operator'),
                ),
                el('div', { class: 'hero-meta' }, 'Personal Operating System'),
            ),
            el('div', { class: 'hero-clock', id: 'dash-hero-clock' },
                el('div', { class: 'hero-time' }, ...renderHeroTime()),
                el('div', { class: 'hero-meta' }, dateLabel.toUpperCase()),
            ),
        ),
        topTask ? el('div', { class: 'hero-focus' },
            el('div', { class: 'hero-focus-l' }, 'СЕЙЧАС В ФОКУСЕ'),
            el('div', { class: 'hero-focus-t' }, topTask.title),
            el('div', { class: 'hero-focus-m' },
                topTask.due_date ? el('span', {}, 'дедлайн ' + topTask.due_date) : el('span', {}, 'без дедлайна'),
            ),
        ) : null,
        el('div', { class: 'week' },
            ...weekDays.map((d, i) => el('div', { class: 'week-day' + (d.isToday ? ' today' : '') },
                el('div', { class: 'd' }, d.dayName),
                el('div', { class: 'n' }, d.dayNum),
            )),
        ),
    );

    // ── Секция ЗАДАЧИ ─────────────────────────────────────────────────────
    const activeTasks = state.tasks.filter(t => !t.done && (t.due_date === today || t.priority === 'high')).slice(0, 5);
    const openTasksCount = state.tasks.filter(t => !t.done).length;

    const tasksSection = el('div', { class: 'section' },
        el('div', { class: 'section-h' },
            el('h3', {}, 'ЗАДАЧИ', el('span', { class: 'count' }, openTasksCount)),
            el('div', { class: 'tools' },
                btn('btn ghost', '+ ЗАДАЧА', () => h.openModal('task')),
            ),
        ),
        activeTasks.length
            ? el('div', {}, ...activeTasks.map(t => TaskRow(t)))
            : emptyState('✓', 'Задачи на сегодня выполнены', '+ Задача', () => h.openModal('task')),
    );

    // ── Секция ПРИВЫЧКИ ───────────────────────────────────────────────────
    const habitsSection = el('div', { class: 'section' },
        el('div', { class: 'section-h' },
            el('h3', {}, 'ПРИВЫЧКИ', el('span', { class: 'count' }, `${habDone}/${todayHabs.length}`)),
            el('div', { class: 'tools' },
                btn('btn ghost', '+ ПРИВЫЧКА', () => h.openModal('habit')),
            ),
        ),
        todayHabs.length
            ? el('div', {}, ...todayHabs.slice(0, 5).map(hb => HabitRowCompact(hb)))
            : emptyState('↺', 'Нет привычек на сегодня'),
    );

    // ── Секция ФИНАНСЫ ────────────────────────────────────────────────────
    const lastTx = state.finances.slice(0, 3);
    // stat — баланс
    const statRow = el('div', { class: 'stat-row' },
        el('div', { class: 'stat-val' + (bal < 0 ? ' neg' : '') }, fmt(bal)),
        el('div', { class: 'stat-delta' },
            el('span', {}, '↑' + fmt(income)),
            el('span', { style: { marginLeft: '6px' } }, '↓' + fmt(expense)),
        ),
    );
    const financesSection = el('div', { class: 'section' },
        el('div', { class: 'section-h' },
            el('h3', {}, 'ФИНАНСЫ'),
            el('div', { class: 'tools' },
                btn('btn ghost', '+ ДОХОД', () => h.openModal('income')),
                btn('btn ghost', '- РАСХОД', () => h.openModal('expense')),
            ),
        ),
        statRow,
        ...lastTx.map(f => FinRow(f)),
        !lastTx.length ? emptyState('₽', 'Нет транзакций') : null,
    );

    // ── Секция АГЕНТЫ ─────────────────────────────────────────────────────
    const agentsSection = el('div', { class: 'section' },
        el('div', { class: 'section-h' },
            el('h3', {}, 'АГЕНТЫ'),
            el('div', { class: 'tools' },
                btn('btn ghost', 'СТУДИЯ →', () => Store.dispatch('SET_VIEW', { view: 'studio' })),
            ),
        ),
        el('div', {}, ...state.agents.map(a => DashAgentMini(a, h))),
    );

    // ── Секция ЛЕНТА ЖИЗНИ ────────────────────────────────────────────────
    const lifeFeedItems = (state.lifeFeed || []).slice(0, 6);
    const lifeFeedSection = lifeFeedItems.length ? el('div', { class: 'section' },
        el('div', { class: 'section-h' },
            el('h3', {}, 'ЛЕНТА ЖИЗНИ'),
        ),
        el('div', {}, ...lifeFeedItems.map(FeedCard)),
    ) : null;

    // ── Секция ЛЕНТА АГЕНТОВ ──────────────────────────────────────────────
    const agentFeedItems = (state.agentFeed || []).slice(0, 5);
    const agentFeedSection = agentFeedItems.length ? el('div', { class: 'section' },
        el('div', { class: 'section-h' },
            el('h3', {}, 'ЛЕНТА АГЕНТОВ'),
        ),
        el('div', {}, ...agentFeedItems.map(FeedCard)),
    ) : null;

    // ── Сборка ─────────────────────────────────────────────────────────────
    const leftCol  = [lifeFeedSection, tasksSection, habitsSection, agentFeedSection].filter(Boolean);
    const rightCol = [financesSection, agentsSection].filter(Boolean);

    return el('div', { class: 'page' },
        welcomeBanner,
        hero,
        el('div', { class: 'dash-grid' },
            el('div', { class: 'dash-col' }, ...leftCol),
            el('div', { class: 'dash-col' }, ...rightCol),
        ),
    );
}

function DashAgentMini(a, h) {
    return el('div', { class: 'dash-agent-mini' },
        el('span', { style: { fontSize: '16px' } }, a.icon),
        el('span', { style: { fontSize: '11px', flex: '1' } }, a.name),
        el('div', { class: `agent-status-dot${a.status === 'working' ? ' on' : ''}` }),
        a.status !== 'working'
            ? btn('btn-ghost btn-xs', '▷', () => h.runAgent(a.id))
            : btn('btn-ghost btn-xs', '■', () => h.stopAgent(a.id)),
    );
}

// ─── TASKS ────────────────────────────────────────────────────────────────
export function TasksView(state, h) {
    const taskView = state.taskView || 'list';
    const filter   = state.taskFilter || 'all';
    const today    = new Date().toISOString().slice(0, 10);

    // Tab bar — [Все] [Активные] [Выполнено] [История] [Цели]
    const tabBar = el('div', { class: 'tab-bar', style: { marginBottom: '16px' } },
        ...['all', 'todo', 'done', 'history', 'goals'].map(f =>
            el('button', {
                class: 'tab-btn' + (filter === f ? ' active' : ''),
                onclick: () => Store.dispatch('SET_TASK_FILTER', { filter: f }),
            }, { all: 'Все', todo: 'Активные', done: 'Выполнено', history: 'История', goals: 'Цели' }[f])
        ),
        el('div', { style: { marginLeft: 'auto', display: 'flex', gap: '4px' } },
            btn(taskView === 'list' ? 'btn-sm active-filter' : 'btn-sm btn-ghost', '≡', () => Store.dispatch('SET_TASK_VIEW', { view: 'list' })),
            btn(taskView === 'kanban' ? 'btn-sm active-filter' : 'btn-sm btn-ghost', '▦', () => Store.dispatch('SET_TASK_VIEW', { view: 'kanban' })),
        ),
    );

    // Goals tab
    if (filter === 'goals') {
        return el('div', { class: 'page' },
            secHead('Задачи & Цели', btn('btn-p btn-sm', '+ Задача', () => h.openModal('task'))),
            tabBar,
            el('div', { class: 'tab-content' }, GoalsContent(state, h)),
        );
    }

    // БАГ #8: История — все выполненные задачи, сгруппированные по дате
    if (filter === 'history') {
        const allDone = state.tasks.filter(t => t.done);
        let histContent;
        if (!allDone.length) {
            histContent = emptyState('✓', 'Нет выполненных задач');
        } else {
            const groups = {};
            allDone.forEach(t => {
                const date = t.completed_at || 'Ранее';
                if (!groups[date]) groups[date] = [];
                groups[date].push(t);
            });
            const sortedDates = Object.keys(groups).sort((a, b) => {
                if (a === 'Ранее') return 1;
                if (b === 'Ранее') return -1;
                return b.localeCompare(a);
            });
            histContent = el('div', {},
                ...sortedDates.map(date => {
                    const dateLabel = date === 'Ранее' ? 'Ранее' :
                        new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
                    return el('div', { style: { marginBottom: '16px' } },
                        el('div', { class: 'card-label', style: { marginBottom: '8px' } }, dateLabel),
                        el('div', {}, ...groups[date].map(t => TaskRow(t))),
                    );
                }),
            );
        }
        return el('div', { class: 'page' },
            secHead('История задач'),
            tabBar,
            el('div', { class: 'tab-content' }, histContent),
        );
    }

    let list = [...state.tasks];
    if (filter === 'todo') list = list.filter(t => !t.done);
    // БАГ #8: "Выполнено" — только задачи, завершённые сегодня
    if (filter === 'done') list = list.filter(t => t.done && t.completed_at === today);

    const content = taskView === 'kanban'
        ? KanbanBoard(state)
        : (list.length ? el('div', {}, ...list.map(t => TaskRow(t))) : emptyState('✓', 'Чистый лист — отличный старт', '+ Задача', () => h.openModal('task')));

    return el('div', { class: 'page' },
        secHead('Задачи', btn('btn-p btn-sm', '+ Задача', () => h.openModal('task'))),
        tabBar,
        el('div', { class: 'tab-content' }, content),
    );
}

function KanbanBoard(state) {
    const cols = [
        { id: 'todo',        label: 'К выполнению', color: 'var(--t2)' },
        { id: 'in-progress', label: 'В работе',      color: 'var(--orange)' },
        { id: 'review',      label: 'Ревью',          color: 'var(--cyan)' },
        { id: 'done',        label: 'Готово',         color: 'var(--green)' },
    ];
    return el('div', { class: 'kanban-board' },
        ...cols.map(col => {
            const items = state.tasks.filter(t => {
                if (col.id === 'todo') return t.status === 'todo' && !t.done;
                if (col.id === 'done') return t.done;
                return t.status === col.id;
            });
            // БАГ #7 kanban: draggable карточки, все кнопки перемещения
            const cards = items.map(t => {
                const card = el('div', { class: 'kanban-card', draggable: 'true' },
                    el('div', { class: 'kanban-title' }, t.title),
                    el('div', { class: 'kanban-meta' },
                        tag(PRIO_TAG[t.priority] || 'med', PRIO_LABEL[t.priority] || 'Средний'),
                        el('span', { style: { marginLeft: 'auto', cursor: 'pointer', color: 'var(--t3)' }, onclick: () => Store.dispatch('DELETE_TASK', { id: t.id }) }, '✕'),
                    ),
                    el('div', { class: 'kanban-actions' },
                        // Убираем slice(0,2) — показываем все доступные колонки, включая "Готово"
                        ...cols.filter(c => c.id !== col.id).map(c =>
                            btn('btn-ghost btn-xs', c.label, () => Store.dispatch('MOVE_TASK', { id: t.id, status: c.id }))
                        ),
                    ),
                );
                card.addEventListener('dragstart', e => {
                    e.dataTransfer.setData('task-id', t.id);
                    card.classList.add('dragging');
                });
                card.addEventListener('dragend', () => card.classList.remove('dragging'));
                return card;
            });
            const colEl = el('div', { class: 'kanban-col', 'data-status': col.id },
                el('div', { class: 'kanban-col-head' },
                    el('div', { class: 'kanban-col-title', style: { color: col.color } }, col.label),
                    el('div', { class: 'kanban-col-count' }, items.length),
                ),
                ...cards,
                items.length === 0 ? el('div', { class: 'kanban-empty' }, 'Пусто') : null,
            );
            // Drop-target для drag-and-drop между колонками
            colEl.addEventListener('dragover', e => { e.preventDefault(); colEl.classList.add('drag-over'); });
            colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
            colEl.addEventListener('drop', e => {
                e.preventDefault(); colEl.classList.remove('drag-over');
                const tid = e.dataTransfer.getData('task-id');
                if (tid) Store.dispatch('MOVE_TASK', { id: tid, status: col.id });
            });
            return colEl;
        }),
    );
}

function TaskRow(t) {
    const item = el('div', { class: 'task-item', 'data-priority': t.priority || 'med' });
    const check = el('div', { class: `task-check${t.done ? ' checked' : ''}` });
    check.addEventListener('click', () => {
        if (!t.done) {
            item.classList.add('done-anim');
            setTimeout(() => Store.dispatch('TOGGLE_TASK', { id: t.id }), 280);
        } else {
            Store.dispatch('TOGGLE_TASK', { id: t.id });
        }
    });
    const title = el('div', { class: `task-title${t.done ? ' done' : ''}` }, t.title);
    const meta  = el('div', { style: { marginTop: '3px', display: 'flex', gap: '6px', alignItems: 'center' } });
    if (t.due_date) meta.appendChild(el('span', { style: { fontSize: '10px', color: 'var(--t3)' } }, '📅 ' + t.due_date));
    const del = el('button', { class: 'task-del', onclick: e => { e.stopPropagation(); Store.dispatch('DELETE_TASK', { id: t.id }); } }, '✕');
    item.append(check, el('div', { style: { flex: '1' } }, title, meta), del);
    return item;
}

// ─── INBOX ────────────────────────────────────────────────────────────────
export function InboxView(state, h) {
    const TYPE_ICON = { idea: '💡', goal: '🎯', note: '📝' };
    const items = state.inbox.map(item =>
        el('div', { class: 'task-item' },
            el('div', { class: 'inbox-ic' }, TYPE_ICON[item.type] || '💡'),
            el('div', { style: { flex: '1' } },
                el('div', { class: 'task-title' }, item.title),
                el('div', { class: 'tx-date' }, fmtDate(item.created_at)),
            ),
            btn('btn-ghost btn-sm', '→ Задача', () => Store.dispatch('INBOX_TO_TASK', { id: item.id })),
            el('button', { class: 'task-del', onclick: () => Store.dispatch('DELETE_INBOX', { id: item.id }) }, '✕'),
        )
    );
    return el('div', { class: 'page' },
        secHead('Inbox — Идеи и мысли', btn('btn-p btn-sm', '+ Идея', () => h.openModal('inbox'))),
        items.length ? el('div', {}, ...items) : emptyState('◎', 'Inbox пуст — запиши первую идею', '+ Идея', () => h.openModal('inbox')),
    );
}

// ─── HABITS ───────────────────────────────────────────────────────────────
const FREQ_LABELS = { every_day: 'Каждый день', every_other: 'Через день', custom: 'По дням' };
const DAY_NAMES_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

function freqBadge(hb) {
    if (!hb.frequency || hb.frequency === 'every_day') return null;
    const label = hb.frequency === 'custom'
        ? (hb.custom_days || []).join(' ')
        : FREQ_LABELS[hb.frequency];
    return el('span', { class: 'habit-freq-badge' }, label);
}

export function HabitsView(state, h) {
    const todayHabits = state.habits.filter(hb => isHabitDueToday(hb));
    const skippedHabits = state.habits.filter(hb => !isHabitDueToday(hb));

    const makeRow = hb => el('div', { class: 'habit-item' },
        el('div', { class: 'habit-ic' }, hb.icon || '✓'),
        el('div', { class: 'habit-info' },
            el('div', { class: 'habit-name' }, hb.name, freqBadge(hb)),
            el('div', { class: 'habit-streak' }, `🔥 Стрик: ${hb.streak} дней`),
        ),
        btn(`btn-sm ${hb.today_done ? 'btn-success' : 'btn-ghost'}`, hb.today_done ? '✓ Готово' : 'Отметить', () => Store.dispatch('TOGGLE_HABIT', { id: hb.id })),
        el('button', { class: 'task-del', title: 'Редактировать', onclick: () => h.openModal('edit-habit', { habit: hb }) }, '✎'),
        el('button', { class: 'task-del', onclick: () => confirm(`Удалить привычку «${hb.name}»?`) && Store.dispatch('DELETE_HABIT', { id: hb.id }) }, '✕'),
    );

    const skippedSection = skippedHabits.length ? el('div', { style: { marginTop: '16px' } },
        el('div', { class: 'card-label', style: { marginBottom: '8px' } }, 'Не сегодня'),
        ...skippedHabits.map(hb => el('div', { class: 'habit-item habit-item-skipped' },
            el('div', { class: 'habit-ic' }, hb.icon || '✓'),
            el('div', { class: 'habit-info' },
                el('div', { class: 'habit-name' }, hb.name, freqBadge(hb)),
                el('div', { class: 'habit-streak' }, `🔥 ${hb.streak} дней`),
            ),
            el('button', { class: 'task-del', title: 'Редактировать', onclick: () => h.openModal('edit-habit', { habit: hb }) }, '✎'),
            el('button', { class: 'task-del', onclick: () => confirm(`Удалить привычку «${hb.name}»?`) && Store.dispatch('DELETE_HABIT', { id: hb.id }) }, '✕'),
        )),
    ) : null;

    return el('div', { class: 'page' },
        secHead('Привычки', btn('btn-p btn-sm', '+ Привычка', () => h.openModal('habit'))),
        todayHabits.length
            ? el('div', {}, ...todayHabits.map(makeRow))
            : state.habits.length
                ? el('div', { class: 'cal-empty-day', style: { padding: '24px 0' } }, 'Сегодня нет запланированных привычек')
                : emptyState('↺', 'Одна привычка меняет всё. Добавь первую.', '+ Привычка', () => h.openModal('habit')),
        skippedSection,
    );
}

function HabitRowCompact(hb) {
    if (!isHabitDueToday(hb)) return null;
    return el('div', { class: 'habit-item', style: { marginBottom: '6px' } },
        el('div', { class: 'habit-ic' }, hb.icon || '✓'),
        el('div', { class: 'habit-info' }, el('div', { class: 'habit-name' }, hb.name), el('div', { class: 'habit-streak' }, `🔥 ${hb.streak} дн`)),
        btn(`btn-sm ${hb.today_done ? 'btn-success' : 'btn-ghost'}`, hb.today_done ? '✓' : '○', () => Store.dispatch('TOGGLE_HABIT', { id: hb.id })),
    );
}

// ─── GOALS ────────────────────────────────────────────────────────────────
function GoalsContent(state, h) {
    const active = state.goals.filter(g => !g.done);
    const done   = state.goals.filter(g => g.done);
    const section = (title, count, items) => el('div', { style: { marginBottom: '16px' } },
        el('div', { class: 'goals-section-title' }, `${title} (${count})`),
        ...items,
    );
    return el('div', {},
        secHead('Цели', btn('btn-p btn-sm', '+ Цель', () => h.openModal('goal'))),
        active.length ? section('Активные', active.length, active.map(g => GoalRow(g))) : null,
        done.length   ? section('Достигнуто', done.length, done.map(g => GoalRow(g)))   : null,
        !state.goals.length ? emptyState('🎯', 'Люди с записанными целями достигают их в 3 раза чаще.', '+ Цель', () => h.openModal('goal')) : null,
    );
}

export function GoalsView(state, h) {
    return el('div', { class: 'page' }, GoalsContent(state, h));
}

function GoalRow(g, compact) {
    const check = el('div', { class: `goal-check${g.done ? ' done' : ''}`, onclick: () => Store.dispatch('TOGGLE_GOAL', { id: g.id }) }, g.done ? '✓' : '');
    const title = el('div', { class: `goal-title${g.done ? ' done' : ''}` }, g.title);
    const dl    = g.deadline ? el('div', { class: 'tx-date' }, 'до ' + new Date(g.deadline).toLocaleDateString('ru-RU')) : null;
    const del   = compact ? null : el('button', { class: 'goal-del', onclick: () => Store.dispatch('DELETE_GOAL', { id: g.id }) }, '✕');
    return el('div', { class: 'goal-item' }, check, el('div', { style: { flex: 1 } }, title, dl), del);
}

// ─── FINANCES ─────────────────────────────────────────────────────────────
function FinancesOverviewContent(state, h) {
    const income  = state.finances.filter(f => f.tx_type === 'income').reduce((s, f) => s + Number(f.amount), 0);
    const expense = state.finances.filter(f => f.tx_type === 'expense').reduce((s, f) => s + Number(f.amount), 0);
    const bal     = income - expense;

    const stats = el('div', { class: 'g3' },
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Баланс'), el('div', { class: `stat-val dash-bal${bal < 0 ? ' neg' : ''}` }, fmt(bal))),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Доходы'), el('div', { class: 'stat-val up' }, fmt(income))),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Расходы'), el('div', { class: 'stat-val dn' }, fmt(expense))),
    );

    const insight = state.finInsight ? el('div', { class: 'fin-insight' },
        el('div', { class: 'fin-insight-head' }, '🤖 AI-анализ'),
        el('div', {}, state.finInsight),
    ) : null;

    const txList = state.finances.length
        ? el('div', { class: 'card' }, ...state.finances.slice(0, 30).map(f => FinRow(f, true)))
        : emptyState('₽', 'Нет транзакций');

    const catData = {};
    state.finances.filter(f => f.tx_type === 'expense').forEach(f => { catData[f.category || 'Прочее'] = (catData[f.category || 'Прочее'] || 0) + Number(f.amount); });
    const sortedCats = Object.entries(catData).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const pieContainer = el('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
        label('Распределение расходов'),
        sortedCats.length ? el('canvas', { id: 'pie-chart', style: { maxHeight: '200px' } }) : emptyState('📊', 'Нет расходов'),
    );

    setTimeout(() => {
        if (sortedCats.length) Charts.initDoughnut('pie-chart', sortedCats.map(c => c[0]), sortedCats.map(c => c[1]));
    }, 50);

    return el('div', {},
        stats,
        insight,
        el('div', { class: 'g2', style: { marginTop: '16px' } },
            el('div', {},
                secHead('Транзакции',
                    btn('btn-ghost btn-sm', '+ Доход',  () => h.openModal('income')),
                    btn('btn-ghost btn-sm', '+ Расход', () => h.openModal('expense')),
                ),
                txList,
            ),
            pieContainer,
        ),
    );
}

function FinancesReportsContent(state) {
    const doneTasks  = state.tasks.filter(t => t.done).length;
    const totalTasks = state.tasks.length;
    const habDone    = state.habits.filter(h => h.today_done).length;
    const income     = state.finances.filter(f => f.tx_type === 'income').reduce((s, f) => s + Number(f.amount), 0);
    const expense    = state.finances.filter(f => f.tx_type === 'expense').reduce((s, f) => s + Number(f.amount), 0);

    const pmap = { high: 0, med: 0, low: 0 };
    state.tasks.forEach(t => { pmap[t.priority || 'med']++; });
    const maxP = Math.max(...Object.values(pmap), 1);
    const prioChart = el('div', { class: 'bar-chart' },
        ...Object.entries(pmap).map(([k, v]) =>
            el('div', { class: 'bar-row' },
                el('div', { class: 'bar-label' }, { high: '🔴 Высокий', med: '🟡 Средний', low: '🟢 Низкий' }[k]),
                el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: { width: Math.round(v / maxP * 100) + '%', background: { high: 'var(--red)', med: 'var(--yellow)', low: 'var(--green)' }[k] } })),
                el('div', { class: 'bar-val' }, v + ' задач'),
            )
        )
    );

    const cats = {};
    state.finances.filter(f => f.tx_type === 'expense').forEach(f => { cats[f.category || 'Прочее'] = (cats[f.category || 'Прочее'] || 0) + Number(f.amount); });
    const sortedCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxC = sortedCats[0]?.[1] || 1;
    const finChart = sortedCats.length ? el('div', { class: 'bar-chart' },
        ...sortedCats.map(([k, v]) =>
            el('div', { class: 'bar-row' },
                el('div', { class: 'bar-label' }, k),
                el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: { width: Math.round(v / maxC * 100) + '%', background: 'var(--red)' } })),
                el('div', { class: 'bar-val' }, fmt(v)),
            )
        )
    ) : el('div', { class: 'empty-txt' }, 'Нет расходов');

    const habChart = state.habits.length ? el('div', { class: 'bar-chart' },
        ...state.habits.slice(0, 6).map(hb => {
            const pct = Math.min(Math.round((hb.streak || 0) / 7 * 100), 100);
            return el('div', { class: 'bar-row' },
                el('div', { class: 'bar-label' }, (hb.icon || '◎') + ' ' + hb.name),
                el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: { width: pct + '%', background: 'var(--green)' } })),
                el('div', { class: 'bar-val' }, hb.streak + ' дн.'),
            );
        })
    ) : el('div', { class: 'empty-txt' }, 'Нет привычек');

    return el('div', {},
        el('div', { class: 'g4', style: { marginBottom: '24px' } },
            el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Задач выполнено'), el('div', { class: 'stat-val' }, `${doneTasks}/${totalTasks}`)),
            el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Привычки сегодня'), el('div', { class: 'stat-val' }, `${habDone}/${state.habits.length}`)),
            el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Доходы'), el('div', { class: 'stat-val up' }, fmt(income))),
            el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Расходы'), el('div', { class: 'stat-val dn' }, fmt(expense))),
        ),
        el('div', { class: 'g2' },
            el('div', { class: 'report-section' }, el('h3', {}, 'Задачи по приоритету'), prioChart),
            el('div', { class: 'report-section' }, el('h3', {}, 'Финансы по категориям'), finChart),
        ),
        el('div', { class: 'report-section', style: { marginTop: '20px' } }, el('h3', {}, 'Привычки за 7 дней'), habChart),
    );
}

function FinancesYouTubeContent(state, h) {
    const yt = state.ytStats;
    const statsGrid = yt ? el('div', { class: 'g3', style: { marginBottom: '16px' } },
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Просмотры'), el('div', { class: 'stat-val' }, fmtNum(yt.views || 0))),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Подписчики'), el('div', { class: 'stat-val' }, fmtNum(yt.subs || 0))),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Доход'), el('div', { class: 'stat-val up' }, fmt(yt.revenue || 0))),
    ) : null;
    const chartContainer = yt?.chart ? el('div', { class: 'card', style: { marginBottom: '16px' } },
        label('Динамика просмотров'),
        el('canvas', { id: 'yt-chart', style: { height: '200px' } }),
    ) : null;
    if (yt?.chart) setTimeout(() => Charts.initYTChart('yt-chart', yt.chart), 50);
    return el('div', {},
        secHead('YouTube Аналитика', btn('btn-ghost btn-sm', '↻ Обновить', () => h.loadYT())),
        yt ? statsGrid : el('div', { class: 'card', style: { padding: '32px', textAlign: 'center', color: 'var(--t2)' } }, 'Нажмите «Обновить» для загрузки данных канала'),
        chartContainer,
    );
}

export function FinancesView(state, h) {
    const financesTab = state.financesTab || 'overview';
    const tabBar = el('div', { class: 'tab-bar' },
        ...['overview', 'reports', 'youtube'].map(t =>
            el('button', {
                class: 'tab-btn' + (t === financesTab ? ' active' : ''),
                onclick: () => Store.dispatch('SET_FINANCES_TAB', t),
            }, { overview: 'Обзор', reports: 'Отчёты', youtube: 'YouTube' }[t])
        )
    );
    let content;
    if (financesTab === 'overview') content = FinancesOverviewContent(state, h);
    if (financesTab === 'reports')  content = FinancesReportsContent(state);
    if (financesTab === 'youtube')  content = FinancesYouTubeContent(state, h);
    return el('div', { class: 'page' }, tabBar, el('div', { class: 'tab-content' }, content));
}

function FinRow(f, canDelete) {
    const isIncome = f.tx_type === 'income';
    return el('div', { class: 'tx-item' },
        el('div', { class: 'tx-ic', style: { background: isIncome ? 'var(--gd)' : 'var(--rd)' } }, isIncome ? '📈' : '📉'),
        el('div', { class: 'tx-info' },
            el('div', { class: 'tx-desc' }, f.description || '—'),
            el('div', { class: 'tx-date' }, (f.category || '') + (f.tx_date ? ' · ' + f.tx_date : '')),
        ),
        el('div', { class: isIncome ? 'tx-income' : 'tx-expense' }, (isIncome ? '+' : '-') + fmt(f.amount)),
        canDelete ? el('button', { class: 'task-del', onclick: () => Store.dispatch('DELETE_FINANCE', { id: f.id }) }, '✕') : null,
    );
}

// ─── REPORTS (legacy export — content moved to FinancesReportsContent) ────
export function ReportsView(state) {
    return el('div', { class: 'page' }, FinancesReportsContent(state));
}

// ─── PROJECTS ─────────────────────────────────────────────────────────────
export function ProjectsView(state, h) {
    const cards = state.projects.map(p => {
        const ptasks = state.tasks.filter(t => t.project_id === p.id);
        const pdone  = ptasks.filter(t => t.done).length;
        const pct    = ptasks.length ? Math.round(pdone / ptasks.length * 100) : 0;
        const projCard = el('div', { class: 'proj-card', onclick: () => Store.dispatch('SET_VIEW', { view: 'cockpit', projectId: p.id }) },
            el('div', { class: 'proj-head' },
                el('div', { class: 'proj-icon', style: { background: 'var(--pd)' } }, p.icon || typeIcon(p.type)),
                el('div', {},
                    el('div', { class: 'proj-name' }, p.name),
                    el('div', { class: 'proj-type' }, p.type || 'other'),
                ),
            ),
            el('div', { class: 'proj-stats' },
                el('div', { class: 'proj-stat' }, el('strong', {}, ptasks.length), ' задач'),
                el('div', { class: 'proj-stat' }, el('strong', {}, pdone), ' выполнено'),
            ),
            ptasks.length ? el('div', { class: 'progress', style: { marginTop: '10px' } }, el('div', { class: 'progress-bar', style: { width: pct + '%', background: 'var(--p)' } })) : null,
        );
        return projCard;
    });
    return el('div', { class: 'page' },
        secHead('Проекты', btn('btn-p btn-sm', '+ Проект', () => h.openModal('project'))),
        state.projects.length ? el('div', { class: 'g3' }, ...cards) : emptyState('◫', 'Нет проектов'),
    );
}

// ─── PROJECT COCKPIT ──────────────────────────────────────────────────────
export function CockpitView(state, h) {
    const p = state.projects.find(x => x.id === state.activeProjectId);
    if (!p) return el('div', { class: 'page' }, emptyState('◫', 'Проект не найден'));

    const PARAM_DEFS = {
        youtube:  [{ key: 'views', label: 'Просмотры' }, { key: 'subs', label: 'Подписчики' }, { key: 'revenue', label: 'Доход ₽' }],
        music:    [{ key: 'streams', label: 'Стримы' }, { key: 'followers', label: 'Слушатели' }, { key: 'revenue', label: 'Доход ₽' }],
        maskots:  [{ key: 'videos', label: 'Видео' }, { key: 'views', label: 'Просмотры' }, { key: 'conversions', label: 'Конверсии' }],
        business: [{ key: 'revenue', label: 'Доход ₽' }, { key: 'clients', label: 'Клиенты' }, { key: 'deals', label: 'Сделки' }],
    };
    const paramDefs = PARAM_DEFS[p.type] || [{ key: 'value1', label: 'Метрика 1' }, { key: 'value2', label: 'Метрика 2' }];
    const pvals = p.custom_params || {};
    const ptasks   = state.tasks.filter(t => t.project_id === p.id);
    const pscripts = state.scripts.filter(s => s.project_id === p.id);

    const tabs = ['pipeline', 'tasks', 'scripts', 'metrics'];
    const tabBar = el('div', { class: 'cockpit-tabs' },
        ...tabs.map(t => btn(t === state.cockpitTab ? 'cockpit-tab active' : 'cockpit-tab', { pipeline: '⚡ Pipeline', tasks: '☑ Задачи', scripts: '≡ Сценарии', metrics: '▦ Метрики' }[t],
            () => Store.dispatch('SET_COCKPIT_TAB', { tab: t })))
    );

    let content;
    if (state.cockpitTab === 'pipeline') {
        content = el('div', { class: 'pipeline-wrap' },
            ...state.pipeline.map(step =>
                el('div', { class: `pipeline-stage${step.status === 'locked' ? ' locked' : ''}` },
                    el('div', { class: 'pipeline-stage-head' },
                        el('div', { class: `step-num ${step.status}` }, step.status === 'done' ? '✓' : step.status === 'active' ? '▷' : '🔒'),
                        el('div', { class: 'step-title' }, step.name),
                        step.status === 'active' ? btn('btn-p btn-sm', 'Подтвердить', () => Store.dispatch('APPROVE_STEP', { stepId: step.id })) : null,
                    ),
                    step.output ? el('div', { class: 'step-output' }, step.output) : null,
                    el('div', { class: 'pipeline-items' },
                        ...(step.items || []).map(it =>
                            el('div', { class: 'pipeline-item', onclick: () => Store.dispatch('TOGGLE_PIPELINE_ITEM', { stepId: step.id, itemId: it.id }) },
                                el('div', { class: `task-check${it.done ? ' done' : ''}`, style: { pointerEvents: 'none' } }, it.done ? '✓' : ''),
                                el('span', { style: { fontSize: '11px', flex: '1', color: it.done ? 'var(--t2)' : '' } }, it.text),
                            )
                        ),
                    ),
                    step.status === 'active' ? el('div', { style: { marginTop: '8px' } },
                        PipelineItemInput(step.id)
                    ) : null,
                    // Video pipeline for maskots
                    p.type === 'maskots' && step.id === 'script' && pscripts.length ? el('div', { style: { marginTop: '8px' } }, btn('btn-ghost btn-sm', '⚡ Видео-промты', () => h.openModal('video-pipeline', { scriptId: pscripts[0].id, script: pscripts[0] }))) : null,
                )
            )
        );
    } else if (state.cockpitTab === 'tasks') {
        const rows = ptasks.map(t => TaskRow(t));
        content = el('div', {},
            secHead('', btn('btn-ghost btn-sm', '+ Задача', () => h.openModal('task', { project_id: p.id }))),
            rows.length ? el('div', {}, ...rows) : emptyState('☑', 'Нет задач'),
        );
    } else if (state.cockpitTab === 'scripts') {
        const rows = pscripts.map(sc =>
            el('div', { class: 'script-card' },
                el('div', { class: 'script-head' },
                    el('div', { class: 'script-title' }, sc.title),
                    el('div', { class: 'script-actions' },
                        btn('btn-ghost btn-sm', '✏ Открыть', () => Store.dispatch('SET_VIEW', { view: 'scripts' })),
                        btn('btn-ghost btn-sm', '📋 Копировать', () => navigator.clipboard?.writeText(sc.body || '')),
                        btn('btn-ghost btn-sm', '⚡ Промты', () => h.openModal('video-pipeline', { scriptId: sc.id, script: sc })),
                    ),
                ),
                el('div', { class: 'script-body' }, sc.body?.slice(0, 120) + (sc.body?.length > 120 ? '…' : '')),
            )
        );
        content = el('div', {},
            secHead('', btn('btn-p btn-sm', '+ Сценарий', () => h.openModal('script', { project_id: p.id }))),
            rows.length ? el('div', {}, ...rows) : emptyState('≡', 'Нет сценариев'),
        );
    } else if (state.cockpitTab === 'metrics') {
        content = el('div', { class: 'params-grid' },
            ...paramDefs.map(pd =>
                el('div', { class: 'param-card' },
                    el('div', { class: 'param-lbl' }, pd.label),
                    el('div', { class: 'param-val' }, fmtNum(pvals[pd.key] || 0)),
                    btn('param-edit', '✏ обновить', () => h.openModal('param', { projId: p.id, key: pd.key, label: pd.label, current: pvals[pd.key] || 0 })),
                )
            ),
        );
    }

    return el('div', { class: 'page' },
        el('div', { class: 'cockpit-header' },
            el('div', { class: 'cockpit-icon', style: { background: 'var(--pd)' } }, p.icon || typeIcon(p.type)),
            el('div', {},
                el('div', { class: 'cockpit-name' }, p.name),
                el('div', { class: 'cockpit-type' }, p.type),
            ),
        ),
        tabBar,
        content,
    );
}

function PipelineItemInput(stepId) {
    const input = el('input', { class: 'finp', style: { fontSize: '11px', padding: '6px 10px' }, placeholder: 'Добавить элемент...' });
    const addBtn = btn('btn-ghost btn-sm', '+', () => {
        if (input.value.trim()) { Store.dispatch('ADD_PIPELINE_ITEM', { stepId, text: input.value.trim() }); input.value = ''; }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    return el('div', { style: { display: 'flex', gap: '6px' } }, input, addBtn);
}

// ─── AGENTS ───────────────────────────────────────────────────────────────
const IDLE_PHRASES = [
    'Готов к работе. Назначь задачу.',
    'Мониторю данные. Жду команды.',
    'В режиме ожидания. Назначь задачу.',
    'Анализирую контекст. Жду инструкций.',
    'Системы в норме. Жду задачи.',
];

export function AgentsView(state, h) {
    const cards = state.agents.map(a => AgentCard(a, h));
    return el('div', { class: 'page' },
        secHead('AI Агенты',
            btn('btn-p btn-sm', '▷ Запустить всех', () => h.runAllAgents()),
            btn('btn-ghost btn-sm', '■ Стоп всех', () => h.stopAllAgents()),
        ),
        el('div', { class: 'agent-grid' }, ...cards),
    );
}

function AgentCard(a, h) {
    const statusColors = { idle: 'var(--t2)', working: 'var(--accent)', error: 'var(--red)' };
    const idlePhrase = IDLE_PHRASES[Math.floor(Date.now() / 4000) % IDLE_PHRASES.length];
    const taskText = a.task || (a.status === 'idle' ? idlePhrase : 'Ожидание задачи…');
    return el('div', { class: `card agent-card${a.status === 'working' ? ' working' : ''}` },
        el('div', { class: 'agent-head' },
            el('div', { class: 'agent-ic' }, a.icon),
            el('div', {},
                el('div', { class: 'agent-name' }, a.name),
                el('div', { class: 'agent-type' }, a.role),
            ),
        ),
        el('div', { class: 'agent-task' }, taskText),
        el('div', { class: 'agent-foot' },
            el('div', { class: `agent-status-dot${a.status === 'working' ? ' on' : ''}` }),
            el('div', { style: { fontSize: '10px', color: statusColors[a.status] || 'var(--t2)' } }, a.status.toUpperCase()),
            el('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
                a.status !== 'working' ? btn('btn-ghost btn-sm', '▷ Запуск', () => h.runAgent(a.id)) : btn('btn-ghost btn-sm', '■ Стоп', () => h.stopAgent(a.id)),
            ),
        ),
    );
}

function AgentMini(a) {
    return el('div', { class: 'agent-mini' },
        el('div', { class: 'agent-ic', style: { width: '28px', height: '28px', fontSize: '13px' } }, a.icon),
        el('div', { class: 'agent-name', style: { fontSize: '11px' } }, a.name),
        el('div', { style: { fontSize: '10px', color: 'var(--accent)', marginLeft: 'auto' } }, a.status.toUpperCase()),
    );
}

// ─── SCRIPTS ──────────────────────────────────────────────────────────────
export function ScriptsView(state, h) {
    const filter = state.scriptFilter || 'all';
    const projects = state.projects;
    const filtered = filter === 'all' ? state.scripts : state.scripts.filter(sc => sc.project_id === filter);

    const filterBar = el('div', { class: 'task-filters' },
        btn(filter === 'all' ? 'btn-sm active-filter' : 'btn-sm btn-ghost', 'Все', () => Store.dispatch('SET_SCRIPT_FILTER', { filter: 'all' })),
        ...projects.map(p => btn(filter === p.id ? 'btn-sm active-filter' : 'btn-sm btn-ghost', p.name, () => Store.dispatch('SET_SCRIPT_FILTER', { filter: p.id }))),
    );

    const active = state.activeScriptId ? state.scripts.find(sc => sc.id === state.activeScriptId) : null;

    const list = el('div', { class: 'scripts-list' },
        ...filtered.map(sc => el('div', {
            class: `script-list-item${sc.id === state.activeScriptId ? ' active' : ''}`,
            onclick: () => Store.dispatch('SET_ACTIVE_SCRIPT', { id: sc.id }),
        },
            el('div', { class: 'script-list-title' }, sc.title),
            el('div', { class: 'script-list-meta' }, sc.project_id ? (projects.find(p => p.id === sc.project_id)?.name || '') : 'Личное'),
            el('button', { class: 'task-del', onclick: e => { e.stopPropagation(); Store.dispatch('DELETE_SCRIPT', { id: sc.id }); } }, '✕'),
        ))
    );

    const editor = active ? el('div', { class: 'script-editor' },
        el('div', { class: 'script-editor-head' },
            el('div', { class: 'script-editor-title' }, active.title),
            el('div', { style: { display: 'flex', gap: '6px' } },
                btn('btn-ghost btn-sm', '📋 Копировать', () => navigator.clipboard?.writeText(active.body || '')),
                btn('btn-ghost btn-sm', '💾 Экспорт', () => {
                    const blob = new Blob([active.body || ''], { type: 'text/plain' });
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = active.title + '.txt'; a.click();
                }),
                btn('btn-ghost btn-sm', '⚡ Промты', () => h.openModal('video-pipeline', { scriptId: active.id, script: active })),
            ),
        ),
        (() => {
            const ta = el('textarea', { class: 'finp script-textarea', placeholder: 'Текст сценария...' });
            ta.value = active.body || '';
            ta.addEventListener('input', () => Store.dispatch('UPDATE_SCRIPT', { id: active.id, body: ta.value }));
            return ta;
        })(),
        active.segments?.length ? el('div', { class: 'segments-block' },
            el('div', { class: 'card-label', style: { margin: '12px 0 8px' } }, `Видео-промты (${active.segments.length} сегментов)`),
            ...active.segments.map((seg, i) =>
                el('div', { class: 'segment-item' },
                    el('div', { class: 'segment-num' }, `Сегмент ${seg.seg || i + 1} · 6 сек`),
                    el('div', { class: 'segment-prompt' }, el('strong', {}, 'Промт: '), seg.prompt || ''),
                    el('div', { class: 'segment-prompt' }, el('strong', {}, 'Озвучка: '), seg.voiceover || ''),
                )
            ),
            btn('btn-ghost btn-sm', '📋 Копировать все промты', () => {
                const text = active.segments.map((s, i) => `Сегмент ${s.seg || i + 1}:\n${s.prompt}`).join('\n\n');
                navigator.clipboard?.writeText(text);
            }),
        ) : null,
    ) : el('div', { class: 'script-editor script-editor-empty' }, emptyState('≡', 'Выберите сценарий'));

    return el('div', { class: 'page' },
        secHead('Сценарии', btn('btn-p btn-sm', '+ Сценарий', () => h.openModal('script'))),
        filterBar,
        el('div', { class: 'scripts-layout' }, list, editor),
    );
}

// ─── IMAGES ───────────────────────────────────────────────────────────────
export function ImagesView(state, h) {
    const promptInput = el('textarea', { class: 'finp', placeholder: 'Опиши изображение на английском...', rows: '3' });
    const genBtn = btn('btn-p', '◎ Генерировать', () => h.generateImages(promptInput.value));

    const gallery = state.images.length
        ? el('div', { class: 'image-gallery' },
            ...state.images.map(img =>
                el('div', { class: 'image-card' },
                    img.url
                        ? el('img', { src: img.url, alt: img.prompt, class: 'image-thumb' })
                        : el('div', { class: 'image-placeholder' }, '◎'),
                    el('div', { class: 'image-prompt' }, img.prompt || ''),
                    el('div', { class: 'image-actions' },
                        img.url ? btn('btn-ghost btn-sm', '↓ Скачать', () => { const a = document.createElement('a'); a.href = img.url; a.download = 'image.png'; a.click(); }) : null,
                        btn('btn-ghost btn-sm', '📋 Промт', () => navigator.clipboard?.writeText(img.prompt || '')),
                    ),
                )
            )
        )
        : emptyState('◎', 'Нет изображений');

    return el('div', { class: 'page' },
        el('div', { class: 'card', style: { marginBottom: '16px' } },
            label('Генерация изображений'),
            promptInput,
            el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                genBtn,
                btn('btn-ghost btn-sm', '🗑 Очистить', () => Store.dispatch('CLEAR_IMAGES')),
            ),
        ),
        gallery,
    );
}

// ─── YOUTUBE ──────────────────────────────────────────────────────────────
export function YouTubeView(state, h) {
    const yt = state.ytStats;
    const loadBtn = btn('btn-ghost btn-sm', '↻ Обновить', () => h.loadYT());

    const statsGrid = yt ? el('div', { class: 'g3', style: { marginBottom: '16px' } },
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Просмотры'), el('div', { class: 'stat-val' }, fmtNum(yt.views || 0))),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Подписчики'), el('div', { class: 'stat-val' }, fmtNum(yt.subs || 0))),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-lbl' }, 'Доход'), el('div', { class: 'stat-val up' }, fmt(yt.revenue || 0))),
    ) : null;

    const chartContainer = yt?.chart ? el('div', { class: 'card', style: { marginBottom: '16px' } },
        label('Динамика просмотров'),
        el('canvas', { id: 'yt-chart', style: { height: '200px' } }),
    ) : null;

    if (yt?.chart) setTimeout(() => Charts.initYTChart('yt-chart', yt.chart), 50);

    return el('div', { class: 'page' },
        secHead('YouTube Аналитика', loadBtn),
        yt ? statsGrid : el('div', { class: 'card', style: { padding: '32px', textAlign: 'center', color: 'var(--t2)' } }, 'Нажмите «Обновить» для загрузки данных канала'),
        chartContainer,
    );
}

// ─── MUSIC ────────────────────────────────────────────────────────────────
export function MusicView(state, h) {
    const ta = el('textarea', { class: 'finp', placeholder: 'Вставь текст трека, название или ссылку...', rows: '6', id: 'music-input' });
    const analyzeBtn = btn('btn-p', '♫ Анализировать', () => h.analyzeMusic(document.getElementById('music-input')?.value || ''));

    const data = state.musicData;
    const result = data ? el('div', { class: 'card', style: { marginTop: '16px' } },
        label('Результат анализа'),
        el('div', { class: 'g3' },
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Жанр'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.genre || '—')),
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Настроение'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.mood || '—')),
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'BPM'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.bpm || '—')),
        ),
        el('div', { class: 'g2', style: { marginTop: '10px' } },
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Тональность'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.key || '—')),
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Аудитория'), el('div', { class: 'param-val', style: { fontSize: '14px' } }, data.audience || '—')),
        ),
        data.tips?.length ? el('div', { style: { marginTop: '12px' } },
            el('div', { class: 'card-label' }, 'Советы'),
            el('ul', { style: { paddingLeft: '16px', fontSize: '12px', color: 'var(--t2)', lineHeight: '1.8' } }, ...data.tips.map(tip => el('li', {}, tip))),
        ) : null,
    ) : null;

    return el('div', { class: 'page' },
        secHead('Музыкальный модуль'),
        el('div', { class: 'card', style: { marginBottom: '16px' } }, label('Анализ трека'), ta, el('div', { style: { marginTop: '8px' } }, analyzeBtn)),
        result,
    );
}

// ─── STUDIO ───────────────────────────────────────────────────────────────
function ScriptsContent(state, h) {
    const filter = state.scriptFilter || 'all';
    const projects = state.projects;
    const filtered = filter === 'all' ? state.scripts : state.scripts.filter(sc => sc.project_id === filter);

    const filterBar = el('div', { class: 'task-filters' },
        btn(filter === 'all' ? 'btn-sm active-filter' : 'btn-sm btn-ghost', 'Все', () => Store.dispatch('SET_SCRIPT_FILTER', { filter: 'all' })),
        ...projects.map(p => btn(filter === p.id ? 'btn-sm active-filter' : 'btn-sm btn-ghost', p.name, () => Store.dispatch('SET_SCRIPT_FILTER', { filter: p.id }))),
    );

    const active = state.activeScriptId ? state.scripts.find(sc => sc.id === state.activeScriptId) : null;

    const list = el('div', { class: 'scripts-list' },
        ...filtered.map(sc => el('div', {
            class: `script-list-item${sc.id === state.activeScriptId ? ' active' : ''}`,
            onclick: () => Store.dispatch('SET_ACTIVE_SCRIPT', { id: sc.id }),
        },
            el('div', { class: 'script-list-title' }, sc.title),
            el('div', { class: 'script-list-meta' }, sc.project_id ? (projects.find(p => p.id === sc.project_id)?.name || '') : 'Личное'),
            el('button', { class: 'task-del', onclick: e => { e.stopPropagation(); Store.dispatch('DELETE_SCRIPT', { id: sc.id }); } }, '✕'),
        ))
    );

    const editor = active ? el('div', { class: 'script-editor' },
        el('div', { class: 'script-editor-head' },
            el('div', { class: 'script-editor-title' }, active.title),
            el('div', { style: { display: 'flex', gap: '6px' } },
                btn('btn-ghost btn-sm', '📋 Копировать', () => navigator.clipboard?.writeText(active.body || '')),
                btn('btn-ghost btn-sm', '💾 Экспорт', () => {
                    const blob = new Blob([active.body || ''], { type: 'text/plain' });
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = active.title + '.txt'; a.click();
                }),
                btn('btn-ghost btn-sm', '⚡ Промты', () => h.openModal('video-pipeline', { scriptId: active.id, script: active })),
            ),
        ),
        (() => {
            // БАГ #7: id для восстановления фокуса, дебаунс чтобы не ре-рендерить на каждый символ
            const ta = el('textarea', { class: 'finp script-textarea', id: 'script-editor-ta', placeholder: 'Текст сценария...' });
            ta.value = active.body || '';
            ta.addEventListener('input', () => {
                clearTimeout(_scriptSaveTimer);
                _scriptSaveTimer = setTimeout(() => Store.dispatch('UPDATE_SCRIPT', { id: active.id, body: ta.value }), 600);
            });
            return ta;
        })(),
        active.segments?.length ? el('div', { class: 'segments-block' },
            el('div', { class: 'card-label', style: { margin: '12px 0 8px' } }, `Видео-промты (${active.segments.length} сегментов)`),
            ...active.segments.map((seg, i) =>
                el('div', { class: 'segment-item' },
                    el('div', { class: 'segment-num' }, `Сегмент ${seg.seg || i + 1} · 6 сек`),
                    el('div', { class: 'segment-prompt' }, el('strong', {}, 'Промт: '), seg.prompt || ''),
                    el('div', { class: 'segment-prompt' }, el('strong', {}, 'Озвучка: '), seg.voiceover || ''),
                )
            ),
            btn('btn-ghost btn-sm', '📋 Копировать все промты', () => {
                const text = active.segments.map((s, i) => `Сегмент ${s.seg || i + 1}:\n${s.prompt}`).join('\n\n');
                navigator.clipboard?.writeText(text);
            }),
        ) : null,
    ) : el('div', { class: 'script-editor script-editor-empty' }, emptyState('≡', 'Выберите сценарий'));

    return el('div', { class: 'tab-content' },
        secHead('Сценарии', btn('btn-p btn-sm', '+ Сценарий', () => h.openModal('script'))),
        filterBar,
        el('div', { class: 'scripts-layout' }, list, editor),
    );
}

function AgentsContent(state, h) {
    const cards = state.agents.map(a => AgentCard(a, h));
    return el('div', { class: 'tab-content' },
        secHead('AI Агенты',
            btn('btn-p btn-sm', '▷ Запустить всех', () => h.runAllAgents()),
            btn('btn-ghost btn-sm', '■ Стоп всех', () => h.stopAllAgents()),
        ),
        el('div', { class: 'agent-grid' }, ...cards),
    );
}

function ImagesContent(state, h) {
    const promptInput = el('textarea', { class: 'finp', placeholder: 'Опиши изображение на английском...', rows: '3' });
    const genBtn = btn('btn-p', '◎ Генерировать', () => h.generateImages(promptInput.value));

    const gallery = state.images.length
        ? el('div', { class: 'image-gallery' },
            ...state.images.map(img =>
                el('div', { class: 'image-card' },
                    img.url
                        ? el('img', { src: img.url, alt: img.prompt, class: 'image-thumb' })
                        : el('div', { class: 'image-placeholder' }, '◎'),
                    el('div', { class: 'image-prompt' }, img.prompt || ''),
                    el('div', { class: 'image-actions' },
                        img.url ? btn('btn-ghost btn-sm', '↓ Скачать', () => { const a = document.createElement('a'); a.href = img.url; a.download = 'image.png'; a.click(); }) : null,
                        btn('btn-ghost btn-sm', '📋 Промт', () => navigator.clipboard?.writeText(img.prompt || '')),
                    ),
                )
            )
        )
        : emptyState('◎', 'Нет изображений');

    return el('div', { class: 'tab-content' },
        el('div', { class: 'card', style: { marginBottom: '16px' } },
            label('Генерация изображений'),
            promptInput,
            el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                genBtn,
                btn('btn-ghost btn-sm', '🗑 Очистить', () => Store.dispatch('CLEAR_IMAGES')),
            ),
        ),
        gallery,
    );
}

function MusicContent(state, h) {
    const ta = el('textarea', { class: 'finp', placeholder: 'Вставь текст трека, название или ссылку...', rows: '6', id: 'music-input' });
    const analyzeBtn = btn('btn-p', '♫ Анализировать', () => h.analyzeMusic(document.getElementById('music-input')?.value || ''));

    const data = state.musicData;
    const result = data ? el('div', { class: 'card', style: { marginTop: '16px' } },
        label('Результат анализа'),
        el('div', { class: 'g3' },
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Жанр'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.genre || '—')),
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Настроение'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.mood || '—')),
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'BPM'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.bpm || '—')),
        ),
        el('div', { class: 'g2', style: { marginTop: '10px' } },
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Тональность'), el('div', { class: 'param-val', style: { fontSize: '16px' } }, data.key || '—')),
            el('div', { class: 'param-card' }, el('div', { class: 'param-lbl' }, 'Аудитория'), el('div', { class: 'param-val', style: { fontSize: '14px' } }, data.audience || '—')),
        ),
        data.tips?.length ? el('div', { style: { marginTop: '12px' } },
            el('div', { class: 'card-label' }, 'Советы'),
            el('ul', { style: { paddingLeft: '16px', fontSize: '12px', color: 'var(--t2)', lineHeight: '1.8' } }, ...data.tips.map(tip => el('li', {}, tip))),
        ) : null,
    ) : null;

    return el('div', { class: 'tab-content' },
        el('div', { class: 'card', style: { marginBottom: '16px' } }, label('Анализ трека'), ta, el('div', { style: { marginTop: '8px' } }, analyzeBtn)),
        result,
    );
}

// ─── SCENES (video storyboard) ────────────────────────────────────────────
function ScenesContent(state, h) {
    const scenes = [{"n":1,"s":3,"keyframe":"A wide-angle shot of Gena's empty, pristine room bathed in pale morning light. The composition is slightly off-center, with the bed frame cutting diagonally across the lower left corner. Gena stands near the window, his posture slumped, but his right hand grips the windowsill, knuckles white. Cold blue-grey tones dominate, but a single warm ray of sunlight falls across his shoulder, creating a sharp contrast. His eyes are distant, but a faint, almost imperceptible tremor runs through his jaw. A small, overturned glass lies on the floor near his feet, catching the light. Illustrated digital art style with soft, cool shadows and a single warm highlight.","video":"The camera starts in a tight close-up on Gena's hand gripping the windowsill, then rapidly pulls back to a wide shot over 0.5 seconds, creating a jarring sense of intrusion. Gena's chest rises and falls with a deep, shuddering breath, his gaze snapping downward to the overturned glass. The morning light flickers briefly as a cloud passes, then returns, casting long, cool shadows that stretch across the floor. The stillness is broken by the faint sound of a distant clock ticking, emphasizing the melancholy and the mystery of the glass.","desc_ru":"Пустая чистая комната Гены, утренний свет, аккуратная обстановка, холодные голубовато-серые тона, меланхоличное настроение."},{"n":2,"s":3,"keyframe":"Close-up of Gena (gena1) in a crisp blue button-up shirt, eyes locked on camera with a glimmer of hope. Soft, cool blue-grey lighting casts gentle shadows across his face, highlighting his hopeful expression. Muted, cold-toned palette with illustrated digital art style, evoking a serene yet anticipatory mood. Composition shifts slightly off-center, with his face positioned to the right, leaving a sliver of dark, undefined space on the left. A single bead of sweat on his temple catches the light, adding mystery and tension.","video":"Camera starts at medium close-up, then rapidly pushes in to tight close-up within the first 0.5 seconds, creating immediate intimacy. Micro-movement: a quick, sharp intake of breath, then a slow, deliberate blink as hope flickers. Lighting begins with a warm, golden rim light on his left side, then abruptly shifts to cool blue-grey, intensifying on his face. A faint, cold blue rim light emerges from the dark left space. Timing: fast initial push, then slow, held gaze with a subtle eyebrow lift and slight parting of lips, ending on a hopeful, yet tense, stare.","desc_ru":"Крупный план Гены в свежей голубой рубашке, застегнутой на пуговицы, смотрит в камеру живыми глазами, надежда."},{"n":3,"s":2,"keyframe":"A black screen with white text forming a title card, but the text is slightly off-center, drifting to the lower left quadrant. A single, faint blue-grey pixel flickers at the upper right edge, like a distant star or a glitch. The cold palette is interrupted by a thin, warm amber line tracing the bottom border, barely visible. The void feels less empty—a subtle tension between the text's isolation and the tiny, unexplained details. Illustrated digital art style with stark contrast, but the off-center composition and micro-details create mystery.","video":"Camera starts with a micro-jolt (0.1s), as if a cold breath disturbed the frame, then holds static. White text fades in rapidly over 0.5s, not 1.5s, with a sharp, digital flicker at 0.3s (opacity drops to 70% then back to 100%). The warm amber line pulses once at 0.8s, then fades. The blue-grey pixel blinks at 1.2s. No character movement. Lighting remains dim but the warm line adds contrast. Timing: 2 seconds total, but the first 0.5s is accelerated to hook retention.","desc_ru":"Черный экран, белый текст, заглавная карточка, меланхоличная холодная палитра, пустота."},{"n":4,"s":4,"keyframe":"Medium shot, slightly low angle. Gena1 sits at a clean wooden desk, holding a pen over an open planner. Neat room with soft blue-grey walls. Focused expression, slight furrow of brows. Cool, muted lighting from a desk lamp casts gentle shadows. Illustrated digital art style with cold tones, blue-grey palette, clean lines. A single, out-of-place red paperclip lies near the planner's edge, catching a warm sliver of light from an unseen window.","video":"Camera quickly pushes in from medium to close-up in the first 0.5s, then slows to a crawl over the remaining 3.5s. Gena1’s hand moves the pen in small, deliberate strokes across the planner page. Eyes shift slightly as if reading. Lamp light remains steady, no flicker. Subtle breath movement in shoulders. At 2s, Gena1 pauses, blinks slowly, and the red paperclip glints briefly. Timing: fast initial push, then methodical pace, ending on a still frame of the planner with the paperclip in sharp focus.","desc_ru":"Гена за столом с ежедневником, пишет расписание, аккуратный вид, чистая комната, сосредоточен."},{"n":5,"s":3,"keyframe":"Close-up of a wall calendar, Gena's hand (gena1) holding a marker, crossing off days with aggressive strokes. First scratches appear on the paper. Muted blue-grey palette, cold lighting from above casts sharp shadows. Expression: obsessive, intense focus. Illustrated digital art style, gritty texture. A single drop of sweat on Gena's temple catches the light, and the marker tip is slightly bent, hinting at repeated use.","video":"Camera starts with a quick, jarring zoom-in on the calendar as Gena's hand moves in fast, jerky motions, marker scratching paper. The first 0.5s shows a sudden flicker of warm light from a window, then returns to cold shadows. Subtle tremor in fingers, and a faint, unexplained shadow of a second hand appears briefly on the wall. Lighting flickers slightly, emphasizing shadows. Duration: 3 seconds, ending on a scratched-off date with a tiny, almost invisible crack in the wall behind the calendar.","desc_ru":"Календарь Гены на стене, маркером зачеркивает дни, первые царапины, приглушенные тона, одержимость."},{"n":6,"s":3,"keyframe":"Low-angle shot, Gena1 sits in dim room, blue monitor light casts cool glow on face, neat appearance but tired eyes, slight shadows under eyes, muted blue-grey palette, cold tones, illustrated digital art style, mood of quiet exhaustion. Contrast: warm amber light from a distant streetlamp leaks through blinds, casting a faint orange stripe across the desk, breaking the cold blue.","video":"Camera quickly zooms in on Gena1's face over first 0.5s, then slows to a crawl for remaining 2.5s. Monitor light flickers subtly, Gena1 blinks slowly, slight droop of eyelids, micro-movement of lips parting, then a sudden, almost imperceptible twitch in the left hand resting on the keyboard. Lighting shifts: cold blue static, but the amber stripe pulses faintly with the flicker, adding a warm, mysterious contrast. Timing emphasizes stillness and fatigue, but the initial speed and hand twitch create a jolt of intrigue.","desc_ru":"Ночь, синий свет монитора на лице Гены, все еще аккуратный вид, усталость."},{"n":7,"s":3,"keyframe":"Extreme close-up of gena1's tired eyes, dark circles prominent, blue-grey muted light casting shadows on the face, exhausted expression, cold tones, illustrated digital art style, shallow depth of field focusing on the eyes, composition slightly off-center with the left eye dominating the frame, a single stray hair falling across the forehead, a faint reflection of a window in the pupil, adding mystery and depth.","video":"Camera starts with a rapid 0.5s zoom into the left eye, then slows to a crawl over the remaining 2.5s, capturing a heavy blink and a subtle twitch of the brow, a micro-movement of the lips parting slightly, cold dim light with a sudden warm flicker on the cheek, ending with a faint glisten in the eyes, creating contrast and tension.","desc_ru":"Крупный план уставших глаз Гены, темные круги, голубовато-серый свет на лице, изнеможение."},{"n":8,"s":3,"keyframe":"A view through a rain-streaked window at night, cold blue-grey muted palette. Gena1 stands slightly off-center, back to camera, gazing out at distant city lights. A single warm lamp glow from an unseen room reflects faintly on the left edge of the glass, contrasting the cool blue tones. The silhouette is sharp against the dark skyline, but a small, mysterious detail—a faint handprint on the glass near the bottom right—hints at a recent presence. Expression is pensive, isolated. Lighting is dim, with cool blue tones casting long shadows, but the warm reflection adds a subtle tension. Style: illustrated digital art with a melancholic, lonely mood.","video":"Camera quickly pushes in toward the window over the first 0.5s, then slows to a contemplative pace. Gena1's shoulders rise and fall in a micro-action: a barely perceptible breath, then a slight tension as if about to turn. Raindrops slide down the glass, catching faint neon reflections, but one drop near the handprint pauses, defying gravity for a split second. Lighting remains static, cold, with the warm reflection flickering once. Timing: 3 seconds, with an accelerated start that draws attention, then a lingering, mysterious finish.","desc_ru":"Ночной город через окно, холодные синие тона, одинокое настроение, изоляция."},{"n":9,"s":2,"keyframe":"Black screen with white text 'THIS IS GENA' positioned slightly off-center to the right, cold blue-grey muted palette, melancholic mood, empty void, illustrated digital art style, no character visible, stark minimal composition, soft diffused lighting from above, a faint breath-like condensation mark appears on the left side of the frame, trigger gena1.","video":"Camera static, text appears abruptly at 0.3s with a sharp flicker, then holds steady, subtle grain overlay, cold blue light pulse from behind text at 0.5s, text edges subtly blur and sharpen over 0.8s, total duration 2 seconds, fade to black at end.","desc_ru":"Черный экран, белый текст 'THIS IS GENA', меланхоличный холод, пустота."},{"n":10,"s":3,"keyframe":"Close-up on gena1's face, illuminated by the cold blue light of a smartphone screen. One coffee mug sits untouched in the foreground. Expression is tired, eyes half-lidded. Composition is tight, isolating. Muted blue-grey palette, digital illustration style, mood of loneliness and quiet melancholy. A single stray hair falls across the forehead, and a faint reflection in the screen shows a blurred figure behind the camera.","video":"Camera starts slightly off-center, then slowly pushes in on gena1's face over 3 seconds. Fingers scroll slightly, eyes blink slowly. Screen light flickers subtly, casting shifting shadows. Coffee mug remains still. At 0.5s, a quick micro-action: gena1's breath catches, a tiny shiver runs through the shoulders, then stillness returns. Timing emphasizes stillness and solitude, with a sudden warm glow from a passing car headlight briefly cutting through the cold blue, then fading.","desc_ru":"Гена листает телефон, свет от экрана на лице, одна кружка кофе, одиночество."},{"n":11,"s":2,"keyframe":"Close-up of a calendar on the wall, one day crossed out with a bold red X. The character Gena1 is partially visible in the foreground, his hand holding a marker, expression tense and worried. A single bead of sweat trickles down his temple. Cold blue-grey muted palette, dim lighting, mood of anxiety and urgency. Illustrated digital art style with sharp, clean lines and soft shadows.","video":"Camera starts with a quick, jarring zoom-in on the crossed-out date, then stabilizes with a slight handheld shake. Gena1’s hand trembles, the marker tip hovers over the next day. A faint, low hum of noise builds in the background. A sudden, brief flicker of warm light from an unseen source cuts through the cold palette, casting a shifting shadow across the calendar. Duration: 2 seconds.","desc_ru":"Крупный план календаря Гены, один зачеркнутый день, подразумевается шум, тревога."},{"n":12,"s":3,"keyframe":"Close-up on Gena's face, reflected in his glasses showing a PC screen playing a video titled 'How to be efficient'. His expression is one of despair, eyes wide, mouth slightly open. Cold blue-grey muted palette, illustrated digital art style. Harsh overhead lighting casts deep shadows, emphasizing his hollow cheeks and tired eyes. Composition tight, focusing on the reflection and his defeated posture. A single warm amber light from an unseen source catches the edge of his glasses, creating a stark contrast with the cold blue of the screen. A faint, almost imperceptible crack in the lens distorts the reflection, hinting at a deeper fracture.","video":"Camera starts with a rapid push-in over the first 0.5 seconds, then slows to a steady zoom over the remaining 2.5 seconds. Gena's micro-movements include a sharp intake of breath at 0.3s, a slight tremble of the lips, and a slow blink at 1.2s, as if holding back tears. The screen reflection flickers subtly, with a brief glitch at 0.8s that shows a distorted frame of the video. Lighting remains cold and static, but the warm amber light intensifies slightly during the blink, then fades. Timing: fast initial zoom, then steady, ending on a tight close-up of the reflected despair, with the crack in the lens now more prominent.","desc_ru":"Экран ПК Гены, видео 'как быть эффективным', отражение в очках, отчаяние."},{"n":13,"s":3,"keyframe":"Low-angle medium shot, gena1 stands on a grey urban street, daylight casts cool blue-grey shadows. He wears a muted coat, hands in pockets, posture stiff. His expression is awkward, eyes slightly averted. A single warm orange reflection from a distant window cuts across his shoulder, breaking the cold palette. One pocket is slightly torn, hinting at a past struggle. Digital art style, muted but with this one contrast.","video":"Camera holds steady for 0.5s, then gena1 shifts weight nervously, glances sideways, exhales a faint visible breath in cold air. In the first 0.5s, a car passes quickly in the background, creating motion contrast. Lighting remains flat and cool, but the warm reflection flickers once as the car moves. Duration 3 seconds, slow natural timing.","desc_ru":"Гена встречает Борю на улице, дневной свет, холодная палитра, неловкое расстояние."},{"n":14,"s":3,"keyframe":"A young man named Borya, wearing a hoodie, stands slightly off-center in a muted blue-grey room. He offers an awkward smile, his posture tense, with a faint breath visible in the cold air. A single warm light from an unseen source cuts across his face, contrasting with the cool shadows. His eyes flicker with a hint of mystery, as if he's hiding something. The composition is a medium shot, eye-level angle, with soft, cool lighting casting gentle shadows. The mood is uneasy yet calm, illustrated in a cold-toned, blue-grey palette with digital art style. Character trigger: gena1.","video":"The camera starts with a quick 0.5s zoom-in from a wider shot to a medium shot, then holds steady, subtly zooming in by 5% over the remaining 2.5s. Borya shifts his weight nervously, his smile flickering as he glances down briefly. The cool lighting remains constant, with a faint shadow moving across his face as he adjusts his stance. A single warm light source flickers momentarily, creating a brief contrast. Timing: fast initial zoom, then slow, deliberate micro-movements throughout the 3-second duration.","desc_ru":"Боря в худи с неловкой улыбкой, стоит непринужденно в голубовато-серой комнате, нервно."},{"n":15,"s":3,"keyframe":"Camera captures Gena1 in a medium shot, turning away with disdain. Cold, blue-grey muted palette. Harsh sidelight casts long shadows, emphasizing his detached expression. Composition leaves empty space ahead, suggesting departure. Illustrated digital art style with sharp, angular lines and frosty tones. A faint, warm amber glow flickers at the edge of the frame, hinting at an unseen presence.","video":"Gena1 jerks his head and shoulders away sharply, eyes narrowing with contempt. He steps left, exiting frame in 1.5 seconds. Light dims slightly as he moves, creating a fading silhouette. In the final 0.5s, a subtle, quick blink of amber light pulses in the empty space, then fades, leaving cold isolation.","desc_ru":"Гена отворачивается с пренебрежением, выходит из кадра в холодном свете, отстраненно."},{"n":16,"s":4,"keyframe":"Camera: medium long shot, slightly low angle, tracking Gena from the side as he runs. Composition: Gena occupies the left third of the frame, leading lines of the park path receding into the background. Character trigger: gena1. Pose: mid-stride, arms bent, one leg forward, one back, slight forward lean. Expression: focused, distant, mouth slightly open, eyes fixed ahead. Lighting: cold, overcast morning light, soft diffused shadows, blue-grey palette dominating. Mood: melancholic, introspective, solitary.","video":"Camera movement: smooth lateral tracking dolly, keeping Gena centered in frame, slight parallax with trees passing in background. Character micro-movement: rhythmic arm swing, slight bob of the head, visible breath misting in cold air. Lighting change: subtle shift as clouds pass, light dims and brightens slightly, maintaining cold tones. Timing: 4 seconds, steady pace, no cuts.","desc_ru":"Гена бежит в парке утром, холодный свет, меланхоличное настроение."},{"n":17,"s":2,"keyframe":"A wall calendar showing the current month, with one week roughly crossed out in thick, dark strokes. The composition is tight, focusing on the calendar page, but the calendar is positioned slightly off-center to the left. The character gena1 is not visible, only implied by the action and a faint shadow on the wall behind the calendar. The lighting is cold, with a blue-grey palette dominating the scene. The mood is one of urgency, frustration, or the relentless passage of time, with a hint of mystery from the shadow.","video":"The camera holds steady on the calendar, which is slightly off-center to the left. A hand (implied to be gena1's) enters the frame quickly from the right, holding a dark marker. The hand makes a swift, aggressive, diagonal stroke across the entire week, crossing out all seven days at once. The marker squeaks slightly. The hand exits the frame as quickly as it entered. The lighting remains cold and unchanged. A faint shadow of a person is cast on the wall behind the calendar, adding mystery. The entire action takes exactly 2 seconds, with the crossing-out motion occurring in the middle of the shot.","desc_ru":"Календарь с быстро вычеркнутой неделей, сине-серые тона."},{"n":18,"s":3,"keyframe":"Camera: Medium shot, slightly low angle, focused on Gena at a cluttered desk. Composition: Gena is centered, leaning forward, writing frantically. Dumbbells are visible on the floor in the foreground, out of focus. Character: gena1, disheveled hair, untucked wrinkled shirt, sleeves rolled up unevenly. Pose: Hunched over, one hand gripping a pen, the other pressing down on paper. Expression: Intense, furrowed brows, slightly open mouth, eyes wide with manic focus. Lighting: Harsh overhead desk lamp casting deep shadows, cold blue-grey ambient light from a window. Mood: Desperate, chaotic, driven. Cold tones blue-grey palette.","video":"Camera: Subtle handheld sway, slow zoom-in towards Gena's face over 3 seconds. Character micro-movement: Gena's hand scribbles rapidly, his head jerks up slightly as if struck by an idea, then he scratches his messy hair with the pen hand. Lighting change: The desk lamp flickers once, casting a brief shadow across his face. Timing: 0-1s: Establish scene with sway. 1-2.5s: Zoom in as he scratches head and scribbles. 2.5-3s: Lamp flicker, final close-up on his intense expression.","desc_ru":"Растрепанный Гена пишет бизнес-план, гантели на полу, рубашка не заправлена."},{"n":19,"s":3,"keyframe":"Экран Excel с графиками и бизнес-планом, синие холодные тона. Камера: статичный фронтальный кадр, композиция: монитор занимает 80% кадра, на заднем плане размытый офис. Персонаж: gena1 (не виден, только отражение в стекле монитора или тень на стене). Поза: отсутствует. Выражение: отсутствует. Освещение: холодный синий свет от экрана, контрастное, с бликами на стекле. Настроение: деловая напряженность, холодная аналитика. Цветовая палитра: сине-серые тона, #1a3a5c, #2c5f8a, #d0e0f0.","video":"Камера: легкий пульсирующий зум (0.5% в течение 3 секунд), создающий эффект дыхания. Движение персонажа: gena1 не виден, но его тень на стене слегка колеблется от движения. Освещение: медленное мерцание экрана (частота 0.5 Гц), имитирующее обновление данных. Тайминг: 0-1с статика, 1-2.5с пульсация, 2.5-3с легкое затемнение к концу сцены.","desc_ru":"Экран Excel с графиками и бизнес-планом, синие холодные тона."},{"n":20,"s":3,"keyframe":"Camera: medium shot, slightly low angle, focusing on Gena1 lounging on a worn leather sofa, book open in hands. Composition: Gena1 positioned in the left third, warm lamp glow on the right creating a chiaroscuro effect. Character trigger: gena1. Pose: slouched, legs crossed, one hand holding book, other resting on sofa arm. Expression: melancholic, distant gaze, slight frown, eyes half-lidded. Lighting: warm amber lamp light from the right, cool blue-grey shadows on the left side of face and body. Mood: quiet melancholy, introspective solitude. Cold tones blue-grey palette: deep slate, muted cerulean, soft charcoal, with warm amber accent.","video":"Camera movement: slow, subtle push-in from medium to medium-close shot over 3 seconds, slight handheld tremor for intimacy. Character micro-movement: Gena1 slowly turns a page at 1.5s, then lets out a soft sigh, shoulders dropping slightly. Lighting change: lamp light flickers imperceptibly at 2s, as if from a draft, then stabilizes. Timing: 0-1s: stillness, 1-2s: page turn and sigh, 2-3s: slight settling into sofa, camera holds final frame.","desc_ru":"Меланхоличный Гена читает на диване, вечерний теплый свет лампы."},{"n":21,"s":3,"keyframe":"camera: static medium shot, slightly low angle, centered on a large monitor displaying a Bitcoin candlestick chart with red and green candles, overlaid with scrolling news headlines in cold blue-grey tones. composition: monitor fills 80% of frame, chart dominates left side, news ticker runs along bottom edge. character: gena1 stands in profile to the right, one hand resting on the desk, face half-lit by screen glow. pose: leaning slightly forward, shoulders tense. expression: focused, eyes narrowed, lips pressed thin. lighting: cold key light from monitor (blue-white), rim light from overhead (cool grey), deep shadows on left side of face. mood: tense, analytical, cold urgency. palette: steel blue, slate grey, icy white, muted teal.","video":"camera: subtle handheld micro-jitter, slow push-in from 0s to 1.5s, then hold steady. character: gena1's fingers tap desk twice (0.5s, 1.2s), slight shift of weight from left to right foot (1.8s), slow exhale visible in shoulder drop (2.5s). lighting: screen flicker from chart update at 0.8s and 2.2s, causing brief intensity change on gena1's face. timing: total 3s, cuts on action at 1.5s (push-in stop) and 2.5s (exhale).","desc_ru":"Экран с графиком биткоина и новостными заголовками, холодные сине-серые тона."},{"n":22,"s":3,"keyframe":"Gena1, close-up, face illuminated by screen glow, wide happy smile, eyes reflecting blue light, cold blue-grey palette, soft rim light from screen, mood: joyful wonder","video":"Camera slowly pushes in, Gena's smile widens naturally, screen flickers gently, slight head tilt, 3s duration, glow intensifies subtly","desc_ru":"Счастливый Гена открывает AI, свечение экрана на лице."},{"n":23,"s":3,"keyframe":"Close-up on gena1's face, eyes half-lidded and tired, blue-grey screen light reflecting in the pupils. Cold, desaturated palette with deep shadows under the eyes. Composition: shallow depth of field, code lines blurred in the foreground, sharp on the eyes. Gena1's gaze is shifted slightly to the right, creating a sense of off-center tension. A single tear glistens at the corner of the left eye, contrasting with the cold tones.","video":"Slow zoom-in (0.5s) to the eyes, then hold. Subtle micro-movement: gena1 blinks slowly once, eyelids heavy. Screen light flickers slightly (code scrolling). At 1.5s, a faint, mysterious reflection of a human silhouette appears briefly in the screen light on the cornea, then fades. Timing: 3s total, with the blink at 1.5s and silhouette at 2.0s.","desc_ru":"Код на экране отражается в уставших глазах Гены, сине-серые тона."},{"n":24,"s":2,"keyframe":"Close-up on a wall calendar. A single month page is visible, with a red marker line slashing diagonally across it. The composition is tight, focusing on the texture of the paper and the bold, hurried stroke of the marker. Lighting is cold, blue-grey, casting a faint shadow from the marker. Mood is final, decisive, with a hint of urgency. Character: gena1 (not visible, implied by the action).","video":"Camera holds steady on the calendar. The red marker stroke appears rapidly, as if drawn in a single, swift motion. The marker tip lifts off the page, leaving a slight ink smear. The lighting remains cold and static. Timing: 2 seconds total. The stroke occurs within the first 0.5 seconds, then holds for the remaining 1.5 seconds, emphasizing the finality of the action.","desc_ru":"Календарь с быстро вычеркнутым месяцем, штрихи маркера."},{"n":25,"s":3,"keyframe":"Camera: medium two-shot, slightly low angle, centered. Composition: Gena (left, slouched, unkempt) and Borya (right, upright, neat). Character trigger: gena1. Pose: Gena with hands in pockets, shoulders hunched; Borya with arms crossed, chin slightly raised. Expression: Gena melancholic, tired eyes; Borya confident, slight smirk. Lighting: cold, desaturated blue-grey palette, soft overhead with harsh shadows under eyes. Mood: contrast of melancholy vs confidence, somber yet tense.","video":"Camera: slow push-in from medium to medium-close, slight pan right to center Borya. Character micro-movement: Gena shifts weight, looks down briefly; Borya uncrosses arms, adjusts collar. Lighting change: subtle shift from flat grey to a faint cool rim light on Borya, Gena remains in shadow. Timing: 3 seconds, slow and deliberate, pause on final frame.","desc_ru":"Меланхоличный Гена встречает уверенного Борю, контраст неопрятности и опрятности."},{"n":26,"s":3,"keyframe":"Боря (borya1) в складской форме, уверенная поза, рука указывает вперёд, холодное освещение, сине-серые тона, строгий взгляд, лёгкая полуулыбка.","video":"Камера медленно наезжает на Борю, он слегка поворачивает голову, указывая рукой направление, свет становится чуть ярче, подчёркивая контуры формы, длительность 3 секунды.","desc_ru":"Уверенный Боря в складской форме, руководит, холодные тона."},{"n":27,"s":4,"keyframe":"Camera: medium close-up, slightly low angle, focused on Gena's face and upper body, with the cluttered desk visible in the foreground. Composition: Gena sits hunched over a laptop, his face illuminated by the blue screen glow; empty coffee cups, scattered papers, and cables create a chaotic foreground. Character: gena1, pose: slouched forward, elbows on the desk, hands resting near the keyboard, head tilted slightly down. Expression: tired, melancholic, eyes half-lidded with dark circles, a faint frown. Lighting: cold, blue-grey palette, primary light from the laptop screen casting sharp shadows on his face, secondary dim ambient light from a desk lamp in the corner. Mood: somber, introspective, late-night exhaustion.","video":"Camera movement: slow, subtle push-in (dolly forward) over 4 seconds, starting from a wider medium shot to a tighter close-up on Gena's face. Character micro-movement: Gena blinks slowly once, then lets out a quiet sigh, his shoulders rising and falling slightly; his fingers twitch near the keyboard but do not type. Lighting change: the laptop screen flickers faintly once, causing a brief shift in the blue glow on his face, then returns to steady. Timing: 0-1s: camera begins push-in, Gena holds still; 1-2.5s: slow sigh and shoulder drop; 2.5-3.5s: blink and finger twitch; 3.5-4s: screen flicker and final stillness.","desc_ru":"Меланхоличный Гена программирует ночью, беспорядок на столе."},{"n":28,"s":3,"keyframe":"Крупный план интерфейса с синей кнопкой 'Купить', подсвеченной холодным голубым светом. Экран занимает 2/3 кадра, на заднем плане — размытый силуэт gena1, сидящего в темноте. Кнопка в центре композиции, её края слегка пульсируют. Цветовая палитра: холодные сине-серые тона, контраст между яркой кнопкой и тёмным фоном. Настроение: напряжённое, технологичное, отчуждённое.","video":"Камера медленно наезжает на кнопку (0.5s), затем останавливается. gena1 делает микродвижение — его палец зависает над экраном, слегка дрожит. Свет от кнопки мерцает, создавая эффект нестабильности. В последнюю секунду тень от пальца gena1 падает на кнопку, затемнение. Длительность: 3s.","desc_ru":"Синяя кнопка 'Купить' подсвечена на интерфейсе, холодный свет экрана."},{"n":29,"s":2,"keyframe":"A close-up of a calendar on a wall, pages flipping rapidly in a blur. The camera is static, focused on the calendar. The composition is tight, showing only the calendar and a sliver of the wall. Gena1 is not visible. The lighting is cool, with a blue-grey palette, casting a dim, melancholic mood. The pages are a soft white with grey dates, the motion creating a sense of passing time. A single hand (Gena1's) briefly enters the frame from the left, fingers pinching the corner of a page, then retreats, leaving a faint shadow on the wall.","video":"The camera remains still. The calendar pages flip quickly, creating a soft rustling sound. The motion of the pages is the only movement, with a slight blur effect to emphasize speed. The lighting remains constant, cool and muted. The timing is exactly 2 seconds, with the pages flipping at an increasing pace, then abruptly stopping on a specific date (e.g., December 31st) for a brief moment before the scene ends. During the flip, a hand enters from the left edge, pauses for 0.3 seconds, then exits; the pages continue flipping without pause.","desc_ru":"Страницы календаря быстро перелистываются, месяцы сливаются."},{"n":30,"s":3,"keyframe":"Camera: medium shot, slightly low angle, centered on Borya1. Composition: Borya1 stands in a dimly lit room, wearing a formal jacket, one hand raised in a ceremonial gesture as if pressing a button or unveiling something. Pose: upright, solemn, with a slight forward lean. Expression: melancholic yet dignified, a faint, bittersweet smile. Lighting: cold, blue-grey palette, soft key light from the side, casting long shadows. Mood: solemn, nostalgic, with a touch of quiet triumph.","video":"Camera: slow push-in towards Borya1, subtle handheld tremor for intimacy. Character micro-movement: Borya1's hand descends slowly, fingers trembling slightly; a deep, slow exhale, shoulders drop a fraction. Lighting change: a single, warm spotlight flickers on behind him, then fades to cold blue-grey again. Timing: 3 seconds total — 0-1s camera push-in and hand movement, 1-2.5s spotlight flicker and exhale, 2.5-3s return to cold tone and stillness.","desc_ru":"Меланхоличный Гена в пиджаке торжественно запускает продукт."},{"n":31,"s":3,"keyframe":"Camera: static medium shot, slightly low angle, centered on Borya1. Composition: Borya1 in foreground left, dashboard monitor in background right, empty graphs and zero sales data visible on screen. Character: borya1, pose: standing, arms crossed, leaning slightly forward, expression: concerned, furrowed brows, tight lips. Lighting: cold, blue-grey palette, harsh overhead office light casting shadows, monitor glow on face. Mood: tense, disappointment, stagnation.","video":"Camera: static, no movement. Character micro-movement: Borya1's eyes slowly scanning the empty graphs, a slight swallow, then a slow exhale, shoulders drop slightly. Lighting change: monitor flickers once, casting a brief brighter blue glow on Borya1's face, then returns to steady cold light. Timing: 3 seconds total, first 1.5s scanning, last 1.5s reaction and exhale.","desc_ru":"Дашборд аналитики показывает нулевые продажи, пустые графики, Гена смотрит."},{"n":32,"s":3,"keyframe":"Camera: medium close-up, slightly low angle, centered on Гена. Composition: Гена sits hunched over, elbows on knees, face buried in hands, fingers tangled in disheveled hair. Character trigger: borya1. Pose: collapsed forward, shoulders slumped, head bowed. Expression: despair, exhaustion, hidden face. Lighting: dim, single cool blue key light from above, casting deep shadows under hands and across body. Mood: hopeless, heavy, isolated. Cold tones blue-grey palette: muted steel blue, slate grey, pale icy highlights.","video":"Camera movement: slow, subtle push-in from medium to tighter close-up over 3 seconds, emphasizing isolation. Character micro-movement: slight trembling of shoulders, fingers twitching in hair, a barely perceptible shudder. Lighting change: key light slowly dims by 10%, shadows deepen, a faint flicker of blue light (like a monitor) pulses once on the back wall. Timing: 0-1s camera begins push-in, 1-2s micro-movements intensify, 2-3s lighting dims and flicker occurs, hold final frame for 0.5s.","desc_ru":"Гена сидит в отчаянии, лицо в руках, волосы всклокочены."},{"n":33,"s":3,"keyframe":"Camera: medium close-up, slightly low angle, focused on Borya1's face and upper body. Composition: Borya1 centered, hands hovering over a keyboard or tablet, screen edge visible with a blank new project tab. Character trigger: borya1. Pose: leaning slightly forward, shoulders relaxed but engaged, fingers poised. Expression: eyes wide with a glimmer of hope, subtle half-smile, eyebrows slightly raised. Lighting: soft, cool blue-grey key light from the screen, casting gentle shadows, ambient cold tones. Mood: optimistic anticipation, quiet determination. Palette: cold tones, blue-grey, with a faint warm highlight on the face for contrast.","video":"Camera: subtle slow push-in (0.5s delay, then 2.5s gentle zoom) to intensify focus on Borya1's expression. Character micro-movement: Borya1's fingers twitch slightly as if about to type, a slow deep breath causing a slight rise of shoulders, then a soft exhale. Lighting change: screen glow flickers once (0.3s) as the new tab loads, then stabilizes, slightly brightening the face. Timing: total 3s; first 0.5s for initial stillness, 1s for breath and finger twitch, 1.5s for push-in and expression settling.","desc_ru":"Гена открывает новую вкладку проекта, в глазах надежда."},{"n":34,"s":3,"keyframe":"Gena sits at a cluttered wooden desk, typing on an old typewriter. Stacks of paper and a full ashtray surround him. Camera is at eye level, slightly tilted down to show the mess. Borya1 is in a hunched, focused pose, expression tired and intense. Lighting is dim, with a single desk lamp casting harsh shadows. Mood is melancholic, cold tones with a blue-grey palette.","video":"Camera slowly zooms in on Gena's face over 3 seconds. His fingers tap the keys with a slight, rhythmic tremor. The lamp flickers once, briefly. Timing: steady zoom, no cuts, ending on a close-up of his eyes.","desc_ru":"Гена печатает книгу в окружении стопок бумаги и полной пепельницы."},{"n":35,"s":3,"keyframe":"Close-up of borya1's fingers on a keyboard, screen shows 'как продать кому угодно'. Fingers at rule-of-thirds intersection (lower right), not center. One finger slightly raised mid-air, a micro-action of hesitation. Warm light from a small desk lamp casts a sharp edge across the left side of the keyboard, contrasting with cool blue-grey shadows. In the blurred background, a faint, unexplained silhouette of a hand holding a phone, partially obscured. First 0.5s: a single finger twitches, immediately drawing the eye.","video":"Camera static, slight dolly in over 3s. Fingers tap keys rhythmically, but with a micro-action: at 0.5s, the raised finger twitches once, then resumes typing. Screen text flickers faintly, with a brief glitch at 1.2s (a single character changes to a symbol, then back). Lighting dims slightly at 2s, then holds, but the warm light edge shifts subtly, creating a moving contrast. Timing: steady typing pace, but the initial twitch and text glitch create mystery and hook.","desc_ru":"Крупный план пальцев Гены на клавиатуре, на экране 'как продать кому угодно'."},{"n":36,"s":3,"keyframe":"Medium close-up, gena1 holds phone off-right, eyes scanning screen with slight frown. Warm lamp light from right, cool blue screen light on face. Evening mood, muted cold tones with warm accent. Illustrated digital art style. A faint shadow of a hand appears on the wall behind, unexplained.","video":"Static camera, gena1 blinks slowly, eyes shift left-right reading, thumb scrolls once at 0.3s. Screen light flickers subtly. Breathing steady, slight head tilt at 1.5s. At 2.5s, gena1's finger twitches near the phone edge. Timing: 3s total.","desc_ru":"Гена смотрит на телефоне пост Бори в соцсетях."},{"n":37,"s":3,"keyframe":"Close-up of borya1 (man 30-40, round face, broader build) typing furiously, off-center left at rule-of-thirds intersection, harsh overhead lighting casting deep shadows across face, one eye in shadow, the other catching cold blue screen glow, background blurred with a faint, unexplained silhouette of a hand pressed against a window, muted cold tones with blue-grey palette, illustrated digital art style, first 0.5s shows a micro-action: a single finger twitch mid-air before striking the keyboard.","video":"Static camera, borya1's fingers tap aggressively on keyboard, rapid blinking, jaw clenching, slight head shake, lighting flickers subtly from screen glow, at 0.5s a micro-action: a sharp intake of breath and a quick eye dart to the left (toward the silhouette), at 2.0s a sudden pause in typing, lips part slightly as if about to speak, then resumes with increased intensity, duration 3s, each movement conveys escalating anger and mystery.","desc_ru":"Гена яростно печатает комментарий, напряженное выражение лица."},{"n":38,"s":4,"keyframe":"Night chaos on a desk: pizza box, energy drinks, cables, one monitor. borya1 sits at left rule-of-thirds intersection, round face, broader build, exhausted pose, head down, dim overhead light, blue-grey cold tones, mood of fatigue, illustrated digital art. A single red cable snakes across the desk, its tip glowing faintly, casting a warm red reflection on the pizza box. A half-empty energy drink can is tilted, with a drop of liquid about to fall. The monitor screen shows a distorted, unreadable code snippet.","video":"Static camera, borya1 slowly lifts head, blinks heavily, shifts weight, slight exhale. At 0.5s, a micro-action: his left index finger twitches once. At 1.5s, his eyes dart quickly to the glowing red cable tip, then back down. At 2.5s, the energy drink drop falls, creating a tiny splash sound. Cables flicker, lighting dims slightly over 4s. Timing: 0-0.5s stillness with finger twitch, 0.5-1.5s slow head lift and eye dart, 1.5-3s continued movement with drop fall, 3-4s return to stillness.","desc_ru":"Ночной хаос на столе: коробка пиццы, энергетики, провода, один монитор."},{"n":39,"s":2,"keyframe":"Medium shot, borya1 (man 30-40, round face, broader build) stands at left rule-of-thirds intersection, staring at a blue screen displaying 'IQ 140' in bold white text. His expression is neutral, slightly surprised, with a subtle lip part and a faint shadow of a handprint on the screen's edge. Lighting from screen casts cool blue glow on his face, with a sharp edge of warm light from an unseen source on his right shoulder. Dark room, muted cold tones, blue-grey palette. Style: illustrated digital art.","video":"Static camera, subtle dolly in over 2s to emphasize screen. In the first 0.5s, Borya1's right index finger twitches once, then he blinks slowly. At 0.5s, his eyes dart to the screen's edge where a faint handprint shadow appears, then he tilts his head slightly as he reads the result. Screen flickers faintly, with a brief, unexplained dark shape passing behind Borya1 at 1.2s. Lighting remains steady blue glow with warm edge. Timing: first 0.5s for finger twitch and blink, 1.5s for eye dart, head tilt, and shadow pass.","desc_ru":"Результат теста IQ 140 на синем экране."},{"n":40,"s":2,"keyframe":"Medium shot, borya1 sits off-left at rule-of-thirds intersection, round face half-lit by blue-grey monitor glow, a single sharp shadow edge cutting across the cheek. In the blurred background, a faint silhouette of a hand pressing against a window—unexplained. Style: illustrated digital art.","video":"Static camera, borya1 blinks slowly, then a micro-action: a quick eye dart to the left (toward the silhouette) and a lip part as if about to speak. Finger taps desk twice, but on the second tap, a sudden, subtle monitor flicker reveals a brief, distorted number on the sudoku grid. Lighting dims slightly at 1s, but the silhouette remains visible, creating mystery. First 0.5s: immediate hook with the eye dart and silhouette.","desc_ru":"Сетка судоку на сине-сером мониторе, тусклое освещение комнаты, меланхоличное настроение."},{"n":41,"s":3,"keyframe":"Medium shot, borya1 (man 30-40, round face, broader build) sits at a desk, face illuminated by warm light from a screen off-left, cold blue-grey background. He looks down with a soft, surprised expression. Muted cold tones with a warm glow on his face. Style: illustrated digital art. Character is off-center, positioned at the right rule-of-thirds intersection. In the background, a faint, unexplained shadow of a hand rests on the wall, just visible. A single tear catches the warm light on his cheek.","video":"Static camera, borya1 blinks slowly (0.5s), then his right index finger twitches once against the desk. He lifts his gaze slightly, eyes widening as he reads (1.5s). A subtle breath, shoulders rise and fall. Warm light flickers gently on his face over 3s, contrasting the cold palette. At 2.5s, his lip parts slightly as if to speak, but he stops. Timing: 0.5s for blink and finger twitch, 1.5s for head lift and expression change, 1s for lip part and hold.","desc_ru":"Текст AI-чата 'ты особенный', теплый свет на лице Гены, холодная палитра."},{"n":42,"s":2,"keyframe":"Medium shot, borya1 stands off-center right, hunched over a desk, rapidly flipping calendar pages with one hand, marker in the other. His round face shows intense focus, eyes wide. Dim overhead light casts harsh shadows, muted blue-grey palette, mood of frantic urgency. Illustrated digital art style. In the background, a single red string hangs from the ceiling, unexplained. A sharp edge of light cuts across his face, leaving one eye in shadow. His left hand twitches slightly before flipping.","video":"Static camera, borya1's hand flips pages in quick, jerky motions, marker squeaks against paper. His shoulders tense, breathing shallow. Lighting flickers slightly as pages turn, emphasizing chaos. Duration 2s, timing: first 0.5s shows a close-up of his eye darting to the red string, then pulls back to frantic flipping. First 1s: rapid page flips with a sudden pause at 0.8s where his finger twitches. Last 1s: marker scribbles, but at 1.5s his lip parts slightly as if about to speak, then cuts off.","desc_ru":"Листы календаря быстро перелистываются, скрип маркера, лихорадочная энергия, приглушенные тона."},{"n":43,"s":3,"keyframe":"A wide shot of a large calendar with '5 ЛЕТ' written on it, cold blue-grey light casts melancholic shadows. Borya1 stands off-left at the rule-of-thirds intersection, round face, broader build, arms crossed, somber expression. A single warm light edge cuts across his cheek, contrasting with the cold tones. In the background, a faint, unexplained shadow of a hand rests on the wall. Muted cold tones, illustrated digital art style.","video":"Static camera, slow dolly in on the calendar. Borya1 takes a deep breath, blinks slowly, shifts weight slightly. In the first 0.5s, his left index finger twitches once. Lighting remains cold and steady, but the warm edge on his face flickers subtly. Timing: 3 seconds, melancholic mood.","desc_ru":"Большой календарь с надписью '5 ЛЕТ', холодный свет отбрасывает сине-серые тени, меланхолично."},{"n":44,"s":3,"keyframe":"Medium shot, borya1 stands off-right in an old jacket before a fogged mirror, room in disarray behind him. His round face shows melancholy, but his eyes dart to a faint handprint on the mirror. Dim, cool lighting from a single window casts blue-grey tones, with a sharp edge of warm light from an unseen source hitting his shoulder. Style: illustrated digital art.","video":"Static camera, borya1 breathes slowly, then his left index finger twitches against his jacket seam. He blinks once, and his eyes dart to the handprint on the mirror. At 0.5s, he shifts weight to his left foot, causing the reflection to waver. A shadow moves briefly in the background, unexplained. Lighting remains steady, but the warm edge on his shoulder creates contrast. Duration: 3s.","desc_ru":"Гена в старом пиджаке у запотевшего зеркала, комната в беспорядке, меланхолично."},{"n":45,"s":3,"keyframe":"Medium shot, borya1 stands off-center right at a party, round face with a slight smile, warm light from left side casting a sharp shadow edge across the face, muted cold tones with blue-grey hues, illustrated digital art style, mood of quiet observation amidst chatter, a single red balloon tied to a chair in the background, slightly out of focus, creating mystery.","video":"Static camera, borya1 blinks slowly, shifts weight subtly, turns head slightly to follow conversation, warm light flickers gently, timing: 3s, each movement conveys emotional detachment in the crowd, first 0.5s: borya1's eye darts to the red balloon then back to the conversation, adding a micro-action that hooks viewer curiosity.","desc_ru":"Вечеринка встречи, теплый свет, люди болтают, приглушенная холодная палитра, эмоционально."},{"n":46,"s":3,"keyframe":"Medium shot, borya1 walks confidently toward camera from off-left, positioned at left rule-of-thirds intersection, oval face with determined expression, cold blue-grey lighting from front-left creating sharp contrast on right side of face, overcast mood, muted cool tones, illustrated digital art style, a faint shadow of an unseen figure appears on the wall behind him, his right hand twitches slightly at his side.","video":"Static camera, borya1 strides forward with steady steps, slight head lift, firm jaw, subtle weight shift with each step, lighting remains cold and consistent, 3s duration, confident timing, in the first 0.5s his eyes dart briefly to the right before locking forward, a single breath visible as his chest rises, the shadow behind him shifts subtly as if moving independently.","desc_ru":"БОРЯ уверенно подходит, контрастный внешний вид, холодные сине-серые тона, решительное настроение."},{"n":47,"s":3,"keyframe":"Close-up of borya1, face at left rule-of-thirds intersection, oval face with a stern expression, cold light from above-left casting sharp shadows, a single warm light source from behind-right creating a thin rim light on the right side of the face, muted blue-grey palette, a faint, unexplained shadow of a hand on the wall behind, mood of reproach and tension, illustrated digital art style.","video":"Static camera, borya1's right index finger twitches slightly at 0s, then he blinks slowly at 0.5s, narrows eyes at 1s, slight head tilt down at 1.5s, weight shifts subtly at 2s, cold light flickers faintly over 3s, timing: 0-0.5s finger twitch, 0.5-1s blink, 1-1.5s eye narrow, 1.5-2s head tilt, 2-3s hold glare with a micro-expression of a lip part at 2.5s.","desc_ru":"Крупный план БОРИ: 'Что ты делал всё это время?', холодный свет, приглушенная палитра, мрачный упрек."},{"n":48,"s":2,"keyframe":"Close-up of borya1, off-center at rule-of-thirds intersection, empty eyes with a sudden micro-eye-dart to the left, lifeless expression but with a subtle lip part, cold blue-grey light from above creating a sharp shadow edge across the face, melancholic mood, muted cold tones, illustrated digital art style, a faint unexplained shadow of a hand in the background","video":"Static camera, slow blink, slight head tilt down, shallow breathing, lighting remains cold and static, 2s duration, silence emphasized, first 0.5s starts with the micro-eye-dart and lip part to hook immediately","desc_ru":"Крупный план ГЕНЫ: пустые глаза, безжизненное лицо, холодный сине-серый свет, меланхоличная тишина."},{"n":49,"s":3,"keyframe":"A rapid montage of a 'Start' button, IQ icon, sudoku puzzle, open book, and AI button, all in muted cold tones. borya1 (man 30-40, round face, broader build) is off-center left at the rule-of-thirds intersection, partially visible, with a focused expression. A single warm highlight edge traces his jawline against the cold blue-grey background. In the background, a faint, unexplained shadow of a hand hovers near the AI button. Lighting is dim, cool blue-grey, suggesting a late-night mood. Style: illustrated digital art.","video":"Static camera with quick cuts between elements every 0.5s. borya1 blinks slowly, fingers tapping lightly on the table. At 0.5s, during the IQ icon cut, his left eye darts sharply to the right. At 1.0s, during the sudoku cut, his lips part slightly as if about to speak. At 1.5s, during the book cut, his shoulder tenses briefly. At 2.0s, during the AI button cut, his right index finger twitches. Lighting remains consistent, cold and subdued, with the warm highlight on his jawline persisting. Timing: 3s total, each element shown for 0.5s, with borya1's micro-movements adding tension. The first 0.5s opens with the 'Start' button and borya1's eye dart immediately to hook the viewer.","desc_ru":"Быстрый монтаж: кнопка 'Запуск', IQ, судоку, книга, кнопка AI, приглушенные холодные тона."},{"n":50,"s":2,"keyframe":"A black screen fills the frame, but at the lower-left rule-of-thirds intersection, a faint, cold grey shadow of a hand's outline is barely visible, as if pressed against glass from off-screen. The hand's index finger twitches slightly, creating a micro-action. A sharp diagonal edge of dim light cuts across the top-right corner, contrasting with the deep black void. In the background, a tiny, unexplained glint—like a distant star or a reflection—appears for a split second, then fades, leaving mystery.","video":"Static camera holds on black screen for 2 seconds. At 0.0s, the faint hand shadow appears with a finger twitch, immediately hooking attention. The glint flashes at 0.3s and vanishes. The hand shadow remains still after the twitch, but a subtle breath-like movement causes the shadow to pulse slightly. The sudden silence is broken by a single, low-frequency hum that fades out over 1.5s, creating tension. Timing: abrupt cut to black, but the micro-action and glint occur within the first 0.5s to prevent drop-off.","desc_ru":"Резкий переход к черному экрану, внезапная тишина, меланхоличная пустота."},{"n":51,"s":5,"keyframe":"A black screen with white text: '5 YEARS. WHAT HAVE YOU DONE?' in a cold, melancholic font, positioned off-center at the lower-left rule-of-thirds intersection. A faint, unexplained shadow of a hand appears at the upper-right edge, barely visible. A single cold blue light ray cuts diagonally across the screen, creating a sharp contrast edge. The text has a subtle micro-vibration (0.2s cycle) to suggest tension.","video":"Camera static. In the first 0.5s, the text appears instantly with a sharp cut, no fade. Simultaneously, the shadow of the hand twitches once (0.3s in). The cold blue light ray flickers slightly. Text holds for 2s, then at 2.5s (when viewer typically drops), the hand shadow slowly moves downward by 2% of frame height over 1s, creating mystery. Text fades out over 0.5s at 4.5s. Total 5s. Pace: abrupt start, then deliberate tension with micro-action.","desc_ru":"Черный экран, белый текст: '5 ЛЕТ. ЧТО ТЫ СДЕЛАЛ?', холодный меланхоличный шрифт."},{"n":52,"s":5,"keyframe":"Black screen with bold white text 'НЕ ПСИХОЛОГ' positioned at the upper-left rule-of-thirds intersection, QR code at bottom-right in cold blue-grey tones. A faint, unexplained shadow of a hand appears at the bottom-left edge, partially cut off. High contrast, moody atmosphere, illustrated digital art style with muted cold palette.","video":"Static camera, no movement. Text appears instantly (no fade) at 0s, holds for 3s, then fades out over 1s. QR code remains static. At 0.5s, a subtle micro-action: a single finger twitch from the shadow hand at bottom-left, barely visible. Cold blue-grey lighting remains constant, with a sharp edge of warm light hitting the shadow hand's fingertip, creating contrast.","desc_ru":"Черный экран, надпись 'НЕ ПСИХОЛОГ' с QR-кодом внизу, холодная цветовая гамма."}];
    
    const total = scenes.reduce((a,s)=>a+s.s,0);
    const mins = Math.floor(total/60);
    const secs = total%60;
    const scriptFrags = [
        {n:1,text:'Гена начинает свой путь. Комната чистая, утренний свет.'},
        {n:2,text:'Крупный план. Гена свежий, рубашка застёгнута, смотрит в камеру живыми глазами.'},
        {n:5,text:'На стене календарь. Первые отметки.'},
        {n:6,text:'Ночь. Синий свет монитора на лице Гены, ещё опрятен.'},
        {n:7,text:'Крупный план глаз. Тёмные круги.'},
        {n:10,text:'Гена листает телефон. Одна кружка кофе.'},
        {n:12,text:'Экран ПК: «Как стать эффективным» — отражение в очках.'},
        {n:14,text:'Боря в худи, неловкая улыбка.'},
        {n:18,text:'Гена пишет бизнес-план. Гантели на полу, рубашка навыпуск.'},
        {n:22,text:'Гена счастлив — открыл AI. Свет экрана на лице.'},
        {n:25,text:'Гена встречает Борю случайно на улице.'},
        {n:30,text:'Боря рассказывает про повышение. Контраст.'},
        {n:35,text:'Гена уже не выходит из дома. Комната в хаосе.'},
        {n:40,text:'Гена в темноте. Только экран. 4 кружки вокруг.'},
        {n:45,text:'Крупный план. Пустые глаза. Ничего не изменилось.'},
        {n:50,text:'Комната разруха. Гена сидит на полу среди мусора.'},
    ];
    const fragMap = {};
    scriptFrags.forEach((f,i)=>{fragMap[f.n]=i;});
    // Copy function
    window.copyScene = function(t){if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t);else{const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');document.body.removeChild(a);}const x=document.getElementById('toasts');if(x){const n=document.createElement('div');n.className='toast s';n.innerHTML='<div class="toast-dot"></div>Copied!<span class="toast-x" onclick="this.parentElement.remove()">\u2715</span>';x.appendChild(n);setTimeout(()=>n.remove(),1500);}};
    const container = el('div',{style:'display:grid;grid-template-columns:1.4fr 1fr;gap:32px;padding-top:16px'});
    // LEFT: script
    const scriptCol = el('div',{},
        el('div',{class:'sec-head',style:'margin-bottom:12px'},el('div',{class:'sec-title'},'\u0421\u0426\u0415\u041d\u0410\u0420\u0418\u0419')),
        el('div',{style:'display:flex;flex-direction:column;gap:4px'},
            ...scriptFrags.map((f,i)=>{
                const sc=scenes.find(x=>x.n===f.n);
                return el('div',{class:'card',id:'sf-'+i,style:'padding:8px 10px;font-size:12px;line-height:1.6;color:var(--ink-2);border-left:2px solid transparent;transition:.12s',
                    onmouseenter:()=>{const c=document.getElementById('sc-'+f.n);if(c)c.style.borderColor='var(--pos)';document.getElementById('sf-'+i).style.borderLeftColor='var(--pos)';document.getElementById('sf-'+i).style.color='var(--ink)';},
                    onmouseleave:()=>{const c=document.getElementById('sc-'+f.n);if(c)c.style.borderColor='';document.getElementById('sf-'+i).style.borderLeftColor='transparent';document.getElementById('sf-'+i).style.color='';}},
                    el('span',{style:'font-family:var(--mono);font-size:10px;color:var(--ink-3);margin-right:6px'},'#'+String(f.n).padStart(2,'0')),
                    sc?el('span',{style:'font-size:10px;color:var(--ink-3);background:var(--bg-2);padding:0 4px;border-radius:2px;font-family:var(--mono);margin-right:6px'},sc.s+'c'):null,
                    f.text,
                );
            }),
        ),
    );
    // RIGHT: scenes
    const sceneCol = el('div',{},
        el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px'},
            el('span',{style:'font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)'},'\u041a\u0410\u0414\u0420\u042b \u041f\u0420\u041e\u041c\u041f\u0422\u042b '+scenes.length+' ('+mins+':'+String(secs).padStart(2,'0')+')')),
        el('div',{style:'display:flex;flex-direction:column;gap:6px;max-height:calc(100vh-200px);overflow-y:auto;padding-right:4px'},
            ...scenes.map(s=>{
                const fi=fragMap[s.n];
                const kf=s.keyframe.replace(/'/g,"\\u2019");
                const vd=s.video.replace(/'/g,"\\u2019");
                return el('div',{class:'card',id:'sc-'+s.n,style:'padding:10px 12px;transition:.12s',
                    onmouseenter:()=>{document.getElementById('sc-'+s.n).style.borderColor='var(--pos)';if(fi!==undefined){const f=document.getElementById('sf-'+fi);if(f){f.style.borderLeftColor='var(--pos)';f.style.color='var(--ink)';}}},
                    onmouseleave:()=>{document.getElementById('sc-'+s.n).style.borderColor='';if(fi!==undefined){const f=document.getElementById('sf-'+fi);if(f){f.style.borderLeftColor='transparent';f.style.color='';}}}},
                    el('div',{style:'display:flex;align-items:center;gap:6px;margin-bottom:6px'},
                        el('span',{style:'font-family:var(--mono);font-size:10px;color:var(--ink-3)'},'#'+String(s.n).padStart(2,'0')),
                        el('span',{style:'font-size:10px;color:var(--ink-3);background:var(--bg-2);padding:0 4px;border-radius:2px;font-family:var(--mono)'},s.s+'c'),
                        el('span',{style:'font-size:9px;color:var(--ink-4);margin-left:auto;font-family:var(--mono)'},'\u041a\u0410\u0414\u0420'),
                        el('button',{style:'font-size:10px;background:none;border:1px solid var(--line);color:var(--ink-3);border-radius:3px;padding:1px 6px;cursor:pointer;font-family:var(--mono)',onclick:`()=>{event.stopPropagation();copyScene('${kf}');}`},'\u2715'),
                        el('span',{style:'font-size:9px;color:var(--ink-4);font-family:var(--mono)'},'\u0412\u0418\u0414\u0415\u041e'),
                        el('button',{style:'font-size:10px;background:none;border:1px solid var(--line);color:var(--ink-3);border-radius:3px;padding:1px 6px;cursor:pointer;font-family:var(--mono)',onclick:`()=>{event.stopPropagation();copyScene('${vd}');}`},'\u2715'),
                    ),
                    el('div',{style:'font-size:11px;line-height:1.5;color:var(--ink)'},s.keyframe),
                    el('div',{style:'font-size:10px;line-height:1.4;color:var(--ink-3);margin-top:4px;padding-top:4px;border-top:1px solid var(--line)'},el('span',{style:'color:var(--ink-4);margin-right:4px'},'\u0412\u0418\u0414\u0415\u041e:'),s.video),
                    s.desc_ru?el('div',{style:'font-size:10px;color:var(--ink-2);margin-top:4px;padding-top:4px;border-top:1px solid var(--line)'},s.desc_ru):null,
                );
            }),
        ),
    );
    container.appendChild(scriptCol);
    container.appendChild(sceneCol);
    return container;
}

export function StudioView(state, h) {
    const tabs = ['scripts', 'scenes', 'images', 'music', 'agents'];
    const labels = { scripts: 'Сценарии', scenes: 'Сцены', images: 'Изображения', music: 'Музыка', agents: 'Агенты' };
    const icons  = { scripts: '✍', scenes: '🎬', images: '◎', music: '♪', agents: '◉' };
    const activeTab = state.studioTab || 'scripts';

    const tabBar = el('div', { class: 'tab-bar' },
        ...tabs.map(t => el('button', {
            class: 'tab-btn' + (activeTab === t ? ' active' : ''),
            onclick: () => Store.dispatch('SET_STUDIO_TAB', t),
        }, `${icons[t]} ${labels[t]}`)),
    );

    let content;
    if (activeTab === 'scripts') content = ScriptsContent(state, h);
    else if (activeTab === 'scenes') content = ScenesContent(state, h);
    else if (activeTab === 'images') content = ImagesContent(state, h);
    else if (activeTab === 'music') content = MusicContent(state, h);
    else if (activeTab === 'agents') content = AgentsContent(state, h);

    return el('div', { class: 'page' }, tabBar, content);
}

// ─── CHAT ─────────────────────────────────────────────────────────────────
export function ChatView(state, h) {
    const activeProjName = state.activeProjectId ? (state.projects.find(p => p.id === state.activeProjectId)?.name || 'Глобальный') : 'Глобальный';

    // Tag filter bar
    const allTags = [...new Set(state.chatHistory.flatMap(m => m.tags || []))];
    const activeFilter = state.chatTagFilter;
    const tagFilterBar = allTags.length ? el('div', { class: 'chat-tag-filter' },
        el('span', { class: `chat-tag-item${!activeFilter ? ' active' : ''}`, onclick: () => Store.dispatch('SET_CHAT_TAG_FILTER', { filter: null }) }, 'Все'),
        ...allTags.map(t => el('span', { class: `chat-tag-item${activeFilter === t ? ' active' : ''}`, onclick: () => Store.dispatch('SET_CHAT_TAG_FILTER', { filter: t }) }, t)),
    ) : null;

    const filtered = activeFilter ? state.chatHistory.filter(m => (m.tags || []).includes(activeFilter)) : state.chatHistory;

    const messages = el('div', { class: 'chat-messages', id: 'chat-messages' },
        ...filtered.map(msg => ChatBubble(msg)),
        filtered.length === 0 ? ChatBubble({ role: 'assistant', content: `Привет! Я твой AI ассистент.\n\nУправляю задачами, финансами, привычками и проектами.\n\nНапиши что нужно — разберусь.`, time: Date.now() }) : null,
    );

    const inp = el('textarea', { class: 'chat-inp', id: 'chat-inp', placeholder: 'Напиши задачу, идею или вопрос...', rows: '1' });
    // БАГ #7: восстанавливаем черновик после F5
    const draft = localStorage.getItem('draft_message');
    if (draft) { inp.value = draft; requestAnimationFrame(() => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; }); }
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); h.sendChat(); } });
    inp.addEventListener('input', () => {
        localStorage.setItem('draft_message', inp.value); // сохраняем черновик при каждом изменении
        inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    });

    const sendBtn = el('button', { class: 'chat-send', id: 'chat-send-btn', onclick: () => h.sendChat() }, '▶');

    const dropOverlay = el('div', { class: 'drop-ov', id: 'drop-ov' },
        el('div', { style: { fontSize: '32px' } }, '📎'),
        el('div', { style: { fontSize: '12px', color: 'var(--t2)' } }, 'Отпусти файл'),
    );

    return el('div', { class: 'chat-wrap' },
        el('div', { class: 'chat-context' },
            el('span', {}, 'Контекст:'),
            el('span', { class: 'chat-ctx-proj', id: 'chat-ctx-proj' }, activeProjName),
            btn('ghost', 'Очистить', () => { Store.dispatch('CLEAR_CHAT'); h.render(); }),
            btn('ghost', '↓ Экспорт', () => h.exportChat()),
        ),
        tagFilterBar,
        el('div', { style: { position: 'relative', flex: '1', overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
            messages,
            dropOverlay,
        ),
        el('div', { class: 'chat-input-area' }, inp, sendBtn),
    );
}

function ChatBubble(msg) {
    const isUser = msg.role === 'user';
    const bubble = el('div', { class: 'msg-bubble' }, msg.content || '');
    const time   = el('div', { class: 'msg-time' }, msg.time ? new Date(msg.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
    const tags   = (msg.tags || []).length ? el('div', { class: 'msg-tags' }, ...(msg.tags || []).map(t => el('span', { class: 'msg-tag' }, t))) : null;
    const star   = msg.id ? el('button', { class: `msg-star${msg.starred ? ' on' : ''}`, onclick: () => Store.dispatch('STAR_CHAT_MSG', { id: msg.id }) }, '★') : null;
    return el('div', { class: `msg msg-${isUser ? 'user' : 'ai'}` }, bubble, time, tags, star);
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────
export function CalendarView(state, h) {
    const today  = new Date().toISOString().slice(0, 10);
    const view   = state.calView   || 'week';
    const offset = state.calOffset || 0;

    // Week reference
    const weekStart  = calAddDays(calWeekStart(today), offset * 7);
    const weekDays   = calWeekDays(weekStart);

    // Month reference
    const d0 = new Date(today.slice(0, 7) + '-01T00:00:00');
    d0.setMonth(d0.getMonth() + offset);
    const monthGrid    = calMonthGrid(d0.toISOString().slice(0, 10));
    const currentMonth = d0.getMonth();

    const selectedDay = state.calSelectedDay || today;

    const periodLabel = view === 'week'
        ? `${new Date(weekDays[0] + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${new Date(weekDays[6] + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
        : d0.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

    const header = el('div', { class: 'cal-header' },
        btn('btn-ghost btn-sm', '←', () => Store.dispatch('SET_CAL_OFFSET', { offset: offset - 1 })),
        el('div', { class: 'cal-period' }, periodLabel),
        btn('btn-ghost btn-sm', '→', () => Store.dispatch('SET_CAL_OFFSET', { offset: offset + 1 })),
        btn('btn-ghost btn-sm', 'Сегодня', () => Store.dispatch('SET_CAL_OFFSET', { offset: 0 })),
        el('div', { class: 'cal-view-switch' },
            btn(view === 'week'  ? 'btn-sm active-filter' : 'btn-sm btn-ghost', 'Неделя', () => Store.dispatch('SET_CAL_VIEW', { view: 'week' })),
            btn(view === 'month' ? 'btn-sm active-filter' : 'btn-sm btn-ghost', 'Месяц',  () => Store.dispatch('SET_CAL_VIEW', { view: 'month' })),
        ),
    );

    // Builds one day cell — shared between week and month views
    function DayCell(dateStr, compact) {
        const d       = new Date(dateStr + 'T00:00:00');
        const isToday = dateStr === today;
        const isSel   = dateStr === selectedDay;
        const { tasks, habits, finances } = calDayItems(state, dateStr);

        const headEl = compact
            ? el('div', { class: `cal-day-num${isToday ? ' today' : ''}` }, d.getDate())
            : el('div', { class: 'cal-day-head' },
                el('div', { class: 'cal-day-name' }, CAL_DAYS_RU[weekDays.indexOf(dateStr)] ?? ''),
                el('div', { class: `cal-day-num${isToday ? ' today' : ''}` }, d.getDate()),
              );

        const dotsEl = el('div', { class: 'cal-dots' },
            tasks.length    ? el('span', { class: 'cal-dot cal-dot-task' })    : null,
            habits.some(hb => !hb.today_done) ? el('span', { class: 'cal-dot cal-dot-habit' }) : null,
            finances.length ? el('span', { class: 'cal-dot cal-dot-finance' }) : null,
        );

        const cell = el('div', {
            class: `cal-day${compact ? ' cal-day-compact' : ''}${isToday ? ' today' : ''}${isSel ? ' selected' : ''}`,
            onclick: () => Store.dispatch('SET_CAL_DAY', { day: dateStr }),
        }, headEl, dotsEl, compact ? null : CalDayPills(tasks, habits, finances));

        cell.addEventListener('dragover',  e => { e.preventDefault(); cell.classList.add('drag-over'); });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', e => {
            e.preventDefault(); cell.classList.remove('drag-over');
            const tid = e.dataTransfer.getData('task-id');
            if (tid) Store.dispatch('SET_TASK_DUE', { id: tid, due_date: dateStr });
        });
        return cell;
    }

    // Grid
    const grid = view === 'week'
        ? el('div', { class: 'cal-week-grid' }, ...weekDays.map(d => DayCell(d, false)))
        : el('div', { class: 'cal-month-wrap' },
            el('div', { class: 'cal-month-header' }, ...CAL_DAYS_RU.map(n => el('div', { class: 'cal-month-day-name' }, n))),
            ...monthGrid.map(week => el('div', { class: 'cal-month-row' },
                ...week.map(dateStr => {
                    const cell = DayCell(dateStr, true);
                    if (new Date(dateStr + 'T00:00:00').getMonth() !== currentMonth) cell.classList.add('other-month');
                    return cell;
                })
            ))
          );

    // Detail panel for the selected day
    const { tasks: sTasks, habits: sHabits, finances: sFin } = calDayItems(state, selectedDay);
    const selLabel = new Date(selectedDay + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    const dayDetail = el('div', { class: 'cal-day-detail' },
        el('div', { class: 'cal-detail-head' },
            el('div', { class: 'cal-detail-date' }, selLabel),
            btn('btn-ghost btn-sm', '+ Задача', () => h.openModal('task', { due_date: selectedDay })),
        ),
        sTasks.length ? el('div', { class: 'cal-detail-section' },
            el('div', { class: 'cal-detail-label' }, '◈ Задачи'),
            ...sTasks.map(t => {
                const pill = el('div', { class: 'cal-event cal-event-task', draggable: 'true' },
                    el('div', { class: `task-check${t.done ? ' done' : ''}`, onclick: e => { e.stopPropagation(); Store.dispatch('TOGGLE_TASK', { id: t.id }); } }, t.done ? '✓' : ''),
                    el('span', { style: { flex: '1' } }, t.title),
                    el('button', { class: 'task-del', onclick: e => { e.stopPropagation(); Store.dispatch('DELETE_TASK', { id: t.id }); } }, '✕'),
                );
                pill.addEventListener('dragstart', e => e.dataTransfer.setData('task-id', t.id));
                return pill;
            }),
        ) : null,
        sHabits.length ? el('div', { class: 'cal-detail-section' },
            el('div', { class: 'cal-detail-label' }, '↺ Привычки'),
            ...sHabits.map(hb => el('div', { class: 'cal-event cal-event-habit' },
                el('span', { style: { fontSize: '13px' } }, hb.icon || '✓'),
                el('span', { style: { flex: '1' } }, hb.name),
                btn(`btn-sm ${hb.today_done ? 'btn-success' : 'btn-ghost'}`, hb.today_done ? '✓' : '○', () => Store.dispatch('TOGGLE_HABIT', { id: hb.id })),
            ))
        ) : null,
        sFin.length ? el('div', { class: 'cal-detail-section' },
            el('div', { class: 'cal-detail-label' }, '💳 Регулярные платежи'),
            ...sFin.map(f => el('div', { class: 'cal-event cal-event-finance' },
                el('span', { style: { flex: '1' } }, f.description || f.category),
                el('span', { style: { color: 'var(--red)', fontWeight: '600' } }, '-' + fmt(f.amount)),
            ))
        ) : null,
        !sTasks.length && !sFin.length && !sHabits.length
            ? el('div', { class: 'cal-empty-day' }, 'Свободный день ✨')
            : null,
    );

    return el('div', { class: 'page cal-view' }, header, grid, dayDetail);
}

function CalDayPills(tasks, habits, finances) {
    const items = [];
    tasks.slice(0, 3).forEach(t => {
        const pill = el('div', { class: 'cal-event cal-event-task', draggable: 'true', title: t.title },
            t.title.slice(0, 18) + (t.title.length > 18 ? '…' : ''),
        );
        pill.addEventListener('dragstart', e => e.dataTransfer.setData('task-id', t.id));
        items.push(pill);
    });
    if (tasks.length > 3) items.push(el('div', { class: 'cal-event-more' }, `+${tasks.length - 3} ещё`));
    const summaryParts = [];
    if (habits.length)  summaryParts.push(`🔥 ${habits.filter(hb => !hb.today_done).length}/${habits.length}`);
    if (finances.length) summaryParts.push(`💳 ${finances.length}`);
    if (summaryParts.length) items.push(el('div', { class: 'cal-day-summary' }, summaryParts.join(' · ')));
    return el('div', { class: 'cal-day-events' }, ...items);
}

// ─── HEALTH ───────────────────────────────────────────────────────────────
function WorkoutsTab(state, h) {
    const today = new Date().toISOString().slice(0, 10);

    // Week goal progress
    const weekStart = calWeekStart(today);
    const weekDays = calWeekDays(weekStart);
    const weekWorkouts = state.workouts.filter(w => weekDays.includes(w.date));
    const weekGoal = state.workoutWeekGoal || 3;
    const weekPct = Math.min(100, Math.round((weekWorkouts.length / weekGoal) * 100));

    const goalBar = el('div', { class: 'card', style: { marginBottom: '16px' } },
        label(`Цель недели: ${weekWorkouts.length} / ${weekGoal} тренировок`),
        el('div', { class: 'health-prog-track' },
            el('div', { class: 'health-prog-fill', style: { width: weekPct + '%', background: 'var(--p)' } }),
        ),
    );

    // Add workout form
    const typeInp = el('input', { class: 'finp', placeholder: 'Тип тренировки (Бег, Силовая, Йога...)' });
    const dateInp = el('input', { class: 'finp', type: 'date', style: { width: '150px' } });
    dateInp.value = today;
    const exercisesWrap = el('div', { class: 'health-exercises' });
    const addExRow = () => {
        const nameI = el('input', { class: 'finp', placeholder: 'Упражнение', style: { flex: '2' } });
        const setsI = el('input', { class: 'finp', type: 'number', placeholder: 'Подх.', style: { width: '70px' } });
        const repsI = el('input', { class: 'finp', type: 'number', placeholder: 'Повт.', style: { width: '70px' } });
        const wgtI  = el('input', { class: 'finp', type: 'number', placeholder: 'кг', style: { width: '60px' } });
        const row = el('div', { class: 'health-ex-row' }, nameI, setsI, repsI, wgtI,
            el('button', { class: 'task-del', onclick: () => row.remove() }, '✕'),
        );
        exercisesWrap.appendChild(row);
    };
    addExRow(); // initial row

    const saveWorkout = () => {
        const type = typeInp.value.trim() || 'Тренировка';
        const date = dateInp.value || today;
        const exercises = [...exercisesWrap.querySelectorAll('.health-ex-row')].map(row => {
            const inputs = row.querySelectorAll('input');
            return { name: inputs[0].value.trim(), sets: inputs[1].value, reps: inputs[2].value, weight: inputs[3].value };
        }).filter(e => e.name);
        Store.dispatch('ADD_WORKOUT', { type, date, exercises });
        toast(`Тренировка "${type}" сохранена 💪`, 's');
        typeInp.value = '';
        dateInp.value = today;
        exercisesWrap.replaceChildren();
        addExRow();
    };

    const form = el('div', { class: 'card', style: { marginBottom: '16px' } },
        label('Добавить тренировку'),
        el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, typeInp, dateInp),
        el('div', { class: 'health-ex-header' },
            el('span', {}, 'Упражнение'), el('span', {}, 'Подходы'), el('span', {}, 'Повторения'), el('span', {}, 'Вес'),
        ),
        exercisesWrap,
        el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
            btn('btn-ghost btn-sm', '+ Упражнение', addExRow),
            btn('btn-p btn-sm', '💾 Сохранить', saveWorkout),
        ),
    );

    // History grouped by date
    const byDate = {};
    state.workouts.forEach(w => { if (!byDate[w.date]) byDate[w.date] = []; byDate[w.date].push(w); });
    const history = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 14).map(date => {
        const ws = byDate[date];
        return el('div', { class: 'card', style: { marginBottom: '8px' } },
            el('div', { class: 'health-date-head' }, new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })),
            ...ws.map(w => el('div', { class: 'health-workout-row' },
                el('div', { class: 'health-workout-type' }, w.type || 'Тренировка'),
                w.exercises?.length ? el('div', { class: 'health-ex-list' }, ...w.exercises.map(e =>
                    el('span', { class: 'health-ex-chip' }, `${e.name} ${e.sets}×${e.reps}${e.weight ? ' ' + e.weight + 'кг' : ''}`)
                )) : null,
                el('button', { class: 'task-del', onclick: () => Store.dispatch('DELETE_WORKOUT', { id: w.id }) }, '✕'),
            )),
        );
    });

    return el('div', {},
        goalBar,
        form,
        history.length ? el('div', {}, secHead('История'), ...history) : null,
    );
}

function NutritionTab(state, h) {
    const today = new Date().toISOString().slice(0, 10);
    const goal  = state.nutritionGoal || { calories: 2000, protein: 100, fat: 60, carbs: 250 };
    const todayLogs = state.nutritionLogs.filter(n => n.date === today);

    const totals = todayLogs.reduce((acc, n) => ({
        calories: acc.calories + (n.calories || 0),
        protein:  acc.protein  + (n.protein  || 0),
        fat:      acc.fat      + (n.fat      || 0),
        carbs:    acc.carbs    + (n.carbs    || 0),
    }), { calories: 0, protein: 0, fat: 0, carbs: 0 });

    const progBar = (val, max, color) => el('div', { class: 'health-prog-track' },
        el('div', { class: 'health-prog-fill', style: { width: Math.min(100, Math.round((val / (max || 1)) * 100)) + '%', background: color } }),
    );

    const summaryCard = el('div', { class: 'card', style: { marginBottom: '16px' } },
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } },
            label('Сегодня'),
            btn('btn-ghost btn-sm', '⚙ Нормы', () => h.openModal('nutrition-goal', goal)),
        ),
        el('div', { class: 'health-macros-grid' },
            el('div', { class: 'health-macro' }, el('div', { class: 'health-macro-lbl' }, 'Калории'), el('div', { class: 'health-macro-val' }, `${Math.round(totals.calories)} / ${goal.calories}`), progBar(totals.calories, goal.calories, 'var(--p)')),
            el('div', { class: 'health-macro' }, el('div', { class: 'health-macro-lbl' }, 'Белки'), el('div', { class: 'health-macro-val' }, `${Math.round(totals.protein)}г / ${goal.protein}г`), progBar(totals.protein, goal.protein, 'var(--green)')),
            el('div', { class: 'health-macro' }, el('div', { class: 'health-macro-lbl' }, 'Жиры'), el('div', { class: 'health-macro-val' }, `${Math.round(totals.fat)}г / ${goal.fat}г`), progBar(totals.fat, goal.fat, 'var(--red)')),
            el('div', { class: 'health-macro' }, el('div', { class: 'health-macro-lbl' }, 'Углеводы'), el('div', { class: 'health-macro-val' }, `${Math.round(totals.carbs)}г / ${goal.carbs}г`), progBar(totals.carbs, goal.carbs, '#f7b731')),
        ),
    );

    // Add meal form
    const nameInp = el('input', { class: 'finp', placeholder: 'Название блюда' });
    const calInp  = el('input', { class: 'finp', type: 'number', placeholder: 'ккал', style: { width: '80px' } });
    const protInp = el('input', { class: 'finp', type: 'number', placeholder: 'Белки г', style: { width: '80px' } });
    const fatInp  = el('input', { class: 'finp', type: 'number', placeholder: 'Жиры г', style: { width: '80px' } });
    const carbInp = el('input', { class: 'finp', type: 'number', placeholder: 'Углев г', style: { width: '80px' } });
    const saveMeal = () => {
        const name = nameInp.value.trim();
        if (!name) return;
        Store.dispatch('ADD_NUTRITION', { name, calories: Number(calInp.value) || 0, protein: Number(protInp.value) || 0, fat: Number(fatInp.value) || 0, carbs: Number(carbInp.value) || 0 });
        nameInp.value = ''; calInp.value = ''; protInp.value = ''; fatInp.value = ''; carbInp.value = '';
    };

    const addForm = el('div', { class: 'card', style: { marginBottom: '16px' } },
        label('Добавить приём пищи'),
        nameInp,
        el('div', { class: 'health-macros-row' }, calInp, protInp, fatInp, carbInp),
        el('div', { style: { marginTop: '8px' } }, btn('btn-p btn-sm', '+ Добавить', saveMeal)),
    );

    // Today's meals
    const meals = todayLogs.length ? el('div', { class: 'card' },
        label('Приёмы пищи сегодня'),
        ...todayLogs.map(n => el('div', { class: 'health-meal-row' },
            el('div', { class: 'health-meal-name' }, n.name),
            el('div', { class: 'health-meal-meta' }, `${n.calories} ккал · Б:${n.protein} Ж:${n.fat} У:${n.carbs}`),
            el('button', { class: 'task-del', onclick: () => Store.dispatch('DELETE_NUTRITION', { id: n.id }) }, '✕'),
        )),
    ) : null;

    return el('div', {}, summaryCard, addForm, meals);
}

export function HealthView(state, h) {
    const tab = state.healthTab || 'workouts';
    const tabs = el('div', { class: 'health-tabs' },
        el('div', { class: `health-tab${tab === 'workouts' ? ' active' : ''}`, onclick: () => Store.dispatch('SET_HEALTH_TAB', { tab: 'workouts' }) }, '💪 Тренировки'),
        el('div', { class: `health-tab${tab === 'nutrition' ? ' active' : ''}`, onclick: () => Store.dispatch('SET_HEALTH_TAB', { tab: 'nutrition' }) }, '🥗 Питание'),
    );
    return el('div', { class: 'page' },
        tabs,
        tab === 'workouts' ? WorkoutsTab(state, h) : NutritionTab(state, h),
    );
}

// ─── FOCUS TIMER ─────────────────────────────────────────────────────────────

const FOCUS_KEY = 'focus_timer_v1';

function _focusLoad() {
    try { const r = localStorage.getItem(FOCUS_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function _focusSave(s) { localStorage.setItem(FOCUS_KEY, JSON.stringify(s)); }
function _focusClear()  { localStorage.removeItem(FOCUS_KEY); }

function _focusElapsed(s) {
    if (!s) return 0;
    const acc = s.accumulatedSeconds || 0;
    return s.startTimestamp ? acc + (Date.now() - s.startTimestamp) / 1000 : acc;
}

function _focusFmt(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sc = s % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
}

// Module-level refs — survive re-renders of the view
let _focusIv = null;
let _focusDisplayRef = null;
let _focusBarRef = null;

function _focusStopIv() { if (_focusIv) { clearInterval(_focusIv); _focusIv = null; } }

function _focusStartIv() {
    _focusStopIv();
    _focusIv = setInterval(() => {
        const s = _focusLoad();
        if (!s || !s.startTimestamp) { _focusStopIv(); return; }
        const elapsed  = _focusElapsed(s);
        const planned  = (s.plannedMinutes || 90) * 60;
        const remaining = Math.max(0, planned - elapsed);

        if (_focusDisplayRef && document.contains(_focusDisplayRef)) {
            _focusDisplayRef.textContent = _focusFmt(remaining);
        }
        if (_focusBarRef && document.contains(_focusBarRef)) {
            const C = 2 * Math.PI * 130;
            _focusBarRef.setAttribute('stroke-dashoffset', C * (1 - Math.min(1, elapsed / planned)));
        }

        if (remaining <= 0) {
            _focusFinish(s, true);
        }
    }, 1000);
}

function _focusFinish(s, auto) {
    _focusStopIv();
    const elapsed = _focusElapsed(s);
    const actualMin = Math.max(1, Math.round(elapsed / 60));
    Store.dispatch('ADD_FOCUS_SESSION', {
        started_at:      s.sessionStartedAt || new Date().toISOString(),
        ended_at:        new Date().toISOString(),
        planned_minutes: s.plannedMinutes || 90,
        actual_minutes:  actualMin,
        tasks_completed: s.tasksCompleted || [],
    });
    _focusClear();
    window.uiToast?.(`Сессия завершена — ${actualMin} мин чистого времени`, 's');
}

export function FocusView(state, h) {
    const ts = _focusLoad();
    const isRunning  = ts?.startTimestamp != null;
    const hasSession = ts != null;
    const elapsed    = _focusElapsed(ts);
    const planned    = (ts?.plannedMinutes || 90) * 60;
    const remaining  = Math.max(0, planned - elapsed);
    const pct        = hasSession ? Math.min(100, (elapsed / planned) * 100) : 0;

    // SVG ring
    const C     = 2 * Math.PI * 130;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNS, 'svg');
    svgEl.setAttribute('width', '280'); svgEl.setAttribute('height', '280');
    const trackCircle = document.createElementNS(svgNS, 'circle');
    trackCircle.setAttribute('cx', '140'); trackCircle.setAttribute('cy', '140'); trackCircle.setAttribute('r', '130');
    trackCircle.setAttribute('fill', 'none'); trackCircle.setAttribute('stroke', '#1d1d20'); trackCircle.setAttribute('stroke-width', '1');
    const arcCircle = document.createElementNS(svgNS, 'circle');
    arcCircle.setAttribute('cx', '140'); arcCircle.setAttribute('cy', '140'); arcCircle.setAttribute('r', '130');
    arcCircle.setAttribute('fill', 'none'); arcCircle.setAttribute('stroke', '#ededef'); arcCircle.setAttribute('stroke-width', '1');
    arcCircle.setAttribute('stroke-dasharray', C); arcCircle.setAttribute('stroke-dashoffset', C * (1 - pct / 100));
    arcCircle.setAttribute('stroke-linecap', 'round');
    svgEl.appendChild(trackCircle); svgEl.appendChild(arcCircle);

    // Live-update elements
    const bigTime = el('div', { class: 'big' }, _focusFmt(remaining));
    _focusDisplayRef = bigTime;
    _focusBarRef     = arcCircle;

    const statusLbl = el('div', {
        id: 'focus-status',
        class: 'st',
    }, isRunning ? 'ФОКУС' : (hasSession ? 'ПАУЗА' : 'ГОТОВ'));

    // Duration input (hidden, source of truth for preset buttons)
    const durationInp = el('input', {
        id: 'focus-dur-inp', type: 'hidden', value: '90',
    });
    const durationWrap = el('div', {
        id: 'focus-dur-wrap',
        class: 'timer-dur',
        style: { display: hasSession ? 'none' : '' },
    },
        durationInp,
        ...['25', '45', '90', '120', '180'].map(v =>
            el('button', { type: 'button',
                onclick: () => { durationInp.value = v; }
            }, v + 'м')
        ),
    );

    // ── Start button ──
    const startBtn = el('button', {
        id: 'focus-start', type: 'button',
        class: `timer-start${isRunning ? ' running' : ''}`,
    }, isRunning ? 'ИДЁТ' : (hasSession ? 'ПРОДОЛЖИТЬ' : 'СТАРТ'));
    if (isRunning) startBtn.disabled = true;
    startBtn.addEventListener('click', () => {
        let cur = _focusLoad();
        if (cur?.startTimestamp) return;
        if (!cur) {
            const inp = document.getElementById('focus-dur-inp');
            const mins = Math.max(1, parseInt(inp?.value) || 90);
            cur = { plannedMinutes: mins, accumulatedSeconds: 0, startTimestamp: null, sessionStartedAt: null, tasksCompleted: [] };
        }
        cur.startTimestamp = Date.now();
        if (!cur.sessionStartedAt) cur.sessionStartedAt = new Date().toISOString();
        _focusSave(cur);
        _focusStartIv();

        startBtn.textContent = 'ИДЁТ';
        startBtn.disabled = true;
        startBtn.className = 'timer-start running';
        pauseBtn.style.display = '';
        stopBtn.style.display  = '';
        const dw = document.getElementById('focus-dur-wrap');
        if (dw) dw.style.display = 'none';
        const sl = document.getElementById('focus-status');
        if (sl) { sl.textContent = 'ФОКУС'; sl.className = 'st'; }
    });

    // ── Pause button ──
    const pauseBtn = el('button', {
        id: 'focus-pause', type: 'button',
        class: 'btn btn-ghost',
        style: { display: isRunning ? '' : 'none' },
    }, '⏸ Пауза');
    pauseBtn.addEventListener('click', () => {
        const cur = _focusLoad();
        if (!cur?.startTimestamp) return;
        cur.accumulatedSeconds = _focusElapsed(cur);
        cur.startTimestamp = null;
        _focusSave(cur);
        _focusStopIv();

        startBtn.textContent = 'ПРОДОЛЖИТЬ';
        startBtn.disabled = false;
        startBtn.className = 'timer-start';
        pauseBtn.style.display = 'none';
        const sl = document.getElementById('focus-status');
        if (sl) { sl.textContent = 'ПАУЗА'; sl.className = 'st'; }
    });

    // ── Stop button ──
    const stopBtn = el('button', {
        id: 'focus-stop', type: 'button',
        class: 'btn btn-ghost',
        style: { display: hasSession ? '' : 'none' },
    }, '■ Завершить');
    stopBtn.addEventListener('click', () => {
        const cur = _focusLoad();
        if (!cur) return;
        if (confirm('Завершить сессию фокуса?')) _focusFinish(cur, false);
    });

    // Start interval on mount if running
    if (isRunning) requestAnimationFrame(_focusStartIv);

    // ── Task list ──
    const activeTasks = state.tasks.filter(t => !t.done);
    const taskRows = activeTasks.map(t => {
        const chk = el('div', { class: `task-check${t.done ? ' checked' : ''}` });
        chk.onclick = () => {
            Store.dispatch('TOGGLE_TASK', { id: t.id });
            // Track task in session
            const cur = _focusLoad();
            if (cur) {
                const set = new Set(cur.tasksCompleted || []);
                if (!t.done) set.add(t.id); else set.delete(t.id);
                cur.tasksCompleted = [...set];
                _focusSave(cur);
            }
        };
        return el('div', { class: 'task-item', 'data-priority': t.priority || 'med' },
            chk,
            el('div', { class: `task-title${t.done ? ' done' : ''}` }, t.title),
        );
    });

    const tasksCard = el('section', { class: 'section', style: { margin: '0' } },
        el('div', { class: 'section-h' },
            el('h3', {}, 'Задачи сессии'),
            el('span', { class: 'count' }, `${state.tasks.filter(t=>t.done).length}/${state.tasks.length}`),
        ),
        taskRows.length
            ? el('div', {}, ...taskRows)
            : emptyState('✓', 'Нет активных задач', null, null),
    );

    // ── Session history ──
    const sessions = state.focusSessions || [];
    const historySection = sessions.length ? el('div', { class: 'focus-history' },
        el('div', { class: 'section-h', style: { width: '280px' } },
            el('h3', {}, 'Недавние сессии'),
        ),
        ...sessions.slice(0, 5).map(s =>
            el('div', { class: 'focus-history-row' },
                el('div', { class: 'fhd' }, new Date(s.started_at).toLocaleDateString('ru-RU', { day:'numeric', month:'short' })),
                el('div', { class: 'fht' }, `${s.actual_minutes} / ${s.planned_minutes} мин`),
                el('div', { class: 'fhk' }, Math.round((s.actual_minutes / s.planned_minutes) * 100) + '%'),
            )
        ),
    ) : null;

    return el('div', { class: 'page' },
        el('div', { class: 'focus-layout' },
            el('div', { class: 'timer-card' },
                el('div', { class: 'timer-ring' },
                    svgEl,
                    el('div', { class: 'timer-time' },
                        bigTime,
                        statusLbl,
                    ),
                ),
                durationWrap,
                el('div', { style: { display: 'flex', gap: '8px' } }, startBtn, pauseBtn, stopBtn),
                historySection,
            ),
            tasksCard,
        ),
    );
}

// ─── Project Map View ─────────────────────────────────────────────────────────
export function ProjectMapView(state, h) {
    return el('div', { class: 'page', style: { width: '100%', height: 'calc(100vh - 48px)', padding: 0, overflow: 'hidden' } },
        el('iframe', {
            src: '/project-map.html',
            style: {
                width: '100%',
                height: '100%',
                border: 'none',
                background: 'var(--bg)',
                display: 'block',
            },
            onload: () => {
                // Совместимость с тёмной темой
                const iframe = document.querySelector('iframe[src="/project-map.html"]');
                if (iframe?.contentDocument?.body) {
                    iframe.contentDocument.body.style.background = 'var(--bg)';
                }
            },
        }),
    );
}

// Export for UIEngine
export { TaskRow, AgentCard };