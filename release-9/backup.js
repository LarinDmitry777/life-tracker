const format = 'life-tracker-backup';
const version = 1;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasFields(value, required, optional = []) {
  return isObject(value) && required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isSchedule(schedule) {
  switch (schedule?.kind) {
    case 'daily':
      return hasFields(schedule, ['kind']);
    case 'interval':
      return hasFields(schedule, ['kind', 'every']) && Number.isSafeInteger(schedule.every) && schedule.every > 0;
    case 'weekly': {
      if (!hasFields(schedule, ['kind', 'weekdays'])) return false;
      const days = schedule.weekdays;
      return Array.isArray(days) && days.length > 0 && new Set(days).size === days.length &&
        days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    }
    default:
      return false;
  }
}

function isTask(task) {
  if (!hasFields(task, ['id', 'title', 'schedule'], ['startsOn'])) return false;
  if (!isText(task.id) || !isText(task.title) || !isSchedule(task.schedule)) return false;
  if (Object.hasOwn(task, 'startsOn')) return isDay(task.startsOn);
  return task.schedule.kind === 'daily';
}

function isSnapshot(data) {
  if (!hasFields(data, ['tasks', 'checks']) || !Array.isArray(data.tasks) || !isObject(data.checks)) return false;
  if (!data.tasks.every(isTask) || new Set(data.tasks.map(({ id }) => id)).size !== data.tasks.length) return false;

  // Completion records can outlive their tasks when those tasks are deleted.
  return Object.entries(data.checks).every(([day, ids]) => isDay(day) && Array.isArray(ids) &&
    ids.every(isText) && new Set(ids).size === ids.length);
}

export function encodeBackup(state) {
  // Match the persisted representation, including omission of undefined optional fields.
  const data = JSON.parse(JSON.stringify(state));
  if (!isSnapshot(data)) throw new Error('Не удалось создать копию. Данные Life Tracker повреждены.');
  return `${JSON.stringify({ format, version, data }, null, 2)}\n`;
}

export function decodeBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('Не удалось прочитать JSON. Выберите файл резервной копии Life Tracker.');
  }
  if (backup?.format !== format) throw new Error('Этот файл не похож на резервную копию Life Tracker.');
  if (backup.version !== version) throw new Error('Эта версия резервной копии не поддерживается.');
  if (!hasFields(backup, ['format', 'version', 'data']) || !isSnapshot(backup.data)) {
    throw new Error('В резервной копии есть некорректные данные.');
  }
  return backup.data;
}
