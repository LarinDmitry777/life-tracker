import { dateKey, getDayPlan, logicalDate, nextRollover } from './schedule.js';

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
const startButton = document.querySelector('#start-list');
const editor = document.querySelector('#editor');
const editForm = document.querySelector('#edit-form');
const editorTasks = document.querySelector('#editor-tasks');
const editTemplate = document.querySelector('#edit-task-template');
const addButton = document.querySelector('#add-task');
const screens = {
  '#home': document.querySelector('#home-screen'),
  '#evening': document.querySelector('#evening-screen'),
  '#day-review': document.querySelector('#day-review-screen'),
};
const screenTitles = {
  '#home': 'Life Tracker',
  '#evening': 'Вечерняя рутина · Life Tracker',
  '#day-review': 'Итог дня · Life Tracker',
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
let editorSnapshot;
let dayTimer;

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

function persist(data) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    pendingSave = false;
  } catch {
    pendingSave = true;
  }
  storageError.hidden = !pendingSave;
}

function makeTaskRow(id) {
  const row = document.createElement('li');
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  const name = document.createElement('span');

  row.dataset.taskId = id;
  label.className = 'task-row';
  checkbox.type = 'checkbox';
  checkbox.className = 'task-check';
  checkbox.dataset.taskId = id;
  name.className = 'task-name';

  label.append(checkbox, name);
  row.append(label);
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
    if (name.textContent !== title) name.textContent = title;
    row.querySelector('.task-check').checked = completed.has(id);
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
    if (document.activeElement !== focused) focused.focus({ preventScroll: true });
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
    (taskList.querySelector('.task-check') ?? editButton).focus({ preventScroll: true });
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
  renderTasks([...pending, ...done], completed, animate);
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

  emptyList.hidden = total > 0;
  startButton.hidden = state.tasks.length > 0;
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
  if (shouldFocus) {
    if (editor.open) editor.close();
    window.scrollTo(0, 0);
    const heading = screens[route].querySelector('h1');
    heading.focus({ preventScroll: true });
  }
}

taskList.addEventListener('change', (event) => {
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

function updateOrderButtons() {
  for (const card of editorTasks.children) {
    card.querySelector('.move-up').disabled = !card.previousElementSibling;
    card.querySelector('.move-down').disabled = !card.nextElementSibling;
  }
}

function moveCard(card, upwards, button) {
  const neighbor = upwards ? card.previousElementSibling : card.nextElementSibling;
  if (!neighbor) return;
  if (upwards) editorTasks.insertBefore(card, neighbor);
  else editorTasks.insertBefore(neighbor, card);
  updateOrderButtons();
  const opposite = card.querySelector(upwards ? '.move-down' : '.move-up');
  (button.disabled ? opposite : button).focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest' });
}

function updateScheduleFields(card, kind) {
  const interval = card.querySelector('.interval-options');
  const week = card.querySelector('.weekday-options');
  const number = card.querySelector('.interval-days');
  interval.hidden = kind !== 'interval';
  number.disabled = interval.hidden;
  number.required = !interval.hidden;
  week.hidden = kind !== 'weekly';
  week.disabled = week.hidden;
}

function addEditorCard({ id, title, schedule }) {
  const card = editTemplate.content.firstElementChild.cloneNode(true);
  const field = card.querySelector('.task-title');
  const remove = card.querySelector('.remove-task');
  const legend = card.querySelector('legend');
  const select = card.querySelector('select');
  const week = card.querySelector('.weekdays');

  card.dataset.taskId = id;
  field.value = title;
  select.value = schedule.kind;
  if (schedule.kind === 'interval') card.querySelector('.interval-days').value = schedule.every;

  for (const [day, short, long] of weekdays) {
    const choice = document.createElement('label');
    const checkbox = document.createElement('input');
    const caption = document.createElement('span');
    checkbox.type = 'checkbox';
    checkbox.value = day;
    checkbox.checked = schedule.weekdays?.includes(day) ?? false;
    checkbox.setAttribute('aria-label', long);
    caption.textContent = short;
    choice.append(checkbox, caption);
    week.append(choice);
  }

  function updateLabels() {
    field.setCustomValidity('');
    legend.textContent = field.value.trim() || 'Новое дело';
    remove.setAttribute('aria-label', `Удалить: ${legend.textContent}`);
  }

  field.addEventListener('input', updateLabels);
  select.addEventListener('change', () => updateScheduleFields(card, select.value));
  week.addEventListener('change', () => week.querySelector('input').setCustomValidity(''));
  remove.addEventListener('click', () => {
    const neighbor = card.nextElementSibling ?? card.previousElementSibling;
    card.remove();
    updateOrderButtons();
    (neighbor?.querySelector('.task-title') ?? addButton).focus();
  });
  card.querySelector('.move-up').addEventListener('click', (event) => moveCard(card, true, event.currentTarget));
  card.querySelector('.move-down').addEventListener('click', (event) => moveCard(card, false, event.currentTarget));

  updateLabels();
  updateScheduleFields(card, select.value);
  editorTasks.append(card);
  return field;
}

function openEditor() {
  state = readState();
  renderDay();
  editorSnapshot = new Map(state.tasks.map((task) => [task.id, task]));
  editorTasks.replaceChildren();
  state.tasks.forEach(addEditorCard);
  updateOrderButtons();
  editor.showModal();
  if (!state.tasks.length) addButton.focus();
}

function readEditCard(card) {
  const field = card.querySelector('.task-title');
  const title = field.value.trim();
  if (!title) {
    field.setCustomValidity('Введите название дела.');
    field.reportValidity();
    return;
  }

  const kind = card.querySelector('select').value;
  let schedule = daily;
  if (kind === 'interval') {
    const number = card.querySelector('.interval-days');
    const every = number.valueAsNumber;
    if (!Number.isSafeInteger(every) || every < 1) {
      number.setCustomValidity('Введите целое число дней от 1.');
      number.reportValidity();
      number.setCustomValidity('');
      return;
    }
    schedule = { kind, every };
  } else if (kind === 'weekly') {
    const days = [...card.querySelectorAll('.weekdays input:checked')].map(({ value }) => Number(value));
    if (!days.length) {
      const first = card.querySelector('.weekdays input');
      first.setCustomValidity('Выберите хотя бы один день недели.');
      first.reportValidity();
      first.setCustomValidity('');
      return;
    }
    schedule = { kind, weekdays: days };
  }
  return { id: card.dataset.taskId, title, schedule };
}

function equalSchedule(left, right) {
  return left.kind === right.kind &&
    left.every === right.every &&
    (left.weekdays ?? []).join(',') === (right.weekdays ?? []).join(',');
}

function mergeEdits(latest, edited, day) {
  const updated = new Map(edited.map((task) => [task.id, task]));
  const originalOrder = [...editorSnapshot.keys()].filter((id) => updated.has(id));
  const editedOrder = [...updated.keys()];
  const reordered = editedOrder.some((id, index) => id !== originalOrder[index]);
  const merged = new Map();

  for (const task of latest.tasks) {
    const original = editorSnapshot.get(task.id);
    const draft = updated.get(task.id);
    if (original && !draft) continue;
    if (!original) {
      merged.set(task.id, task);
      continue;
    }
    const scheduleChanged = !equalSchedule(draft.schedule, original.schedule) &&
      !equalSchedule(draft.schedule, task.schedule);
    merged.set(task.id, {
      ...task,
      title: draft.title === original.title ? task.title : draft.title,
      schedule: scheduleChanged ? draft.schedule : task.schedule,
      startsOn: scheduleChanged ? day : task.startsOn,
    });
  }

  for (const task of edited) {
    if (!editorSnapshot.has(task.id)) merged.set(task.id, { ...task, startsOn: day });
  }
  if (!reordered) return [...merged.values()];

  const order = [...updated.keys(), ...merged.keys()];
  return [...new Set(order)].filter((id) => merged.has(id)).map((id) => merged.get(id));
}

editButton.addEventListener('click', openEditor);
startButton.addEventListener('click', openEditor);
document.querySelector('#close-editor').addEventListener('click', () => editor.close());
addButton.addEventListener('click', () => {
  const id = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const field = addEditorCard({ id, title: '', schedule: daily });
  updateOrderButtons();
  field.focus();
});

editForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const edited = [];
  for (const card of editorTasks.children) {
    const task = readEditCard(card);
    if (!task) return;
    edited.push(task);
  }

  const now = new Date();
  const latest = readState();
  const tasks = mergeEdits(latest, edited, dateKey(logicalDate(now)));
  editor.close();
  saveState({ ...latest, tasks }, now);
  if (document.activeElement === document.body) editButton.focus();
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.warn('Life Tracker: автономный режим недоступен.', error);
  });
}
