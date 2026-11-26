import { dateKey, getDayPlan, logicalDate, nextRollover } from './schedule.js';
import { decodeBackup, encodeBackup } from './backup.js';
import { enableTaskDrag } from './reorder.js';

const storageKey = 'life-tracker.evening.v2';
const legacyKey = 'life-tracker.evening.v1';
const sampleTasks = [
  { id: 'dishes', title: 'Убрать посуду' },
  { id: 'clothes', title: 'Подготовить одежду на завтра' },
  { id: 'teeth', title: 'Почистить зубы' },
  { id: 'alarm', title: 'Поставить будильник' },
];
const daily = { kind: 'daily' };
const weekdays = [
  [1, 'Пн', 'Понедельник'], [2, 'Вт', 'Вторник'], [3, 'Ср', 'Среда'],
  [4, 'Чт', 'Четверг'], [5, 'Пт', 'Пятница'], [6, 'Сб', 'Суббота'],
  [0, 'Вс', 'Воскресенье'],
];

const today = document.querySelector('#today');
const topbar = document.querySelector('.topbar');
const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
const percentage = document.querySelector('#percentage');
const taskList = document.querySelector('#tasks');
const emptyList = document.querySelector('#empty-list');
const emptyMessage = document.querySelector('#empty-message');
const storageError = document.querySelector('#storage-error');
const editButton = document.querySelector('#edit-list');
const editLabel = document.querySelector('#edit-list-label');
const startButton = document.querySelector('#start-list');
const addButton = document.querySelector('#add-task');
const orderHelp = document.querySelector('#reorder-help');
const orderStatus = document.querySelector('#order-status');
const rowTemplate = document.querySelector('#task-row-template');
const taskEditor = document.querySelector('#task-editor');
const taskForm = document.querySelector('#task-form');
const taskEditorTitle = document.querySelector('#task-editor-title');
const taskTitle = document.querySelector('#task-title');
const scheduleKind = document.querySelector('#schedule-kind');
const intervalOptions = document.querySelector('#interval-options');
const intervalDays = document.querySelector('#interval-days');
const weekdayOptions = document.querySelector('#weekday-options');
const weekdayChoices = document.querySelector('#weekdays');
const taskFields = document.querySelector('#task-fields');
const saveTask = document.querySelector('#save-task');
const deleteTask = document.querySelector('#delete-task');
const deleteMessage = document.querySelector('#delete-message');
const confirmDelete = document.querySelector('#confirm-delete-task');
const cancelTask = document.querySelector('#cancel-task-editor');
const backupFile = document.querySelector('#backup-file');
const backupStatus = document.querySelector('#backup-status');
const restoreDialog = document.querySelector('#restore-dialog');
const restoreFilename = document.querySelector('#restore-filename');
const screens = {
  '#home': document.querySelector('#home-screen'),
  '#evening': document.querySelector('#evening-screen'),
  '#day-review': document.querySelector('#day-review-screen'),
  '#settings': document.querySelector('#settings-screen'),
};
const screenTitles = {
  '#home': 'Life Tracker',
  '#evening': 'Вечерняя рутина · Life Tracker',
  '#day-review': 'Итог дня · Life Tracker',
  '#settings': 'Настройки · Life Tracker',
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const rowAnimations = new Map();
let state = withDailySchedule({ tasks: sampleTasks, checks: {} });
let pendingSave = false;
let displayedDay;
let editingList = false;
let taskDraft;
let taskReturnFocus;
let dayTimer;
let backupRead = 0;
let stagedBackup;
const taskDrag = enableTaskDrag(taskList, { onDrop: dropTask, onCancel: () => renderDay() });

function withDailySchedule(data) {
  return { ...data, tasks: data.tasks.map((task) => ({ ...task, schedule: daily })) };
}

function storedData(key) {
  const saved = JSON.parse(localStorage.getItem(key));
  if (Array.isArray(saved?.tasks) && saved.checks) return saved;
}

function readState() {
  if (pendingSave) return state;
  try {
    const saved = storedData(storageKey);
    if (saved) return saved;

    const legacy = storedData(legacyKey);
    if (legacy) return withDailySchedule(legacy);
    return withDailySchedule({ tasks: sampleTasks, checks: {} });
  } catch {
    return state;
  }
}

function writeState(data) {
  localStorage.setItem(storageKey, JSON.stringify(data));
  pendingSave = false;
  storageError.hidden = true;
}

function persist(data) {
  try {
    writeState(data);
  } catch {
    pendingSave = true;
    storageError.hidden = false;
  }
}

function makeTaskRow(id) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.taskId = id;
  row.querySelector('.task-check').dataset.taskId = id;
  return row;
}

function renderTasks(tasks, completed, animate) {
  const oldRows = new Map([...taskList.children].map((row) => [row.dataset.taskId, row]));
  const positions = new Map();
  if (animate && !reducedMotion.matches) {
    for (const row of oldRows.values()) positions.set(row, row.getBoundingClientRect().top);
  }
  for (const animation of rowAnimations.values()) animation.cancel();
  rowAnimations.clear();

  const focused = document.activeElement;
  const keyboardFocus = focused.matches(':focus-visible');
  const wasTaskFocused = taskList.contains(focused);
  tasks.forEach(({ id, title }, index) => {
    const row = oldRows.get(id) ?? makeTaskRow(id);
    const name = row.querySelector('.task-name');
    const checkbox = row.querySelector('.task-check');
    const order = row.querySelector('.task-order');
    const settings = row.querySelector('.task-settings');
    if (name.textContent !== title) name.textContent = title;
    checkbox.checked = completed.has(id);
    checkbox.disabled = editingList;
    order.hidden = !editingList;
    settings.hidden = !editingList;
    if (editingList) {
      order.querySelector('.drag-handle').setAttribute('aria-label', `Переместить «${title}»`);
      order.querySelector('.move-up').disabled = index === 0;
      order.querySelector('.move-down').disabled = index === tasks.length - 1;
      settings.setAttribute('aria-label', `Настройки дела «${title}»`);
    } else {
      order.open = false;
    }
    if (taskList.children[index] !== row) {
      taskList.insertBefore(row, taskList.children[index] ?? null);
    }
    oldRows.delete(id);
  });
  for (const row of oldRows.values()) row.remove();

  for (const row of taskList.children) {
    if (!positions.has(row)) continue;
    const offset = positions.get(row) - row.getBoundingClientRect().top;
    if (Math.abs(offset) < 1) continue;
    const animation = row.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
      { duration: 290, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    rowAnimations.set(row, animation);
    animation.onfinish = () => rowAnimations.delete(row);
  }

  if (wasTaskFocused && taskList.contains(focused)) {
    let target = focused;
    if (!editingList && !focused.matches('.task-check')) target = editButton;
    else if (focused.disabled) target = focused.closest('.task-item').querySelector('.drag-handle');
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    if (animate && keyboardFocus) {
      const animation = rowAnimations.get(focused.closest('li'));
      if (animation) {
        animation.finished.then(() => {
          if (document.activeElement === focused) focused.scrollIntoView({ block: 'nearest' });
        }, () => {});
      } else {
        focused.scrollIntoView({ block: 'nearest' });
      }
    }
  } else if (wasTaskFocused && !screens['#evening'].hidden) {
    const selector = editingList ? '.task-settings' : '.task-check';
    (taskList.querySelector(selector) ?? editButton).focus({ preventScroll: true });
  }
}

reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  for (const animation of rowAnimations.values()) animation.cancel();
  rowAnimations.clear();
});

function renderDay(now = new Date(), animate = false) {
  const date = logicalDate(now);
  displayedDay = dateKey(date);
  const dateText = dateFormat.format(date);
  today.dateTime = displayedDay;
  today.textContent = dateText[0].toLocaleUpperCase('ru') + dateText.slice(1);

  const { pending, done, completed } = getDayPlan(state, displayedDay);
  if (!taskDrag.active()) {
    const tasks = editingList ? state.tasks : [...pending, ...done];
    renderTasks(tasks, completed, animate && !editingList);
  }
  const total = pending.length + done.length;
  const value = total ? Math.floor(done.length * 100 / total) : 0;
  progress.classList.toggle('complete', value === 100);
  progress.style.setProperty('--angle', `${value * 3.6}deg`);
  progress.setAttribute('aria-valuenow', value);
  percentage.textContent = value;

  let message = `Выполнено ${done.length} из ${total}`;
  if (!total) message = state.tasks.length ? 'На сегодня дел нет' : 'Добавьте дела на вечер';
  if (value === 100) message = 'Ура, можно ложиться спать!';
  if (status.textContent !== message) status.textContent = message;

  emptyList.hidden = (editingList ? state.tasks.length : total) > 0;
  startButton.hidden = editingList || state.tasks.length > 0;
  emptyMessage.textContent = state.tasks.length ? 'Следующие дела появятся по расписанию.' : 'Список пока пуст.';
}

function saveState(next, now, animate = false) {
  state = next;
  persist(next);
  renderDay(now, animate);
}

function watchDay() {
  clearTimeout(dayTimer);
  const now = new Date();
  if (dateKey(logicalDate(now)) !== displayedDay) renderDay(now);
  dayTimer = setTimeout(watchDay, Math.min(nextRollover(now) - now, 60_000));
}

function showRoute(shouldFocus = false) {
  const route = Object.hasOwn(screens, location.hash) ? location.hash : '#home';
  for (const [key, screen] of Object.entries(screens)) screen.hidden = key !== route;
  topbar.hidden = route !== '#evening';
  today.hidden = topbar.hidden;
  document.title = screenTitles[route];
  if (route === '#evening') watchDay();
  else setListEditing(false);
  if (route !== '#settings') {
    backupRead++;
    showBackupStatus('');
    if (restoreDialog.open) closeRestore();
  }
  if (shouldFocus) {
    window.scrollTo(0, 0);
    const heading = screens[route].querySelector('h1');
    heading.focus({ preventScroll: true });
  }
}

function showBackupStatus(message, error = false) {
  backupStatus.textContent = message;
  backupStatus.toggleAttribute('data-error', error);
}

document.querySelector('#download-backup').addEventListener('click', () => {
  let contents;
  try {
    contents = encodeBackup(readState());
  } catch (error) {
    showBackupStatus(error.message, true);
    return;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `life-tracker-${dateKey(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  showBackupStatus('Загрузка резервной копии началась.');
});

document.querySelector('#choose-backup').addEventListener('click', () => backupFile.click());
backupFile.addEventListener('cancel', () => {
  backupRead++;
  if (!screens['#settings'].hidden) showBackupStatus('Восстановление отменено.');
});
backupFile.addEventListener('change', async () => {
  const file = backupFile.files[0];
  backupFile.value = '';
  if (!file || screens['#settings'].hidden) return;

  const read = ++backupRead;
  showBackupStatus('Проверяю файл…');
  let contents;
  try {
    contents = await file.text();
  } catch {
    if (read === backupRead) showBackupStatus('Не удалось открыть файл.', true);
    return;
  }
  if (read !== backupRead) return;

  try {
    stagedBackup = decodeBackup(contents);
  } catch (error) {
    showBackupStatus(error.message, true);
    return;
  }

  restoreFilename.textContent = file.name;
  restoreDialog.showModal();
  showBackupStatus('');
});

function closeRestore() {
  stagedBackup = undefined;
  restoreDialog.close();
}

function cancelRestore() {
  closeRestore();
  showBackupStatus('Восстановление отменено.');
}

restoreDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelRestore();
});

document.querySelector('#restore-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter?.value !== 'replace') {
    cancelRestore();
    return;
  }

  const snapshot = stagedBackup;
  closeRestore();
  if (!snapshot) return;

  try {
    writeState(snapshot);
  } catch {
    showBackupStatus('Не удалось восстановить данные. Текущие данные остались на месте.', true);
    return;
  }

  state = snapshot;
  renderDay();
  showBackupStatus('Резервная копия восстановлена.');
});

taskList.addEventListener('change', (event) => {
  if (editingList) return;
  const checkbox = event.target;
  const id = checkbox.dataset.taskId;
  const now = new Date();
  const day = dateKey(logicalDate(now));
  const latest = readState();
  const { pending, done, completed } = getDayPlan(latest, day);
  if (![...pending, ...done].some((task) => task.id === id)) {
    state = latest;
    renderDay(now);
    return;
  }

  const checked = day === displayedDay ? checkbox.checked : !completed.has(id);
  if (checked) completed.add(id);
  else completed.delete(id);
  const checks = { ...latest.checks };
  if (completed.size) checks[day] = [...completed];
  else delete checks[day];
  saveState({ ...latest, checks }, now, true);
});

function setListEditing(enabled) {
  if (editingList === enabled) return;

  if (!enabled) {
    if (taskEditor.open) closeTaskEditor();
    taskDrag.cancel();
  }
  editingList = enabled;
  state = readState();
  taskList.classList.toggle('is-editing', enabled);
  addButton.hidden = !enabled;
  orderHelp.hidden = !enabled;
  orderStatus.textContent = '';
  editButton.querySelector('.pencil').hidden = enabled;
  editLabel.textContent = enabled ? 'Готово' : 'Изменить';
  renderDay();
}

function applyTaskOrder(latest, tasks, movedId) {
  if (!tasks.some(({ id }, index) => id !== latest.tasks[index].id)) {
    state = latest;
    renderDay();
    return;
  }
  saveState({ ...latest, tasks });
  const index = tasks.findIndex(({ id }) => id === movedId);
  if (index >= 0) orderStatus.textContent = `${tasks[index].title}. Позиция ${index + 1} из ${tasks.length}.`;
}

function dropTask(id, order) {
  const latest = readState();
  const remaining = new Map(latest.tasks.map((task) => [task.id, task]));
  const tasks = [];
  for (const id of order) {
    if (!remaining.has(id)) continue;
    tasks.push(remaining.get(id));
    remaining.delete(id);
  }
  tasks.push(...remaining.values());
  applyTaskOrder(latest, tasks, id);
}

function moveTask(row, direction) {
  const latest = readState();
  const { taskId } = row.dataset;
  const from = latest.tasks.findIndex(({ id }) => id === taskId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= latest.tasks.length) return;

  const tasks = [...latest.tasks];
  [tasks[from], tasks[to]] = [tasks[to], tasks[from]];
  applyTaskOrder(latest, tasks, taskId);
  row.scrollIntoView({ block: 'nearest' });
}

taskList.addEventListener('keydown', (event) => {
  const handle = event.target.closest('.drag-handle');
  if (!editingList || !handle) return;

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveTask(handle.closest('.task-item'), event.key === 'ArrowUp' ? -1 : 1);
  }
  if (event.key === 'Escape' && handle.parentElement.open) handle.parentElement.open = false;
});

taskList.addEventListener('click', (event) => {
  if (!editingList) return;
  const row = event.target.closest('.task-item');
  if (!row) return;

  const settings = event.target.closest('.task-settings');
  if (settings) openTaskEditor(row.dataset.taskId, settings);
  if (event.target.closest('.move-up')) moveTask(row, -1);
  if (event.target.closest('.move-down')) moveTask(row, 1);
});

for (const [day, short, long] of weekdays) {
  const choice = document.createElement('label');
  const checkbox = document.createElement('input');
  const caption = document.createElement('span');
  checkbox.type = 'checkbox';
  checkbox.value = day;
  checkbox.setAttribute('aria-label', long);
  caption.textContent = short;
  choice.append(checkbox, caption);
  weekdayChoices.append(choice);
}

function updateScheduleFields() {
  intervalOptions.hidden = scheduleKind.value !== 'interval';
  intervalDays.disabled = intervalOptions.hidden;
  intervalDays.required = !intervalOptions.hidden;
  weekdayOptions.hidden = scheduleKind.value !== 'weekly';
  weekdayOptions.disabled = weekdayOptions.hidden;
}

function setConfirmingDeletion(confirming) {
  taskFields.hidden = confirming;
  deleteMessage.hidden = !confirming;
  saveTask.hidden = confirming;
  confirmDelete.hidden = !confirming;
  taskEditorTitle.textContent = confirming ? 'Удалить дело?' : taskDraft ? 'Настройки дела' : 'Новое дело';
}

function openTaskEditor(id, trigger) {
  taskDrag.cancel();
  state = readState();
  renderDay();
  taskDraft = state.tasks.find((task) => task.id === id);
  if (id !== undefined && !taskDraft) return;
  taskReturnFocus = trigger;

  const schedule = taskDraft?.schedule ?? daily;
  taskTitle.value = taskDraft?.title ?? '';
  taskTitle.setCustomValidity('');
  scheduleKind.value = schedule.kind;
  intervalDays.value = schedule.every ?? 2;
  for (const choice of weekdayChoices.querySelectorAll('input')) {
    choice.checked = schedule.weekdays?.includes(Number(choice.value)) ?? false;
  }
  deleteTask.hidden = !taskDraft;
  updateScheduleFields();
  setConfirmingDeletion(false);
  taskEditor.showModal();
  if (!taskDraft) taskTitle.focus();
}

function closeTaskEditor() {
  const trigger = taskReturnFocus;
  taskDraft = undefined;
  taskReturnFocus = undefined;
  taskEditor.close();
  if (trigger?.isConnected && !screens['#evening'].hidden) trigger.focus({ preventScroll: true });
}

function readSchedule() {
  const kind = scheduleKind.value;
  if (kind === 'interval') {
    const every = intervalDays.valueAsNumber;
    if (!Number.isSafeInteger(every) || every < 1) {
      intervalDays.setCustomValidity('Введите целое число дней от 1.');
      intervalDays.reportValidity();
      intervalDays.setCustomValidity('');
      return;
    }
    return { kind, every };
  }
  if (kind === 'weekly') {
    const days = [...weekdayChoices.querySelectorAll('input:checked')].map(({ value }) => Number(value));
    if (!days.length) {
      const first = weekdayChoices.querySelector('input');
      first.setCustomValidity('Выберите хотя бы один день недели.');
      first.reportValidity();
      first.setCustomValidity('');
      return;
    }
    return { kind, weekdays: days };
  }
  return daily;
}

function equalSchedule(left, right) {
  const leftDays = left.weekdays ?? [];
  const rightDays = right.weekdays ?? [];
  return left.kind === right.kind &&
    left.every === right.every &&
    leftDays.length === rightDays.length && leftDays.every((day) => rightDays.includes(day));
}

editButton.addEventListener('click', () => setListEditing(!editingList));
addButton.addEventListener('click', () => openTaskEditor(undefined, addButton));
startButton.addEventListener('click', () => {
  setListEditing(true);
  openTaskEditor(undefined, addButton);
});
document.querySelector('#close-task-editor').addEventListener('click', closeTaskEditor);
taskEditor.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeTaskEditor();
});
cancelTask.addEventListener('click', () => {
  if (deleteMessage.hidden) closeTaskEditor();
  else {
    setConfirmingDeletion(false);
    deleteTask.focus();
  }
});

scheduleKind.addEventListener('change', updateScheduleFields);
taskTitle.addEventListener('input', () => taskTitle.setCustomValidity(''));

deleteTask.addEventListener('click', () => {
  deleteMessage.textContent = `«${taskDraft.title}» будет удалено из списка.`;
  setConfirmingDeletion(true);
  cancelTask.focus();
});

confirmDelete.addEventListener('click', () => {
  const { id } = taskDraft;
  const latest = readState();
  const index = latest.tasks.findIndex((task) => task.id === id);
  closeTaskEditor();
  saveState({ ...latest, tasks: latest.tasks.filter((task) => task.id !== id) });
  const nextRow = taskList.children[Math.max(0, index)] ?? taskList.lastElementChild;
  (nextRow?.querySelector('.task-settings') ?? addButton).focus({ preventScroll: true });
});

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!deleteMessage.hidden) return;

  const title = taskTitle.value.trim();
  if (!title) {
    taskTitle.setCustomValidity('Введите название дела.');
    taskTitle.reportValidity();
    return;
  }
  const schedule = readSchedule();
  if (!schedule) return;

  const now = new Date();
  const day = dateKey(logicalDate(now));
  const latest = readState();
  const original = taskDraft;
  closeTaskEditor();
  if (!original) {
    const id = crypto.getRandomValues(new Uint32Array(4)).join('-');
    const task = { id, title, schedule, startsOn: day };
    saveState({ ...latest, tasks: [...latest.tasks, task] }, now);
    taskList.lastElementChild?.querySelector('.task-settings').focus();
    return;
  }

  const tasks = latest.tasks.map((task) => {
    if (task.id !== original.id) return task;
    const next = { ...task, title: title === original.title ? task.title : title };
    if (!equalSchedule(schedule, original.schedule) && !equalSchedule(schedule, task.schedule)) {
      next.schedule = schedule;
      next.startsOn = day;
    }
    return next;
  });
  saveState({ ...latest, tasks }, now);
});

window.addEventListener('storage', (event) => {
  if (![storageKey, legacyKey, null].includes(event.key)) return;
  state = readState();
  renderDay();
});
window.addEventListener('hashchange', () => showRoute(true));
window.addEventListener('focus', watchDay);
window.addEventListener('pageshow', watchDay);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) watchDay();
});

state = readState();
try {
  if (!localStorage.getItem(storageKey) && storedData(legacyKey)) persist(state);
} catch {
  // The screen remains usable when local storage is unavailable.
}
renderDay();
showRoute();
watchDay();

const pageUrl = new URL(location.href);
if (pageUrl.searchParams.has('life-tracker-update')) {
  pageUrl.searchParams.delete('life-tracker-update');
  history.replaceState(history.state, '', pageUrl);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' }).catch((error) => {
    console.warn('Life Tracker: автономный режим недоступен.', error);
  });
}
