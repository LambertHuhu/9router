const LOW_INFORMATION_TEXTS = new Set(["响应", "回答", "好的", "好", "收到", "ok"]);

const COMPLETION_SIGNAL_RE = /(完成|已完成|通过|结果|原因|问题|字段|数据|结论|建议|need user input|blocked|root cause|final answer|fixed\b|resolved\b|verified\b|confirmed\b)/i;
const BLOCKER_SIGNAL_RE = /(阻塞|需要用户|need user input|waiting for approval|permission denied|auth required|cannot continue|can't continue|blocked\b)/i;

const ACTION_PLAN_PATTERNS = [
  /\b(let me|i should|i need to|i will|i'll|let's)\b/i,
  /^(?:explored|search(?:ed)?|investigat(?:e|ed|ing)|check(?:ed|ing)?|inspect(?:ed|ing)?|read(?:ing)?|found|ran)\b[\s\S]{0,240}$/i,
  /(先|现在|接下来|继续|需要).{0,24}(读|看|查|搜索|修改|改|实现|编译|运行|验证|同步|压测|部署|领取|做|执行|开始|清理|清除|上传|替换|写入|调整|重构)/,
  /(先做|开干|下一步|剩余任务).{0,32}(领取|开始|继续|做|实现|改|查|读|跑|执行|清理|上传|替换)/,
  /^(?:P\d+(?:\.\d+)?|[A-Z]\d+(?:\.\d+)?|响应)?\s*[:：].{0,120}(目标|准备|正在|先|接下来|继续|改|修改|实现|执行|开始|检查|读取|查看|清理|清除|上传|替换|写入|调整|重构)/,
];

const STRUCTURED_PROGRESS_RE = /(?:^|\n)\s*(?:└|├|│|•|-|\d+\.)\s+/m;
const SHELL_PROGRESS_RE = /(?:^|\n)\s*(?:bash:|\/bin\/sh:|warning:)/im;
const PATH_PROGRESS_RE = /(?:^|\n).*(?:\.\/|\/[A-Za-z0-9_.\-\/]+).*/m;
const PROCESS_PROGRESS_RE = /\b(?:force killed|log lines:|transcript|no matches|0 matches)\b/i;

export function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    return part?.text || "";
  }).join("");
}

export function isContinueUserText(text) {
  const compact = extractMessageText(text).replace(/\s+/g, "");
  return ["继续", "continue"].includes(compact.toLowerCase());
}

export function isLowInformationToolText(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  return LOW_INFORMATION_TEXTS.has(compact.toLowerCase());
}

export function hasCompletionSignal(text) {
  return COMPLETION_SIGNAL_RE.test(String(text || "").trim());
}

export function hasBlockerSignal(text) {
  return BLOCKER_SIGNAL_RE.test(String(text || "").trim());
}

export function isToolActionPlanText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (hasCompletionSignal(normalized) || hasBlockerSignal(normalized)) return false;
  return ACTION_PLAN_PATTERNS.some(pattern => pattern.test(normalized));
}

export function isToolProgressSummaryText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (isLowInformationToolText(normalized)) return true;
  if (hasCompletionSignal(normalized) || hasBlockerSignal(normalized)) return false;

  const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (PROCESS_PROGRESS_RE.test(normalized)) return true;
  if (SHELL_PROGRESS_RE.test(normalized)) return true;
  if (lines.length > 1 && STRUCTURED_PROGRESS_RE.test(normalized)) return true;
  if (lines.length > 1 && PATH_PROGRESS_RE.test(normalized)) return true;
  return false;
}

export function shouldContinueToolSessionText(text, context = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (hasCompletionSignal(normalized) || hasBlockerSignal(normalized)) return false;

  const actionPlan = isToolActionPlanText(normalized);
  const progressSummary = isToolProgressSummaryText(normalized);

  // Structural context alone is not enough to force continuation.
  // We only continue when the text itself still looks like an in-progress
  // tool-session update (plan/progress), then use surrounding structure as
  // supporting evidence.
  if (!actionPlan && !progressSummary) return false;

  let continueScore = 0;
  if (context.requestHasTools) continueScore += 1;
  if (context.requestEndsWithToolResult || context.previousRole === "tool") continueScore += 2;
  if (context.lastUserWasContinue || context.nextIsContinueUser) continueScore += 1;
  if (context.nextAssistantToolCall) continueScore += 2;
  if (context.nextToolMessage || context.hasFollowingToolActivity) continueScore += 1;
  if (context.hasContinuationGuard) continueScore += 1;
  if (actionPlan) continueScore += 2;
  if (progressSummary) continueScore += 1;

  return continueScore >= 3;
}

export function shouldPromoteToolSessionStopText(text, context = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (isLowInformationToolText(normalized)) return false;
  if (!context.requestHasTools) return true;
  return !shouldContinueToolSessionText(normalized, context);
}

export function shouldDropStaleToolSessionAssistantText(text, context = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (isLowInformationToolText(normalized)) return true;
  if (hasCompletionSignal(normalized) || hasBlockerSignal(normalized)) return false;
  if (!context.requestHasTools) return false;
  if (!shouldContinueToolSessionText(normalized, context)) return false;

  return Boolean(
    context.previousRole === "tool" ||
    context.nextAssistantToolCall ||
    context.nextToolMessage ||
    context.nextIsContinueUser ||
    context.hasFollowingToolActivity ||
    context.hasContinuationGuard
  );
}
