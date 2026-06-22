import { Store } from './store.js';

const ALLOWED = new Set(['add_task','delete_task','add_finance','add_habit','add_goal','add_script','add_project','add_inbox','open_project','approve_step','image_prompt','set_view','error']);

function str(v) { return typeof v === 'string' && v.trim().length > 0; }
function num(v) { return typeof v === 'number' && isFinite(v); }

export const ActionRouter = {
    // Обрабатывает все actions[] из нового формата прокси, fallback на старый action
    routeAll(response) {
        if (!response || typeof response !== 'object') return;
        const actions = response.actions;
        if (Array.isArray(actions) && actions.length > 0) {
            for (const item of actions) {
                try {
                    this.route({ action: item.action, payload: item.payload || {}, reply: response.reply });
                } catch (e) {
                    console.error('[ActionRouter] action failed, continuing:', item.action, e);
                }
            }
        } else if (response.action) {
            this.route(response);
        }
    },

    route(response) {
        if (!response || typeof response !== 'object') return;
        const { action, payload = {}, reply } = response;
        if (!ALLOWED.has(action)) return;
        switch (action) {
            case 'add_task':
                if (str(payload.title)) Store.dispatch('ADD_TASK', { title: payload.title.trim(), priority: payload.priority || 'med', project_id: payload.project_id || null });
                break;
            case 'delete_task': {
                const t = Store.state.tasks.find(x => x.title.toLowerCase().includes((payload.title || '').toLowerCase()));
                if (t) Store.dispatch('DELETE_TASK', { id: t.id });
                break;
            }
            case 'add_finance':
                if (num(payload.amount)) Store.dispatch('ADD_FINANCE', { tx_type: payload.type || 'expense', amount: Math.abs(payload.amount), description: payload.desc || 'AI запись', category: payload.category || 'Прочее' });
                break;
            case 'add_habit':
                if (str(payload.name)) Store.dispatch('ADD_HABIT', { name: payload.name.trim(), icon: payload.icon || '✓' });
                break;
            case 'add_goal':
                if (str(payload.title)) Store.dispatch('ADD_GOAL', { title: payload.title.trim(), deadline: payload.deadline || null });
                break;
            case 'add_script':
                if (str(payload.title)) Store.dispatch('ADD_SCRIPT', { title: payload.title.trim(), body: payload.content || '', source: 'ai', project_id: Store.state.activeProjectId });
                break;
            case 'add_project':
                if (str(payload.name)) Store.dispatch('ADD_PROJECT', { name: payload.name.trim(), type: payload.type || 'other', icon: payload.icon || '📁' });
                break;
            case 'add_inbox': {
                const inboxText = payload.text || payload.title;
                if (str(inboxText)) Store.dispatch('ADD_INBOX', { title: inboxText.trim(), type: payload.type || 'idea' });
                break;
            }
            case 'open_project': {
                const p = Store.state.projects.find(x => x.id === payload.id || x.name.toLowerCase().includes((payload.name || '').toLowerCase()));
                if (p) Store.dispatch('SET_VIEW', { view: 'cockpit', projectId: p.id });
                break;
            }
            case 'approve_step':
                if (str(payload.stepId)) Store.dispatch('APPROVE_STEP', { stepId: payload.stepId });
                break;
            case 'image_prompt':
                if (payload.prompt) navigator.clipboard?.writeText(payload.prompt).catch(() => {});
                break;
            case 'set_view':
                if (str(payload.view)) Store.dispatch('SET_VIEW', { view: payload.view, projectId: payload.projectId || null });
                break;
            case 'error':
                console.warn('[ActionRouter] AI error:', reply);
                break;
        }
    },
};
