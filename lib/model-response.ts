import { jsonrepair } from "jsonrepair";
import type { ReviewStatus, RiskItem, RiskScanResult } from "./types";

type UnknownRecord = Record<string, unknown>;

export type ModelCandidate = {
  source: string;
  value: unknown;
};

export type ParsedModelReport = {
  result: RiskScanResult;
  source: string;
  repaired: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function joinContentParts(value: unknown): string | undefined {
  if (typeof value === "string") return asText(value);
  if (!Array.isArray(value)) return undefined;

  const joined = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return asText(part.text) || asText(part.content) || asText(part.output_text) || "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return joined || undefined;
}

function aggregateStreamEvents(events: unknown[]) {
  let content = "";
  let reasoningContent = "";
  let outputText = "";
  let finishReason: unknown;
  let model: unknown;
  const toolArguments = new Map<number, string>();

  for (const event of events) {
    if (!isRecord(event)) continue;
    model ||= event.model;
    outputText += asText(event.output_text) || "";
    const choices = Array.isArray(event.choices) ? event.choices : [];
    for (const rawChoice of choices) {
      if (!isRecord(rawChoice)) continue;
      finishReason ||= rawChoice.finish_reason;
      const message = isRecord(rawChoice.message) ? rawChoice.message : undefined;
      const delta = isRecord(rawChoice.delta) ? rawChoice.delta : undefined;
      for (const source of [message, delta]) {
        if (!source) continue;
        content += joinContentParts(source.content) || "";
        reasoningContent += asText(source.reasoning_content) || "";
        const toolCalls = Array.isArray(source.tool_calls) ? source.tool_calls : [];
        toolCalls.forEach((toolCall, fallbackIndex) => {
          if (!isRecord(toolCall)) return;
          const index = asNumber(toolCall.index) ?? fallbackIndex;
          const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
          const args = fn ? asText(fn.arguments) : undefined;
          if (args) toolArguments.set(index, `${toolArguments.get(index) || ""}${args}`);
        });
      }
    }
  }

  const toolCalls = [...toolArguments.entries()].map(([index, args]) => ({
    index,
    function: { arguments: args },
  }));

  return {
    model,
    choices: [{
      finish_reason: finishReason,
      message: {
        content,
        reasoning_content: reasoningContent,
        tool_calls: toolCalls,
      },
    }],
    output_text: outputText,
  };
}

export function parseUpstreamPayload(rawText: string): unknown {
  const cleaned = rawText.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return "";

  try {
    return JSON.parse(cleaned);
  } catch {
    // Some OpenAI-compatible gateways return SSE or NDJSON even when stream=false.
  }

  const eventLines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "data: [DONE]")
    .map((line) => line.startsWith("data:") ? line.slice(5).trim() : line);
  const events: unknown[] = [];
  for (const line of eventLines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Ignore non-data SSE fields such as `event:` and keep the raw text as fallback.
    }
  }

  return events.length ? aggregateStreamEvents(events) : cleaned;
}

function addCandidate(candidates: ModelCandidate[], source: string, value: unknown) {
  if (value == null) return;
  const joined = joinContentParts(value);
  if (joined) candidates.push({ source, value: joined });
  else if (isRecord(value)) candidates.push({ source, value });
}

function addMessageCandidates(candidates: ModelCandidate[], source: string, message: unknown) {
  if (!isRecord(message)) return;
  addCandidate(candidates, `${source}.parsed`, message.parsed);
  addCandidate(candidates, `${source}.json`, message.json);
  addCandidate(candidates, `${source}.content`, message.content);
  addCandidate(candidates, `${source}.reasoning_content`, message.reasoning_content);
  const functionCall = isRecord(message.function_call) ? message.function_call : undefined;
  addCandidate(candidates, `${source}.function_call.arguments`, functionCall?.arguments);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  toolCalls.forEach((toolCall, index) => {
    if (!isRecord(toolCall)) return;
    const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
    addCandidate(candidates, `${source}.tool_calls.${index}.arguments`, fn?.arguments);
  });
}

export function extractModelCandidates(payload: unknown): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  if (typeof payload === "string") {
    addCandidate(candidates, "response.text", payload);
    return candidates;
  }
  if (!isRecord(payload)) return candidates;

  if ("summary" in payload || "riskItems" in payload || "risk_items" in payload) {
    candidates.push({ source: "response", value: payload });
  }
  for (const key of ["parsed", "json", "result", "report", "data", "response"]) {
    addCandidate(candidates, `response.${key}`, payload[key]);
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  choices.forEach((rawChoice, index) => {
    if (!isRecord(rawChoice)) return;
    addMessageCandidates(candidates, `choices.${index}.message`, rawChoice.message);
    addMessageCandidates(candidates, `choices.${index}.delta`, rawChoice.delta);
    addCandidate(candidates, `choices.${index}.text`, rawChoice.text);
  });

  addCandidate(candidates, "response.output_text", payload.output_text);
  addCandidate(candidates, "response.content", payload.content);
  const output = Array.isArray(payload.output) ? payload.output : [];
  output.forEach((item, index) => {
    if (!isRecord(item)) return;
    addCandidate(candidates, `output.${index}.content`, item.content);
    addCandidate(candidates, `output.${index}.text`, item.text);
    addCandidate(candidates, `output.${index}.parsed`, item.parsed);
  });

  return candidates;
}

function balancedObjects(text: string) {
  const values: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        values.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return values;
}

function candidateVariants(value: string) {
  const cleaned = value.replace(/^\uFEFF/, "").trim();
  const variants = new Set<string>();
  if (!cleaned) return [];
  variants.add(cleaned);

  const withoutClosedThinking = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (withoutClosedThinking) variants.add(withoutClosedThinking);

  for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) variants.add(match[1].trim());
  }
  for (const object of balancedObjects(cleaned)) variants.add(object);

  for (const marker of ['"summary"', "'summary'", '"riskItems"', '"risk_items"']) {
    let markerIndex = cleaned.indexOf(marker);
    while (markerIndex >= 0) {
      const start = cleaned.lastIndexOf("{", markerIndex);
      if (start >= 0) variants.add(cleaned.slice(start));
      markerIndex = cleaned.indexOf(marker, markerIndex + marker.length);
    }
  }
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace >= 0) variants.add(cleaned.slice(firstBrace));

  return [...variants].slice(0, 30);
}

function parseJsonValues(value: unknown) {
  if (isRecord(value) || Array.isArray(value)) return [{ value, repaired: false }];
  if (typeof value !== "string") return [];

  const parsedValues: { value: unknown; repaired: boolean }[] = [];
  for (const candidate of candidateVariants(value.slice(0, 200_000))) {
    try {
      parsedValues.push({ value: JSON.parse(candidate), repaired: false });
      continue;
    } catch {
      // Try repairing malformed or truncated model JSON next.
    }
    try {
      parsedValues.push({ value: JSON.parse(jsonrepair(candidate)), repaired: true });
    } catch {
      // Another candidate may contain the actual report object.
    }
  }
  return parsedValues;
}

function reportRoots(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 3) return [];
  if (Array.isArray(value)) return value.flatMap((item) => reportRoots(item, depth + 1));
  if (!isRecord(value)) return [];

  const roots: UnknownRecord[] = [];
  if ("riskItems" in value || "risk_items" in value || "risks" in value) roots.push(value);
  for (const key of ["result", "report", "data", "response", "output"]) {
    if (key in value) roots.push(...reportRoots(value[key], depth + 1));
  }
  return roots;
}

function normalizeLevel(value: unknown): RiskItem["level"] {
  const level = asText(value) || "";
  if (/重点|严重|高/.test(level)) return "重点";
  if (/提醒|轻微|低/.test(level)) return "提醒";
  return "一般";
}

function normalizeStatus(value: unknown): ReviewStatus {
  const status = asText(value);
  if (status === "确认风险" || status === "不构成风险" || status === "需学生说明") return status;
  return "待复核";
}

function normalizeRiskItem(value: unknown, index: number): RiskItem | null {
  if (!isRecord(value)) return null;
  const title = asText(value.title) || asText(value.name);
  const evidence = asText(value.evidence) || asText(value.quote) || asText(value.originalText);
  if (!title || !evidence) return null;

  const level = normalizeLevel(value.level || value.severity);
  const defaultWeight = level === "重点" ? 30 : level === "一般" ? 18 : 8;
  return {
    id: asText(value.id) || `model-risk-${index + 1}`,
    type: asText(value.type) || asText(value.category) || "综合核验",
    level,
    title,
    evidence,
    location: asText(value.location) || "信息不足",
    basis: asText(value.basis) || asText(value.reason) || "模型未提供完整核验依据，需教师结合过程材料进一步确认。",
    referenceSource: asText(value.referenceSource) || asText(value.reference_source),
    referenceLocation: asText(value.referenceLocation) || asText(value.reference_location),
    weight: clamp(Math.round(asNumber(value.weight) ?? defaultWeight), 0, 100),
    followUpQuestion: asText(value.followUpQuestion) || asText(value.follow_up_question) || "请说明该内容的形成过程、资料来源和核验方法。",
    status: normalizeStatus(value.status),
  };
}

export function normalizeRiskScanResult(value: unknown): RiskScanResult | null {
  for (const root of reportRoots(value)) {
    const rawItemsValue = root.riskItems ?? root.risk_items ?? root.risks;
    const rawItems = Array.isArray(rawItemsValue)
      ? rawItemsValue
      : isRecord(rawItemsValue) ? [rawItemsValue] : null;
    if (!rawItems) continue;

    const riskItems = rawItems
      .slice(0, 8)
      .map(normalizeRiskItem)
      .filter((item): item is RiskItem => Boolean(item));
    if (rawItems.length > 0 && riskItems.length === 0) continue;

    const summary = isRecord(root.summary) ? root.summary : {};
    let reviewPriority = asNumber(summary.reviewPriority ?? summary.review_priority ?? root.reviewPriority);
    if (reviewPriority == null) reviewPriority = riskItems.reduce((sum, item) => sum + item.weight, 0);
    if (reviewPriority > 0 && reviewPriority <= 5) reviewPriority *= 20;
    reviewPriority = clamp(Math.round(reviewPriority), 0, 100);
    const priorityLevel = asText(summary.priorityLevel ?? summary.priority_level)
      || (reviewPriority >= 60 ? "建议优先核验" : reviewPriority >= 30 ? "建议常规核验" : reviewPriority > 0 ? "提示关注" : "未发现明确线索");

    return {
      summary: {
        reviewPriority,
        priorityLevel,
        notice: "该分值只表示教师复核优先顺序，不代表AI生成概率。",
      },
      riskItems,
    };
  }
  return null;
}

export function parseRiskScanModelResponse(payload: unknown): ParsedModelReport | null {
  for (const candidate of extractModelCandidates(payload)) {
    for (const parsed of parseJsonValues(candidate.value)) {
      const result = normalizeRiskScanResult(parsed.value);
      if (result) return { result, source: candidate.source, repaired: parsed.repaired };
      if (typeof parsed.value === "string") {
        for (const nested of parseJsonValues(parsed.value)) {
          const nestedResult = normalizeRiskScanResult(nested.value);
          if (nestedResult) {
            return { result: nestedResult, source: candidate.source, repaired: parsed.repaired || nested.repaired };
          }
        }
      }
    }
  }
  return null;
}

export function modelResponseDiagnostics(payload: unknown, responseChars: number) {
  const record = isRecord(payload) ? payload : undefined;
  const firstChoice = Array.isArray(record?.choices) && isRecord(record.choices[0]) ? record.choices[0] : undefined;
  return {
    model: asText(record?.model) || "unknown",
    finishReason: asText(firstChoice?.finish_reason) || "unknown",
    responseChars,
    candidateSources: extractModelCandidates(payload).map((candidate) => candidate.source),
  };
}
