import { formatDate } from '../../utils/util.js';
import { formatNoteTime } from '../../services/noteService.js';

function formatShortTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getDayStart(ts) {
  const d = new Date(Number(ts));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDayLabel(dayStartTs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const diffDays = Math.round((todayStart - Number(dayStartTs)) / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return formatDate(dayStartTs);
}

export function buildTimelineGroups(list, noteTimeMode) {
  if (!Array.isArray(list) || list.length === 0) return [];

  const sorted = [...list].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  const groups = [];
  const indexByKey = new Map();

  for (const n of sorted) {
    const ts = Number(n?.timestamp || 0);
    if (!ts) continue;
    const dayStart = getDayStart(ts);
    const key = String(dayStart);
    let group = indexByKey.get(key);
    if (!group) {
      group = {
        key,
        dayStart,
        title: formatDayLabel(dayStart),
        items: []
      };
      indexByKey.set(key, group);
      groups.push(group);
    }
    group.items.push({
      ...n,
      timeText: formatNoteTime(ts, noteTimeMode),
      shortTime: formatShortTime(ts),
      typeLabel: n.type === 'quote' ? '金句' : '想法',
      slideButtons: [
        {
          text: '删除',
          extClass: 'slide-btn-delete',
          data: { ts }
        }
      ]
    });
  }

  return groups.map((g) => ({ ...g, count: g.items.length }));
}

