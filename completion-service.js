// DIC Completion Rate -- a training matrix: rows are tasks/procedures,
// columns are agents, each cell is Completed or Not Yet. Fully editable:
// add/remove agents, add/remove tasks, toggle any cell. Saved to this
// browser's localStorage, seeded with the team's existing progress on first
// load so nobody starts from a blank sheet.

const COMPLETION_KEY = 'dic_completion_v1';
const completionBus = new EventTarget();

const COMPLETION_SEED_TASKS = [
  "Understanding WinSCP and How to log in",
  "Function used in Putty to connect in WICNSCP (Base 54+)",
  "Where to get all Patches",
  "DF 100 (TOPAZ / RUBY2)",
  "DF 100 (C18)",
  "XPI PATCH / BLUE SCREEN patch BASE 53 +",
  "NCR PATCH",
  "BASE 53 \u2013 Register Lag PATCHES",
  "STOP TRANSACTION changed to FALSE",
  "Checking Stuck Cashier / Jlogs (Commander & POS)",
  "Secure User Patch",
  "XPI PATCH / BLUE SCREEN Lower Base 53",
  "How to Enable Debug (Commander and POS)",
  "Log Pull / ASM EXPIRED",
  "Sending Email for Log Pull Review (VF Email)",
  "Setting Email for Pending Log Pull (Trec Email)",
  "How to Enable Debug (Commander and POS)",
  "How to Enable PiNpad debug and get the Logs"
];

const COMPLETION_SEED_AGENTS = [
  "Remond Licayan",
  "Kyle Sioson",
  "AJ Dela Cruz",
  "Justin Castro",
  "Justine Elatico",
  "Christian Patdu",
  "Jocelyn Lagrimas",
  "Raven Guasis"
];

// row-major, matches COMPLETION_SEED_TASKS x COMPLETION_SEED_AGENTS above
const COMPLETION_SEED_GRID = [
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,0,0,1,0,0,0],
  [1,1,0,0,0,0,0,0],
  [1,1,1,1,0,1,0,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,0,0,0,0],
  [1,1,1,1,1,0,0,0],
  [1,1,1,1,1,1,0,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,0,0],
  [1,1,0,0,0,0,0,0]
];

function buildSeedCompletion() {
  const tasks = COMPLETION_SEED_TASKS.map((label, i) => ({ id: 'task-' + i, label }));
  const agents = COMPLETION_SEED_AGENTS.map((name, i) => ({ id: 'agent-' + i, name }));
  const status = {};
  tasks.forEach((task, r) => {
    status[task.id] = {};
    agents.forEach((agent, c) => {
      status[task.id][agent.id] = COMPLETION_SEED_GRID[r][c] === 1 ? 'done' : 'pending';
    });
  });
  return { tasks, agents, status };
}

function readCompletion() {
  try {
    const raw = localStorage.getItem(COMPLETION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* fall through to seed */
  }
  const seeded = buildSeedCompletion();
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(seeded));
  return seeded;
}

function writeCompletion(data) {
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(data));
  completionBus.dispatchEvent(new CustomEvent('change'));
}

function completionUid(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getCompletion() {
  return readCompletion();
}

function addCompletionAgent(name) {
  const data = readCompletion();
  const agent = { id: completionUid('agent'), name: name.trim() };
  data.agents.push(agent);
  data.tasks.forEach((t) => {
    data.status[t.id] = data.status[t.id] || {};
    data.status[t.id][agent.id] = 'pending';
  });
  writeCompletion(data);
}

function renameCompletionAgent(agentId, name) {
  const data = readCompletion();
  const agent = data.agents.find((a) => a.id === agentId);
  if (agent) agent.name = name.trim();
  writeCompletion(data);
}

function removeCompletionAgent(agentId) {
  const data = readCompletion();
  data.agents = data.agents.filter((a) => a.id !== agentId);
  Object.keys(data.status).forEach((taskId) => {
    delete data.status[taskId][agentId];
  });
  writeCompletion(data);
}

function addCompletionTask(label) {
  const data = readCompletion();
  const task = { id: completionUid('task'), label: label.trim() };
  data.tasks.push(task);
  data.status[task.id] = {};
  data.agents.forEach((a) => {
    data.status[task.id][a.id] = 'pending';
  });
  writeCompletion(data);
}

function renameCompletionTask(taskId, label) {
  const data = readCompletion();
  const task = data.tasks.find((t) => t.id === taskId);
  if (task) task.label = label.trim();
  writeCompletion(data);
}

function removeCompletionTask(taskId) {
  const data = readCompletion();
  data.tasks = data.tasks.filter((t) => t.id !== taskId);
  delete data.status[taskId];
  writeCompletion(data);
}

function toggleCompletionStatus(taskId, agentId) {
  const data = readCompletion();
  data.status[taskId] = data.status[taskId] || {};
  const current = data.status[taskId][agentId] || 'pending';
  data.status[taskId][agentId] = current === 'done' ? 'pending' : 'done';
  writeCompletion(data);
}

function agentProgress(data, agentId) {
  const total = data.tasks.length;
  if (total === 0) return 0;
  let done = 0;
  data.tasks.forEach((t) => {
    if ((data.status[t.id] || {})[agentId] === 'done') done += 1;
  });
  return done / total;
}

// Returns an unsubscribe function.
function subscribeCompletion(callback) {
  const emit = () => callback(getCompletion());
  emit();
  const handler = () => emit();
  completionBus.addEventListener('change', handler);
  window.addEventListener('storage', handler);
  return () => {
    completionBus.removeEventListener('change', handler);
    window.removeEventListener('storage', handler);
  };
}
