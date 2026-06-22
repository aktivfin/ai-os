import { Store } from './store.js';
import { mount, el } from './dom-utils.js';
import { API } from './api.js';
import { ActionRouter } from './action-router.js';
import { Charts } from './charts.js';
import {
    DashboardView, TasksView, InboxView, HabitsView, GoalsView,
    FinancesView, ReportsView, ProjectsView, CockpitView,
    AgentsView, ScriptsView, ImagesView, YouTubeView, MusicView,
    CalendarView, StudioView, FocusView,
    ProjectMapView,
} from './views.js';

const VIEW_TITLES = {
    dashboard: 'Dashboard', projects: 'Проекты', habits: 'Привычки',
    finances: 'Финансы', studio: 'Студия', focus: 'Фокус',
    projectmap: 'Карта',
    cockpit: '',
    // legacy aliases
    calendar: 'Dashboard', inbox: 'Dashboard', goals: 'Проекты', tasks: 'Проекты',
    reports: 'Финансы', youtube: 'Финансы',
    scripts: 'Студия', images: 'Студия', music: 'Студия', agents: 'Студия',
};

// Redirect old view names to consolidated sections
const VIEW_ALIASES = {
    inbox: 'dashboard', calendar: 'dashboard',
    goals: 'projects', tasks: 'projects',
    reports: 'finances', youtube: 'finances',
    scripts: 'studio', images: 'studio', music: 'studio', agents: 'studio',
    chat: 'dashboard', health: 'dashboard',  // removed sections → dashboard
};

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ─── Toast ─────────────────────────────────────────────────────────────────
function toast(msg, type = 'i') {
    const c = document.getElementById('toasts');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    const dot = document.createElement('div'); dot.className = 'toast-dot';
    const txt = document.createTextNode(String(msg));
    const x = document.createElement('span'); x.className = 'toast-x'; x.textContent = '✕'; x.onclick = () => t.remove();
    t.append(dot, txt, x);
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3500);
}

// ─── Handlers passed to views ──────────────────────────────────────────────
const handlers = {
    openModal: (type, opts) => UIEngine.showModal(type, opts),
    render:    ()           => UIEngine.render(),
    sendChat:  ()           => UIEngine.sendChat(),
    exportChat:()           => UIEngine.exportChat(),
    runAgent:  (id)         => UIEngine.runAgent(id),
    stopAgent: (id)         => UIEngine.stopAgent(id),
    runAllAgents:  ()       => UIEngine.runAllAgents(),
    stopAllAgents: ()       => UIEngine.stopAllAgents(),
    generateImages:(prompt) => UIEngine.generateImages(prompt),
    loadYT:    ()           => UIEngine.loadYT(),
    analyzeMusic: (text)    => UIEngine.analyzeMusic(text),
};

// ─── UIEngine ──────────────────────────────────────────────────────────────
export const UIEngine = {
    _modal: null,
    _typing: null,
    _prevView: null,

    init() {
        console.log('[UIEngine.init] called. Store.state.view=', Store.state.view, '#active-view=', document.getElementById('active-view'));
        this._modal = document.getElementById('modal-root');
        window.uiToast = toast; // expose for views.js focus timer and store.js error reporting
        window.addEventListener('stateChange', debounce(() => this.render(), 16));
        this._initDragDrop();
        const overlay = document.getElementById('sheet-overlay');
        if (overlay) overlay.addEventListener('click', () => this.closeSheet());
        this.render();
        this._connectProxy();
        this._scheduleNotifyChecks(); // БАГ #4: FAB убран, уведомления через toast/Notification
    },

    render() {
        const state = Store.state;
        const effectiveView = VIEW_ALIASES[state.view] || state.view;
        const viewChanged = state.view !== this._prevView;
        this._prevView = state.view;

        this._updateTopbar(state, effectiveView);
        this._updateSidebar(state, effectiveView);
        const viewport = document.getElementById('active-view');
        if (!viewport) return;
        Charts.destroyAll();

        // БАГ #7: Сохраняем состояние активного input/textarea перед ре-рендером
        const focused = document.activeElement;
        let savedInput = null;
        if (focused && viewport.contains(focused) &&
            (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA') && focused.id) {
            savedInput = {
                id: focused.id,
                value: focused.value,
                selStart: focused.selectionStart ?? focused.value.length,
                selEnd: focused.selectionEnd ?? focused.value.length,
            };
        }

        let view;
        console.log('[render] effectiveView=', effectiveView, 'state.view=', state.view, '#active-view=', viewport);
        try {
            switch (effectiveView) {
                case 'dashboard': view = DashboardView(state, handlers); break;
                case 'projects':  view = ProjectsView(state, handlers);  break;
                case 'habits':    view = HabitsView(state, handlers);    break;
                case 'finances':  view = FinancesView(state, handlers);  break;
                case 'studio':    view = StudioView(state, handlers);    break;
                case 'focus':     view = FocusView(state, handlers);     break;
                case 'projectmap': view = ProjectMapView(state, handlers); break;
                default:          view = DashboardView(state, handlers);
            }
        } catch (err) {
            console.error('[render] view function THREW:', err);
            view = el('div', { style: { padding: '40px', color: '#b08080', fontFamily: 'monospace' } },
                el('div', {}, 'RENDER ERROR: ' + (err?.message || err)),
                el('pre', { style: { fontSize: '11px', whiteSpace: 'pre-wrap' } }, String(err?.stack || '')),
            );
        }
        console.log('[render] view node=', view, 'isNode=', view instanceof Node);
        mount(viewport, view);
        console.log('[render] after mount, viewport.children=', viewport.children.length, 'innerHTML.length=', viewport.innerHTML.length);

        // БАГ #7: Восстанавливаем фокус и значение после ре-рендера
        if (savedInput) {
            const restored = document.getElementById(savedInput.id);
            if (restored) {
                restored.value = savedInput.value;
                restored.focus();
                try { restored.setSelectionRange(savedInput.selStart, savedInput.selEnd); } catch {}
            }
        }

        // Blur-fade при смене раздела
        if (viewChanged) {
            viewport.style.filter = 'blur(4px)';
            requestAnimationFrame(() => { viewport.style.filter = ''; });
        }

        if (effectiveView === 'finances') {
            requestAnimationFrame(() => {
                if (!state.finInsight && state.finances.length) this._loadFinInsight();
            });
        }
    },

    _updateTopbar(state, effectiveView) {
        const title = document.getElementById('view-title');
        if (title) {
            let txt;
            if (effectiveView === 'cockpit') {
                const p = state.projects.find(x => x.id === state.activeProjectId);
                txt = p ? p.name : 'Проект';
            } else {
                txt = VIEW_TITLES[effectiveView] || effectiveView;
            }
            title.textContent = txt.toUpperCase();
        }

        const dot = document.getElementById('sb-dot');
        if (dot) {
            dot.style.background = state.wsConnected ? 'var(--ink)' : 'var(--ink-3)';
            dot.title = state.wsConnected ? 'AI подключён' : 'AI недоступен';
        }
    },

    _updateSidebar(state, effectiveView) {
        // Active state — highlight side-btn matching current effective view
        const sidebarView = effectiveView === 'cockpit' ? 'projects' : effectiveView;
        document.querySelectorAll('.side-btn[data-page]').forEach(item => {
            item.classList.toggle('active', item.dataset.page === sidebarView);
        });

        // Fill task project select in modal if open
        const sel = document.getElementById('task-project');
        if (sel) {
            sel.replaceChildren();
            const defaultOpt = document.createElement('option');
            defaultOpt.value = ''; defaultOpt.textContent = '— Личное —';
            sel.appendChild(defaultOpt);
            state.projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
        }
    },

    openSheet(sheetId) {
        const overlay = document.getElementById('sheet-overlay');
        const sheet = document.getElementById(sheetId);
        if (!overlay || !sheet) return;
        overlay.classList.add('open');
        sheet.classList.add('open');
        document.body.style.overflow = 'hidden';
    },

    closeSheet(sheetId) {
        const overlay = document.getElementById('sheet-overlay');
        if (overlay) overlay.classList.remove('open');
        if (sheetId) {
            const sheet = document.getElementById(sheetId);
            if (sheet) sheet.classList.remove('open');
        } else {
            document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open'));
        }
        document.body.style.overflow = '';
    },

    // ─── MODALS ──────────────────────────────────────────────────────────
    showModal(type, opts = {}) {
        if (!this._modal) return;
        const state = Store.state;

        const close = () => {
            this._modal.style.display = 'none';
            mount(this._modal);
        };

        let content;

        if (type === 'task') {
            const titleInp   = el('input', { class: 'finp', placeholder: 'Что нужно сделать?', id: 'task-title' });
            const prioSel    = el('select', { class: 'finp', id: 'task-priority' },
                el('option', { value: 'high' }, '🔴 Высокий'), el('option', { value: 'med', selected: '' }, '🟡 Средний'), el('option', { value: 'low' }, '🟢 Низкий'),
            );
            const dueDateInp = el('input', { class: 'finp', type: 'date', id: 'task-due-date' });
            if (opts.due_date) dueDateInp.value = opts.due_date;
            const projSel    = el('select', { class: 'finp', id: 'task-project' }, el('option', { value: '' }, '— Личное —'));
            state.projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; if (opts.project_id === p.id) o.selected = true; projSel.appendChild(o); });
            if (opts.project_id) projSel.value = opts.project_id;

            const save = () => {
                const title = titleInp.value.trim();
                if (!title) return;
                Store.dispatch('ADD_TASK', { title, priority: prioSel.value, project_id: projSel.value || null, due_date: dueDateInp.value || null });
                toast('Задача создана', 's'); close();
            };
            titleInp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
            content = ModalShell('Новая задача', close,
                Field('Название', titleInp), Field('Приоритет', prioSel),
                Field('Дедлайн', dueDateInp), Field('Проект', projSel),
                ModalFooter(close, save, 'Создать'),
            );
            requestAnimationFrame(() => titleInp.focus());
        }

        else if (type === 'income' || type === 'expense') {
            // БАГ #6: переключатель дохода/расхода внутри модала
            // БАГ #1: категория по умолчанию — "Прочее", YouTube не первый
            let txType = type;

            const amtInp  = el('input', { class: 'finp', type: 'number', placeholder: '0', min: '0', id: 'fin-amount' });
            const descInp = el('input', { class: 'finp', placeholder: 'Описание', id: 'fin-desc' });
            const CATEGORIES = ['Прочее', 'Еда', 'Транспорт', 'Подписки', 'Зарплата', 'Фриланс', 'Музыка', 'YouTube'];
            const catSel  = el('select', { class: 'finp', id: 'fin-cat' },
                ...CATEGORIES.map(c => el('option', { value: c }, c))
            );

            // Кнопки переключения
            const incBtn = el('button', { class: 'btn btn-success', type: 'button', style: { flex: '1' } }, '↑ Доход');
            const expBtn = el('button', { class: 'btn btn-ghost', type: 'button', style: { flex: '1' } }, '↓ Расход');
            if (txType === 'expense') { incBtn.className = 'btn btn-ghost'; expBtn.className = 'btn btn-danger'; }

            const setType = t => {
                txType = t;
                incBtn.className = 'btn ' + (t === 'income' ? 'btn-success' : 'btn-ghost');
                expBtn.className = 'btn ' + (t === 'expense' ? 'btn-danger' : 'btn-ghost');
            };
            touchBind(incBtn, () => setType('income'));
            touchBind(expBtn, () => setType('expense'));

            const typeToggle = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, incBtn, expBtn);

            const save = () => {
                const amount = parseFloat(amtInp.value);
                if (!amount || isNaN(amount) || amount <= 0) { toast('Введите сумму', 'e'); return; }
                const cat = catSel.value;
                const prevCatTotal = txType === 'expense'
                    ? Store.state.finances.filter(f => f.tx_type === 'expense' && f.category === cat).reduce((s, f) => s + Number(f.amount), 0)
                    : 0;
                Store.dispatch('ADD_FINANCE', { tx_type: txType, amount, description: descInp.value || (txType === 'income' ? 'Доход' : 'Расход'), category: cat });
                const fmtAmt = v => Math.round(v).toLocaleString('ru-RU') + ' ₽';
                const msg = txType === 'income'
                    ? `Доход +${fmtAmt(amount)} записан`
                    : `${cat}: ${fmtAmt(amount)} · итого ${fmtAmt(prevCatTotal + amount)}`;
                toast(msg, 's');
                close();
            };
            content = ModalShell('+ Финансы', close,
                typeToggle,
                Field('Сумма (₽)', amtInp), Field('Описание', descInp), Field('Категория', catSel),
                ModalFooter(close, save, 'Добавить'),
            );
            requestAnimationFrame(() => amtInp.focus());
        }

        else if (type === 'habit') {
            // БАГ #2: расширенный emoji-пикер вместо текстового поля
            const nameInp = el('input', { class: 'finp', placeholder: 'Например: Пробежка' });
            let selectedIcon = '🏃';
            const HABIT_EMOJIS = ['🏃','💧','📚','🧘','💊','🥗','😴','🏋️','✍️','🎯','🚴','🧹','💰','🎸','🧠','🎨','📱','☕','🌅','📝','🏊','⚽','🎧','🧪','🥤'];
            const iconDisplay = el('div', { class: 'finp', style: { width: '60px', textAlign: 'center', fontSize: '20px', lineHeight: '1.6', cursor: 'default' } }, selectedIcon);
            const emojiGrid = el('div', { class: 'emoji-grid' },
                ...HABIT_EMOJIS.map(em => {
                    const ebtn = el('button', { class: 'emoji-btn' + (em === selectedIcon ? ' active' : ''), type: 'button' }, em);
                    touchBind(ebtn, () => {
                        selectedIcon = em;
                        iconDisplay.textContent = em;
                        emojiGrid.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('active'));
                        ebtn.classList.add('active');
                    });
                    return ebtn;
                })
            );
            const freqSel = el('select', { class: 'finp' },
                el('option', { value: 'every_day' }, 'Каждый день'),
                el('option', { value: 'every_other' }, 'Через день'),
                el('option', { value: 'custom' }, 'По дням недели'),
            );
            const dayKeys = ['mon','tue','wed','thu','fri','sat','sun'];
            const dayLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
            const dayChecks = dayKeys.map((k, i) => {
                const cb = el('input', { type: 'checkbox', value: k, id: `hd-${k}` });
                return el('label', { class: 'habit-day-label', for: `hd-${k}` }, cb, dayLabels[i]);
            });
            const daysWrap = el('div', { class: 'habit-days-wrap', style: { display: 'none' } }, ...dayChecks);
            freqSel.addEventListener('change', () => {
                daysWrap.style.display = freqSel.value === 'custom' ? 'flex' : 'none';
            });
            const save = () => {
                const name = nameInp.value.trim();
                if (!name) return;
                const frequency = freqSel.value;
                const custom_days = frequency === 'custom'
                    ? dayKeys.filter((k, i) => dayChecks[i].querySelector('input').checked)
                    : [];
                Store.dispatch('ADD_HABIT', { name, icon: selectedIcon, frequency, custom_days });
                toast('Привычка добавлена', 's'); close();
            };
            content = ModalShell('Новая привычка', close,
                Field('Название', nameInp),
                Field('Иконка', el('div', {}, el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, iconDisplay), emojiGrid)),
                Field('Частота', freqSel),
                Field('', daysWrap),
                ModalFooter(close, save, 'Добавить'),
            );
            requestAnimationFrame(() => nameInp.focus());
        }

        else if (type === 'edit-habit') {
            const hb = opts.habit;
            if (!hb) return;
            const nameInp = el('input', { class: 'finp', placeholder: 'Например: Пробежка' });
            nameInp.value = hb.name || '';
            let selectedIcon = hb.icon || '🏃';
            const HABIT_EMOJIS = ['🏃','💧','📚','🧘','💊','🥗','😴','🏋️','✍️','🎯','🚴','🧹','💰','🎸','🧠','🎨','📱','☕','🌅','📝','🏊','⚽','🎧','🧪','🥤'];
            const iconDisplay = el('div', { class: 'finp', style: { width: '60px', textAlign: 'center', fontSize: '20px', lineHeight: '1.6', cursor: 'default' } }, selectedIcon);
            const emojiGrid = el('div', { class: 'emoji-grid' },
                ...HABIT_EMOJIS.map(em => {
                    const ebtn = el('button', { class: 'emoji-btn' + (em === selectedIcon ? ' active' : ''), type: 'button' }, em);
                    touchBind(ebtn, () => {
                        selectedIcon = em;
                        iconDisplay.textContent = em;
                        emojiGrid.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('active'));
                        ebtn.classList.add('active');
                    });
                    return ebtn;
                })
            );
            const freqSel = el('select', { class: 'finp' },
                el('option', { value: 'every_day' }, 'Каждый день'),
                el('option', { value: 'every_other' }, 'Через день'),
                el('option', { value: 'custom' }, 'По дням недели'),
            );
            freqSel.value = hb.frequency || 'every_day';
            const dayKeys = ['mon','tue','wed','thu','fri','sat','sun'];
            const dayLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
            const dayChecks = dayKeys.map((k, i) => {
                const cb = el('input', { type: 'checkbox', value: k, id: `hde-${k}` });
                if ((hb.custom_days || []).includes(k)) cb.checked = true;
                return el('label', { class: 'habit-day-label', for: `hde-${k}` }, cb, dayLabels[i]);
            });
            const daysWrap = el('div', { class: 'habit-days-wrap', style: { display: freqSel.value === 'custom' ? 'flex' : 'none' } }, ...dayChecks);
            freqSel.addEventListener('change', () => {
                daysWrap.style.display = freqSel.value === 'custom' ? 'flex' : 'none';
            });
            const save = () => {
                const name = nameInp.value.trim();
                if (!name) return;
                const frequency = freqSel.value;
                const custom_days = frequency === 'custom'
                    ? dayKeys.filter((k, i) => dayChecks[i].querySelector('input').checked)
                    : [];
                Store.dispatch('UPDATE_HABIT', { id: hb.id, name, icon: selectedIcon, frequency, custom_days });
                toast('Привычка обновлена', 's'); close();
            };
            content = ModalShell('Редактировать привычку', close,
                Field('Название', nameInp),
                Field('Иконка', el('div', {}, el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, iconDisplay), emojiGrid)),
                Field('Частота', freqSel),
                Field('', daysWrap),
                ModalFooter(close, save, 'Сохранить'),
            );
            requestAnimationFrame(() => nameInp.focus());
        }

        else if (type === 'goal') {
            const titleInp = el('input', { class: 'finp', placeholder: 'Чего хочешь достичь?' });
            const dlInp    = el('input', { class: 'finp', type: 'date' });
            const save = () => {
                if (!titleInp.value.trim()) return;
                Store.dispatch('ADD_GOAL', { title: titleInp.value.trim(), deadline: dlInp.value || null });
                toast('Цель добавлена', 's'); close();
            };
            content = ModalShell('Новая цель', close, Field('Цель', titleInp), Field('Дедлайн (необязательно)', dlInp), ModalFooter(close, save, 'Создать'));
            requestAnimationFrame(() => titleInp.focus());
        }

        else if (type === 'inbox') {
            const textInp = el('textarea', { class: 'finp', placeholder: 'Напиши идею или мысль...', rows: '3' });
            const typeSel = el('select', { class: 'finp' }, el('option', { value: 'idea' }, '💡 Идея'), el('option', { value: 'goal' }, '🎯 Цель'), el('option', { value: 'note' }, '📝 Заметка'));
            const save = () => {
                if (!textInp.value.trim()) return;
                Store.dispatch('ADD_INBOX', { title: textInp.value.trim(), type: typeSel.value });
                toast('Идея сохранена', 's'); close();
            };
            content = ModalShell('Новая идея', close, Field('Текст', textInp), Field('Тип', typeSel), ModalFooter(close, save, 'Сохранить'));
            requestAnimationFrame(() => textInp.focus());
        }

        else if (type === 'project') {
            const nameInp = el('input', { class: 'finp', placeholder: 'Название проекта' });
            const typeSel = el('select', { class: 'finp' },
                el('option', { value: 'youtube' }, '▷ YouTube'), el('option', { value: 'music' }, '♫ Музыка'),
                el('option', { value: 'maskots' }, '🎭 Маскоты'), el('option', { value: 'book' }, '📚 Книга'),
                el('option', { value: 'business' }, '💼 Бизнес'), el('option', { value: 'other' }, '📁 Другое'),
            );
            const iconInp = el('input', { class: 'finp', placeholder: '🎬', maxlength: '2', style: { width: '80px' } });
            const save = () => {
                if (!nameInp.value.trim()) return;
                const typeMap = { youtube:'▷', music:'♫', maskots:'🎭', book:'📚', business:'💼', other:'📁' };
                Store.dispatch('ADD_PROJECT', { name: nameInp.value.trim(), type: typeSel.value, icon: iconInp.value || typeMap[typeSel.value] });
                toast('Проект создан', 's'); close();
            };
            content = ModalShell('Новый проект', close, Field('Название', nameInp), Field('Тип', typeSel), Field('Иконка', iconInp), ModalFooter(close, save, 'Создать'));
            requestAnimationFrame(() => nameInp.focus());
        }

        else if (type === 'nutrition-goal') {
            const calInp  = el('input', { class: 'finp', type: 'number', placeholder: '2000' });
            const protInp = el('input', { class: 'finp', type: 'number', placeholder: '100' });
            const fatInp  = el('input', { class: 'finp', type: 'number', placeholder: '60' });
            const carbInp = el('input', { class: 'finp', type: 'number', placeholder: '250' });
            const wkGoalInp = el('input', { class: 'finp', type: 'number', placeholder: '3', min: '1', max: '7' });
            if (opts) {
                calInp.value  = opts.calories || 2000;
                protInp.value = opts.protein  || 100;
                fatInp.value  = opts.fat       || 60;
                carbInp.value = opts.carbs     || 250;
            }
            wkGoalInp.value = state.workoutWeekGoal || 3;
            const save = () => {
                Store.dispatch('SET_NUTRITION_GOAL', { calories: Number(calInp.value) || 2000, protein: Number(protInp.value) || 100, fat: Number(fatInp.value) || 60, carbs: Number(carbInp.value) || 250 });
                Store.dispatch('SET_WORKOUT_WEEK_GOAL', { goal: Number(wkGoalInp.value) || 3 });
                toast('Нормы сохранены', 's'); close();
            };
            content = ModalShell('Нормы и цели', close,
                Field('Калории (ккал/день)', calInp),
                Field('Белки (г/день)', protInp),
                Field('Жиры (г/день)', fatInp),
                Field('Углеводы (г/день)', carbInp),
                Field('Цель тренировок в неделю', wkGoalInp),
                ModalFooter(close, save, 'Сохранить'),
            );
        }

        else if (type === 'script') {
            const titleInp = el('input', { class: 'finp', placeholder: 'Название сценария' });
            const bodyInp  = el('textarea', { class: 'finp', placeholder: 'Текст сценария...', rows: '5' });
            const projSel  = el('select', { class: 'finp' }, el('option', { value: '' }, '— Без проекта —'));
            state.projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; if (opts.project_id === p.id) o.selected = true; projSel.appendChild(o); });
            const save = () => {
                if (!titleInp.value.trim()) return;
                Store.dispatch('ADD_SCRIPT', { title: titleInp.value.trim(), body: bodyInp.value, project_id: projSel.value || null });
                toast('Сценарий создан', 's'); close();
            };
            content = ModalShell('Новый сценарий', close, Field('Название', titleInp), Field('Проект', projSel), Field('Текст', bodyInp), ModalFooter(close, save, 'Создать'));
            requestAnimationFrame(() => titleInp.focus());
        }

        else if (type === 'param') {
            const valInp = el('input', { class: 'finp', type: 'number', placeholder: '0' });
            valInp.value = opts.current || 0;
            const save = () => {
                const v = parseFloat(valInp.value);
                if (isNaN(v)) return;
                Store.dispatch('UPDATE_PROJECT_PARAM', { id: opts.projId, key: opts.key, value: v });
                toast('Параметр обновлён', 's'); close();
            };
            content = ModalShell(`Обновить: ${opts.label}`, close, Field('Значение', valInp), ModalFooter(close, save, 'Сохранить'));
            requestAnimationFrame(() => valInp.focus());
        }

        else if (type === 'video-pipeline') {
            if (!opts?.script) { toast('Сценарий не найден', 'e'); return; }
            const sc = opts.script;
            const countInp = el('input', { class: 'finp', type: 'number', value: '5', style: { width: '80px' } });
            const generating = el('div', { style: { display: 'none', textAlign: 'center', padding: '16px', color: 'var(--t2)' } }, 'Генерирую промты...');
            const genBtn = el('button', { class: 'btn btn-p', type: 'button' }, '⚡ Генерировать');
            const genHandler = async () => {
                genBtn.disabled = true; generating.style.display = 'block';
                const count = parseInt(countInp.value) || 5;
                const segs = await API.generateVideoPrompts(sc.body || sc.content || '', count);
                generating.style.display = 'none';
                if (segs) {
                    Store.dispatch('SET_SCRIPT_SEGMENTS', { id: sc.id, segments: segs });
                    toast(`Готово: ${segs.length} сегментов`, 's'); close();
                } else { toast('Ошибка генерации', 'e'); genBtn.disabled = false; }
            };
            touchBind(genBtn, genHandler);
            const cancelVideoPipelineBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Отмена');
            touchBind(cancelVideoPipelineBtn, close);
            content = ModalShell('Видео-промты для: ' + sc.title, close,
                el('div', { class: 'fin-insight', style: { marginBottom: '12px', fontSize: '12px' } }, `Сценарий: «${sc.title}» будет разбит на сегменты по 6 секунд.`),
                Field('Количество сегментов', countInp),
                el('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, cancelVideoPipelineBtn, genBtn),
                generating,
            );
        }

        if (!content) return;
        mount(this._modal, content);
        this._modal.style.display = 'flex';
        this._modal.onclick = e => { if (e.target === this._modal) close(); };
    },

    // ─── CHAT ────────────────────────────────────────────────────────────
    async sendChat() {
        const inp = document.getElementById('chat-inp');
        const text = inp?.value.trim();
        if (!text) return;
        inp.value = ''; inp.style.height = 'auto';
        localStorage.removeItem('draft_message'); // БАГ #7: очищаем черновик после отправки

        Store.dispatch('ADD_CHAT_MSG', { role: 'user', content: text });
        const userMsgId = Store.state.chatHistory[Store.state.chatHistory.length - 1]?.id;

        const sendBtn = document.getElementById('chat-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        // Show typing — три пульсирующих точки
        const msgs = document.getElementById('chat-messages');
        const typing = document.createElement('div');
        typing.id = 'typing-indicator'; typing.className = 'msg msg-ai';
        const bubble = document.createElement('div'); bubble.className = 'msg-bubble typing-dots';
        bubble.innerHTML = '<span></span><span></span><span></span>';
        typing.appendChild(bubble);
        if (msgs) { msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight; }

        try {
            const data = await API.callAI(text, Store.state);
            document.getElementById('typing-indicator')?.remove();
            const reply = data.reply || 'Не понял запрос';
            Store.dispatch('ADD_CHAT_MSG', { role: 'assistant', content: reply });
            if (data.action || data.actions?.length) ActionRouter.routeAll(data);
        } catch {
            document.getElementById('typing-indicator')?.remove();
            Store.dispatch('ADD_CHAT_MSG', { role: 'assistant', content: 'Ошибка подключения к AI.' });
        }

        if (sendBtn) sendBtn.disabled = false;
        this.render();
        requestAnimationFrame(() => { const m = document.getElementById('chat-messages'); if (m) m.scrollTop = m.scrollHeight; });

        // Async tag extraction — не блокирует UI
        if (userMsgId) {
            API.extractTags(text).then(tags => {
                if (tags?.length) Store.dispatch('UPDATE_MSG_TAGS', { id: userMsgId, tags });
            });
        }
    },

    exportChat() {
        const lines = Store.state.chatHistory.map(m => `[${m.role === 'user' ? 'Я' : 'AI'}] ${m.content}`).join('\n\n');
        const blob = new Blob([lines], { type: 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chat.txt'; a.click();
        toast('Чат экспортирован', 's');
    },

    // ─── AGENTS ──────────────────────────────────────────────────────────
    async runAgent(id) {
        const state = Store.state;
        const agent = state.agents.find(a => a.id === id);
        if (!agent) return;

        const project = state.projects.find(p => p.id === state.activeProjectId);
        const projectName = project?.name || 'Глобальный контекст';

        // Формируем промт исходя из роли агента
        const AGENT_PROMPTS = {
            'Scribe':   `Ты — контент-агент Scribe. Напиши короткий сценарий (150-200 слов) для YouTube-видео про проект "${projectName}". Тема: интересный факт или лайфхак по теме проекта. Сохрани как сценарий.`,
            'Vision':   `Ты — агент Vision. Создай 3 детальных промта на английском для генерации изображений маскота/арта для проекта "${projectName}". Каждый промт — одна строка, стиль cyberpunk/anime, 4k.`,
            'Analyst':  `Ты — аналитик Analyst. Проанализируй текущее состояние: ${state.tasks.filter(t=>!t.done).length} открытых задач, баланс ${state.user.balance}₽, ${state.habits.filter(h=>h.today_done).length}/${state.habits.length} привычек выполнено. Дай 3 конкретных совета для повышения эффективности.`,
            'Director': `Ты — директор Director. Составь план производства контента для проекта "${projectName}" на эту неделю: 3 задачи с приоритетами. Добавь их как задачи.`,
            'Harmony':  `Ты — музыкальный агент Harmony. Предложи 3 музыкальных концепции (жанр, настроение, BPM) для сопровождения контента проекта "${projectName}". Будь конкретным.`,
        };

        const prompt = AGENT_PROMPTS[agent.name] || `Ты — агент ${agent.name} (${agent.role}). Выполни задачу для проекта "${projectName}": проанализируй контекст и предложи следующий шаг.`;
        const taskLabel = project ? project.name : 'Глобальная задача';

        Store.dispatch('SET_AGENT', { id, status: 'working', task: taskLabel });
        toast(`${agent.name} работает…`, 'i');

        try {
            const data = await API.callAI(prompt, state);
            const reply = data?.reply || 'Задача выполнена';

            Store.dispatch('SET_AGENT', { id, status: 'idle', task: '', lastOutput: reply });

            // Применяем все actions из ответа агента
            if (data?.action || data?.actions?.length) ActionRouter.routeAll(data);

            toast(`${agent.name}: ${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}`, 's');
        } catch {
            Store.dispatch('SET_AGENT', { id, status: 'idle', task: '' });
            toast(`${agent.name}: ошибка связи с AI`, 'e');
        }
    },
    stopAgent(id) { Store.dispatch('SET_AGENT', { id, status: 'idle', task: '' }); toast('Агент остановлен', 'i'); },
    runAllAgents() { Store.state.agents.forEach(a => { if (a.status === 'idle') this.runAgent(a.id); }); },
    stopAllAgents() { Store.state.agents.forEach(a => Store.dispatch('SET_AGENT', { id: a.id, status: 'idle', task: '' })); toast('Все агенты остановлены', 'i'); },

    // ─── IMAGES ──────────────────────────────────────────────────────────
    async generateImages(prompt) {
        if (!prompt?.trim()) { toast('Введите промт', 'e'); return; }
        toast('Генерирую изображение…', 'i');
        const data = await API.generateImages(prompt, Store.state);
        if (data?.url) { Store.dispatch('ADD_IMAGE', { url: data.url, prompt }); toast('Готово!', 's'); }
        else if (data?.error) { toast(data.error, 'e'); }
        else { Store.dispatch('ADD_IMAGE', { url: '', prompt, placeholder: true }); toast('Промт сохранён (прокси не настроен)', 'i'); }
    },

    // ─── YOUTUBE ─────────────────────────────────────────────────────────
    async loadYT() {
        toast('Загружаю данные канала…', 'i');
        const data = await API.loadYouTubeStats(Store.state);
        if (data) { Store.dispatch('SET_YT_STATS', { stats: data }); this.render(); }
        else {
            // Demo данные при отсутствии прокси
            Store.dispatch('SET_YT_STATS', { stats: { views: 45200, subs: 1340, revenue: 12800, chart: [
                { label: 'Пн', views: 5200 }, { label: 'Вт', views: 6800 }, { label: 'Ср', views: 4900 },
                { label: 'Чт', views: 7200 }, { label: 'Пт', views: 8100 }, { label: 'Сб', views: 9200 }, { label: 'Вс', views: 3800 },
            ] } });
            this.render();
        }
    },

    // ─── MUSIC ───────────────────────────────────────────────────────────
    async analyzeMusic(text) {
        if (!text?.trim()) { toast('Введи текст трека', 'e'); return; }
        toast('Анализирую трек…', 'i');
        const data = await API.analyzeMusic(text, Store.state);
        if (data) { Store.dispatch('SET_MUSIC_DATA', { data }); this.render(); }
        else { toast('Ошибка анализа', 'e'); }
    },

    // ─── FIN INSIGHT ─────────────────────────────────────────────────────
    async _loadFinInsight() {
        const insight = await API.getFinanceInsight(Store.state.finances);
        if (insight) Store.dispatch('SET_FIN_INSIGHT', { text: insight });
    },

    // ─── NOTIFICATIONS (БАГ #4 убрали FAB, БАГ #5 iOS toast) ────────────
    _scheduleNotifyChecks() {
        setTimeout(() => this._checkAndNotify(), 8000);
        setInterval(() => this._checkAndNotify(), 30 * 60 * 1000);
    },

    _checkAndNotify() {
        const state = Store.state;
        const today = new Date().toISOString().slice(0, 10);
        const alerts = [];

        const overdue = state.tasks.filter(t => !t.done && t.due_date && t.due_date < today);
        if (overdue.length) alerts.push(`⚠️ ${overdue.length} задач просрочено`);

        const todayTasks = state.tasks.filter(t => !t.done && t.due_date === today);
        if (todayTasks.length) alerts.push(`📌 Сегодня: ${todayTasks.slice(0, 2).map(t => t.title).join(', ')}`);

        const WMAP = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
        const isDue = hb => {
            if (!hb.frequency || hb.frequency === 'every_day') return true;
            const d = new Date(today + 'T00:00:00');
            if (hb.frequency === 'every_other') return Math.floor(d.getTime() / 86400000) % 2 === 0;
            if (hb.frequency === 'custom') { const dow = d.getDay(); return (hb.custom_days || []).some(k => WMAP[k] === dow); }
            return true;
        };
        const undone = state.habits.filter(h => !h.today_done && isDue(h));
        if (undone.length) alerts.push(`🔥 Привычки: ${undone.slice(0, 2).map(h => h.name).join(', ')}`);

        if (!alerts.length) return;

        // БАГ #5: iOS — toast, desktop — Notification API
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS || !window.Notification) {
            alerts.forEach(msg => toast(msg, 'i'));
        } else if (Notification?.permission === 'granted') {
            navigator.serviceWorker?.ready.then(r => r.active?.postMessage({
                type: 'NOTIFY', title: 'AI OS', body: alerts[0], tag: 'ai-os-check',
            }));
        }
    },

    // ─── PROXY STATUS ────────────────────────────────────────────────────
    async _connectProxy() {
        try {
            // БАГ #10: используем /health вместо /api/ai — не тратим Ollama/Claude на ping
            const base = (window.__ENV?.AI_PROXY || 'http://localhost:3001/api/ai').replace(/\/api\/ai$/, '');
            const r = await fetch(`${base}/health`);
            const connected = r.ok;
            // БАГ #7: диспатч только при изменении статуса — не триггерим лишний ре-рендер
            if (Store.state.wsConnected !== connected) Store.dispatch('SET_WS', { connected });
        } catch {
            if (Store.state.wsConnected !== false) Store.dispatch('SET_WS', { connected: false });
        }
        setTimeout(() => this._connectProxy(), 30000);
    },

    // ─── DRAG & DROP ─────────────────────────────────────────────────────
    _initDragDrop() {
        const viewport = document.getElementById('active-view');
        if (!viewport) return;
        viewport.addEventListener('dragover', e => { e.preventDefault(); const ov = document.getElementById('drop-ov'); if (ov) ov.classList.add('show'); });
        viewport.addEventListener('dragleave', () => { const ov = document.getElementById('drop-ov'); if (ov) ov.classList.remove('show'); });
        viewport.addEventListener('drop', e => {
            e.preventDefault();
            const ov = document.getElementById('drop-ov'); if (ov) ov.classList.remove('show');
            const file = e.dataTransfer?.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const content = ev.target.result;
                Store.dispatch('ADD_CHAT_MSG', { role: 'user', content: `📎 Файл: ${file.name}\n${content.slice(0, 500)}${content.length > 500 ? '…' : ''}` });
                if (Store.state.view !== 'chat') Store.dispatch('SET_VIEW', { view: 'chat' });
            };
            reader.readAsText(file);
        });
    },
};

// ─── Modal helpers ─────────────────────────────────────────────────────────
// type="button" — предотвращает submit формы
// touchend + preventDefault() — на iOS touchend срабатывает до click;
//   preventDefault() подавляет синтетический click, исключая двойной вызов.
//   Это гарантирует мгновенный отклик на iPhone без 300ms задержки.

function touchBind(node, handler) {
    node.addEventListener('touchend', e => { e.preventDefault(); handler(); });
    node.addEventListener('click', handler);
    return node;
}

function ModalShell(title, onClose, ...children) {
    const closeBtn = el('button', { class: 'modal-close', type: 'button' }, '✕');
    touchBind(closeBtn, onClose);
    return el('div', { class: 'modal' },
        el('div', { class: 'modal-head' },
            el('div', { class: 'modal-title' }, title),
            closeBtn,
        ),
        ...children,
    );
}
function Field(lbl, input) { return el('div', { class: 'field' }, el('div', { class: 'flbl' }, lbl), input); }
function ModalFooter(onClose, onSave, saveLabel) {
    const cancelBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Отмена');
    const saveBtn   = el('button', { class: 'btn btn-p',    type: 'button' }, saveLabel);
    touchBind(cancelBtn, onClose);
    touchBind(saveBtn,   onSave);
    return el('div', { class: 'modal-footer' }, cancelBtn, saveBtn);
}

window.uiToast = toast;
window.toast = toast;