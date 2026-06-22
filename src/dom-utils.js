export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') { node.className = v; }
        else if (k === 'style' && typeof v === 'object') { Object.assign(node.style, v); }
        else if (k.startsWith('on') && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); }
        else if (v !== null && v !== undefined) { node.setAttribute(k, v); }
    }
    for (const c of children.flat(Infinity)) {
        if (c == null) continue;
        node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

export function mount(container, ...children) {
    container.replaceChildren(...children.flat(Infinity).filter(Boolean));
}

export function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fmt(n) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

export function fmtNum(n) {
    return new Intl.NumberFormat('ru-RU').format(Number(n) || 0);
}

export function fmtDate(ts) {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(ts));
}

export function fmtDateFull(ts) {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ts));
}

export function tstamp() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function typeIcon(type) {
    return { youtube: '▷', music: '♫', maskots: '🎭', book: '📚', business: '💼', other: '📁' }[type] || '📁';
}
