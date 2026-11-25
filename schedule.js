const dayMilliseconds = 86_400_000;

export function logicalDate(now = new Date()) {
  const previousDay = now.getHours() < 5 ? 1 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - previousDay, 12);
}

export function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function nextRollover(now) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function calendarDate(day) {
  return new Date(`${day}T00:00:00Z`);
}

function nextSelectedDay(day, weekdays, minimumOffset) {
  const date = calendarDate(day);
  const weekday = date.getUTCDay();
  const days = weekdays.map((selected) => (selected - weekday - minimumOffset + 7) % 7);
  date.setUTCDate(date.getUTCDate() + minimumOffset + Math.min(...days));
  return date.toISOString().slice(0, 10);
}

function isDue(task, day, lastCompletion) {
  const { schedule, startsOn } = task;
  if (schedule.kind === 'daily') return true;
  if (day < startsOn) return false;

  const last = lastCompletion && lastCompletion >= startsOn ? lastCompletion : undefined;
  if (schedule.kind === 'interval') {
    return !last || (calendarDate(day) - calendarDate(last)) / dayMilliseconds >= schedule.every;
  }

  const due = last
    ? nextSelectedDay(last, schedule.weekdays, 1)
    : nextSelectedDay(startsOn, schedule.weekdays, 0);
  return day >= due;
}

export function getDayPlan({ tasks, checks }, day) {
  const completed = new Set(checks[day] ?? []);
  const latest = new Map();
  for (const [checkedDay, ids] of Object.entries(checks)) {
    if (checkedDay >= day) continue;
    for (const id of ids) {
      if (!latest.has(id) || latest.get(id) < checkedDay) latest.set(id, checkedDay);
    }
  }

  const pending = [];
  const done = [];
  for (const task of tasks) {
    if (completed.has(task.id)) done.push(task);
    else if (isDue(task, day, latest.get(task.id))) pending.push(task);
  }
  return { pending, done, completed };
}
