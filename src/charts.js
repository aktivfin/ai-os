const reg = new Map();

function destroy(id) { const c = reg.get(id); if (c) { c.destroy(); reg.delete(id); } }

function create(id, cfg) {
    destroy(id);
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const chart = new Chart(canvas, cfg);
    reg.set(id, chart);
    return chart;
}

const A = '#cfa968', A2 = 'rgba(207,169,104,.15)', G = '#6ea47a', R = '#c26b6b', P = '#7c4dff';
const GRID = 'rgba(255,255,255,.04)', DIM = '#717680';

const base = { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } };

export const Charts = {
    destroyAll() { reg.forEach((_, id) => destroy(id)); },

    initMiniLine(id, data, color = A) {
        create(id, { type: 'line', data: { labels: data.map((_, i) => i), datasets: [{ data, borderColor: color, backgroundColor: color + '26', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0 }] }, options: { ...base } });
    },

    initBar(id, labels, data, color = A) {
        create(id, {
            type: 'bar',
            data: { labels, datasets: [{ data, backgroundColor: color + '26', borderColor: color, borderWidth: 1, borderRadius: 6 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID }, ticks: { color: DIM, font: { size: 10 } } }, y: { grid: { color: GRID }, ticks: { color: DIM, font: { size: 10 }, callback: v => new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format(v) } } } },
        });
    },

    initDoughnut(id, labels, data, colors) {
        create(id, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: colors || [R, A, P, G], borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: true, position: 'bottom', labels: { color: DIM, font: { size: 10 }, boxWidth: 8, padding: 10 } } } },
        });
    },

    initBalanceChart(id, finances) {
        const now = new Date();
        const days = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            days.push(d.toISOString().slice(0, 10));
        }
        let running = 0;
        const balances = days.map(day => {
            finances.forEach(f => {
                const fDay = f.tx_date || (f.created_at ? new Date(f.created_at).toISOString().slice(0, 10) : null);
                if (fDay === day) running += f.tx_type === 'income' ? +Number(f.amount) : -Number(f.amount);
            });
            return running;
        });
        const isRising = balances[balances.length - 1] >= balances[0];
        const color = isRising ? G : R;
        const labels = days.map((d, i) => i % 7 === 0 ? d.slice(5) : '');
        create(id, {
            type: 'line',
            data: { labels, datasets: [{ data: balances, borderColor: color, backgroundColor: color + '26', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID }, ticks: { color: DIM, font: { size: 9 } } }, y: { grid: { color: GRID }, ticks: { color: DIM, font: { size: 9 }, callback: v => new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format(v) } } } },
        });
    },

    initYTChart(id, data) {
        create(id, {
            type: 'line',
            data: { labels: data.map(d => d.label), datasets: [{ label: 'Просмотры', data: data.map(d => d.views), borderColor: R, backgroundColor: R + '15', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: R }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID }, ticks: { color: DIM, font: { size: 10 } } }, y: { grid: { color: GRID }, ticks: { color: DIM, font: { size: 10 }, callback: v => new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format(v) } } } },
        });
    },
};
