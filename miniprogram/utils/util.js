export function debounce(fn, wait = 250) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/** 从 notes 数组统计心得 / 金句条数（与云库字段 thoughtCount、quoteCount 一致） */
export function countNoteTypes(notes) {
  const arr = Array.isArray(notes) ? notes : [];
  let thoughtCount = 0;
  let quoteCount = 0;
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i];
    if (!n) continue;
    if (n.type === 'thought') thoughtCount++;
    else if (n.type === 'quote') quoteCount++;
  }
  return { thoughtCount, quoteCount };
}

export function highlightText(text, keyword) {
  if (!text || !keyword) return text;
  const escaped = escapeRegExp(keyword);
  const regex = new RegExp(escaped, 'gi');
  return text.replace(regex, (match) => `<span class="highlight">${match}</span>`);
}
