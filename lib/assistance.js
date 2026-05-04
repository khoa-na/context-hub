const fs = require("fs/promises");
const path = require("path");
const { ROOT, INTERNAL_TASKS_PATH } = require("../constants");

const ASSISTANCE_TIMEZONE = "Asia/Ho_Chi_Minh";
const DONE_STATUSES = new Set(["done", "completed", "closed", "cancelled", "canceled"]);

const FALLBACK_MINDOS_GUIDE = [
  "# MIND OS DS",
  "",
  "DS must be proactive, practical, and human.",
  "DS refers to itself as \"DS\" and calls the user \"anh/chị\".",
  "DS asks for confirmation before important actions.",
  "DS does not claim to send, ping, create, or update anything unless the app actually did it.",
  "Avoid these words: tối ưu hóa, thông minh, AI.",
  "End with a next action or a question.",
].join("\n");

function formatDateInTimezone(date, timeZone = ASSISTANCE_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseTaskDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function normalizeTasksPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.tasks)) {
    return payload.tasks;
  }
  return [];
}

function normalizeTask(raw, index) {
  const dueAt = raw?.dueAt || raw?.dueDate || raw?.date || "";
  const status = String(raw?.status || "open").trim().toLowerCase();

  return {
    id: String(raw?.id || `task-${index + 1}`).trim(),
    title: String(raw?.title || raw?.name || "Untitled task").trim(),
    owner: String(raw?.owner || "").trim(),
    dueAt: String(dueAt || "").trim(),
    status,
    customer: String(raw?.customer || raw?.client || "").trim(),
    notes: String(raw?.notes || raw?.description || "").trim(),
  };
}

async function loadAssistanceGuide() {
  try {
    const guide = await fs.readFile(path.join(ROOT, "MindOS_5KB_DS.md"), "utf8");
    return guide.trim() || FALLBACK_MINDOS_GUIDE;
  } catch {
    return FALLBACK_MINDOS_GUIDE;
  }
}

async function loadInternalTasks() {
  try {
    const raw = await fs.readFile(INTERNAL_TASKS_PATH, "utf8");
    const payload = JSON.parse(raw);
    return normalizeTasksPayload(payload).map(normalizeTask);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw new Error(`Could not read internal tasks: ${err.message}`);
  }
}

function isOpenTask(task) {
  return !DONE_STATUSES.has(String(task.status || "").toLowerCase());
}

function classifyTaskTiming(task, today, timeZone = ASSISTANCE_TIMEZONE) {
  const dueDate = parseTaskDate(task.dueAt);
  if (!dueDate) {
    return "unscheduled";
  }

  const localDueDate = formatDateInTimezone(dueDate, timeZone);
  if (localDueDate < today) {
    return "overdue";
  }
  if (localDueDate === today) {
    return "today";
  }
  return "future";
}

function compareTasks(a, b) {
  const timingWeight = { overdue: 3, today: 2, unscheduled: 1, future: 0 };
  const timingDiff = (timingWeight[b.timing] || 0) - (timingWeight[a.timing] || 0);
  if (timingDiff) {
    return timingDiff;
  }

  return String(a.dueAt || "").localeCompare(String(b.dueAt || ""));
}

function buildTaskLine(task, index) {
  const parts = [`${index + 1}. ${task.title}`];
  if (task.customer) parts.push(`khách: ${task.customer}`);
  if (task.owner) parts.push(`phụ trách: ${task.owner}`);
  if (task.dueAt) parts.push(`hạn: ${task.dueAt}`);
  if (task.notes) parts.push(task.notes);
  return parts.join(" | ");
}

function buildAssistanceBrief({ tasks, today, timeZone }) {
  const actionable = tasks.filter((task) => task.timing === "overdue" || task.timing === "today");
  const overdueCount = tasks.filter((task) => task.timing === "overdue").length;
  const todayCount = tasks.filter((task) => task.timing === "today").length;

  if (!actionable.length) {
    return [
      `DS chưa thấy công việc nào đến hạn hôm nay (${today}, ${timeZone}) trong file nội bộ.`,
      "Anh/chị muốn DS kiểm tra lại sau khi thêm task, hay bắt đầu bằng một việc mới?",
    ].join("\n");
  }

  return [
    `DS thấy ${actionable.length} việc cần chú ý hôm nay (${today}, ${timeZone}): ${overdueCount} quá hạn, ${todayCount} đến hạn hôm nay.`,
    ...actionable.slice(0, 8).map(buildTaskLine),
    "Anh/chị muốn DS bắt đầu từ việc nào trước?",
  ].join("\n");
}

async function getTodayAssistanceBrief({ now = new Date(), timeZone = ASSISTANCE_TIMEZONE } = {}) {
  const today = formatDateInTimezone(now, timeZone);
  const tasks = (await loadInternalTasks())
    .filter(isOpenTask)
    .map((task) => ({
      ...task,
      timing: classifyTaskTiming(task, today, timeZone),
    }))
    .filter((task) => task.timing !== "future")
    .sort(compareTasks);
  const overdue = tasks.filter((task) => task.timing === "overdue");
  const dueToday = tasks.filter((task) => task.timing === "today");
  const unscheduled = tasks.filter((task) => task.timing === "unscheduled");

  return {
    timeZone,
    today,
    tasks,
    counts: {
      total: tasks.length,
      overdue: overdue.length,
      today: dueToday.length,
      unscheduled: unscheduled.length,
    },
    brief: buildAssistanceBrief({ tasks, today, timeZone }),
  };
}

function buildAssistanceSystemInstruction(guide) {
  return [
    "You are DS, an internal work assistant for the user.",
    "Follow the MindOS DS behavior guide exactly.",
    "Use only the supplied internal task context when discussing current work.",
    "Assess importance yourself from due dates, status, customer context, and notes; do not rely on a priority field.",
    "Do not claim that you sent messages, pinged anyone, created tasks, or changed data.",
    "If the user asks for an important action, ask for confirmation or missing details first.",
    "",
    "=== MINDOS DS GUIDE ===",
    guide,
  ].join("\n");
}

function buildTaskContext(brief) {
  if (!brief?.tasks?.length) {
    return brief?.brief || "No internal tasks are available for today.";
  }

  return [
    `Today: ${brief.today}`,
    `Timezone: ${brief.timeZone}`,
    `Counts: ${JSON.stringify(brief.counts)}`,
    "",
    "Tasks:",
    ...brief.tasks.map((task, index) => buildTaskLine(task, index)),
  ].join("\n");
}

function buildAssistanceUserPrompt({ question, history, brief }) {
  const historyLines = (history || [])
    .slice(-8)
    .map((entry) => `[${entry.role === "assistant" ? "DS" : "User"}]: ${entry.content}`)
    .join("\n");

  return [
    historyLines ? `Conversation so far:\n${historyLines}` : "",
    `=== INTERNAL TASK CONTEXT ===\n${buildTaskContext(brief)}`,
    `=== USER MESSAGE ===\n${question}`,
  ].filter(Boolean).join("\n\n");
}

module.exports = {
  ASSISTANCE_TIMEZONE,
  loadAssistanceGuide,
  getTodayAssistanceBrief,
  buildAssistanceSystemInstruction,
  buildAssistanceUserPrompt,
};
