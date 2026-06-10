// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.

const PLACEHOLDER = " ";

// Provider-level rules: keyed by executor.provider
const PROVIDER_RULES = {
  deepseek: { scope: "toolCalls" },
  minimax: { scope: "all" },
  "minimax-cn": { scope: "all" }
};

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: m => /^kimi-/i.test(m || ""), scope: "toolCalls" },
  { match: m => /deepseek/i.test(m || ""), scope: "all" }
];

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max"
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null
  }
};

function shouldInject(message, scope) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyRule(body, rule) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map(m =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

function applyDeepSeekV4ProAlias({ provider, model, body }) {
  const alias = DEEPSEEK_V4_PRO_ALIASES[model];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: alias.thinkingType
      }
    }
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

function applyDeepSeekToolThinkingGuard({ provider, model, body }) {
  if (provider !== "deepseek" || model !== DEEPSEEK_V4_PRO || !Array.isArray(body?.tools) || body.tools.length === 0) {
    return body;
  }

  return {
    ...body,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: "disabled"
      }
    }
  };
}

export function injectReasoningContent({ provider, model, body }) {
  const providerRule = PROVIDER_RULES[provider];
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  const aliasedBody = applyDeepSeekV4ProAlias({ provider, model, body });
  const nextBody = applyDeepSeekToolThinkingGuard({ provider, model, body: aliasedBody });
  return applyRule(nextBody, rule);
}
