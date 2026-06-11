import { detectClientTool } from "../utils/clientDetector.js";

// Format identifiers
export const FORMATS = {
  OPENAI: "openai",
  OPENAI_RESPONSES: "openai-responses",
  OPENAI_RESPONSE: "openai-response",
  CLAUDE: "claude",
  GEMINI: "gemini",
  GEMINI_CLI: "gemini-cli",
  VERTEX: "vertex",
  CODEX: "codex",
  ANTIGRAVITY: "antigravity",
  KIRO: "kiro",
  CURSOR: "cursor",
  OLLAMA: "ollama",
  COMMANDCODE: "commandcode"
};

/**
 * Detect source format from request URL pathname + body.
 * Returns null to fall back to body-based detection.
 */
export function detectFormatByEndpoint(pathname, body, headers = {}) {
  // /v1/responses is always openai-responses
  if (pathname.includes("/v1/responses")) return FORMATS.OPENAI_RESPONSES;

  // /v1/messages is always Claude
  if (pathname.includes("/v1/messages")) return FORMATS.CLAUDE;

  // /v1/chat/completions + input[]
  // Cursor/GitHub-side clients may send Responses-shaped bodies via chat endpoint but
  // still expect Chat Completions behavior. Codex CLI, however, is genuinely Responses.
  if (pathname.includes("/v1/chat/completions") && Array.isArray(body?.input)) {
    const clientTool = detectClientTool(headers, body);
    if (clientTool === "codex") return FORMATS.OPENAI_RESPONSES;
    return FORMATS.OPENAI;
  }

  return null;
}
