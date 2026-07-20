import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRiskScanModelResponse,
  parseUpstreamPayload,
} from "../lib/model-response.ts";
import { buildLocalRiskFallback } from "../lib/risk-fallback.ts";

const completeItem = {
  id: "risk-1",
  type: "source",
  level: "一般",
  title: "数据缺少来源",
  evidence: "市场增长率达到48%。",
  location: "第2段",
  basis: "未提供数据出处。",
  referenceSource: "信息不足",
  referenceLocation: "信息不足",
  weight: 20,
  followUpQuestion: "数据来自哪里？",
  status: "待复核",
};

const report = {
  summary: { reviewPriority: 40, priorityLevel: "一般", notice: "提示" },
  riskItems: [completeItem],
};

test("reads a report from reasoning_content", () => {
  const parsed = parseRiskScanModelResponse({
    choices: [{ message: { content: "", reasoning_content: JSON.stringify(report) } }],
  });
  assert.equal(parsed?.source, "choices.0.message.reasoning_content");
  assert.equal(parsed?.result.riskItems[0].title, "数据缺少来源");
});

test("repairs truncated JSON and drops the incomplete trailing item", () => {
  const truncated = `${JSON.stringify(report).slice(0, -2)},{"id":"risk-2","title":"被截断的线索`;
  const parsed = parseRiskScanModelResponse({
    choices: [{ message: { reasoning_content: truncated }, finish_reason: "length" }],
  });
  assert.equal(parsed?.repaired, true);
  assert.equal(parsed?.result.riskItems.length, 1);
  assert.equal(parsed?.result.riskItems[0].id, "risk-1");
});

test("salvages complete risk items when the enclosing JSON cannot be repaired", () => {
  const truncated = `模型草稿<{"summary":{"reviewPriority":40,"priorityLevel":"一般"},"riskItems":[${JSON.stringify(completeItem)},\u0000{"id":"risk-2","title":"未完成`;
  const parsed = parseRiskScanModelResponse({
    choices: [{ message: { reasoning_content: truncated }, finish_reason: "length" }],
  });
  assert.equal(parsed?.repaired, true);
  assert.equal(parsed?.result.riskItems.length, 1);
  assert.equal(parsed?.result.riskItems[0].id, "risk-1");
});

test("reads function-call arguments", () => {
  const parsed = parseRiskScanModelResponse({
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(report) } }] } }],
  });
  assert.equal(parsed?.source, "choices.0.message.tool_calls.0.arguments");
  assert.equal(parsed?.result.summary.reviewPriority, 40);
});

test("aggregates SSE content before parsing", () => {
  const json = JSON.stringify(report);
  const midpoint = Math.floor(json.length / 2);
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(0, midpoint) } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(midpoint) }, finish_reason: "stop" }] })}`,
    "data: [DONE]",
  ].join("\n\n");
  const parsed = parseRiskScanModelResponse(parseUpstreamPayload(body));
  assert.equal(parsed?.result.riskItems.length, 1);
});

test("normalizes common snake_case fields and a five-point priority", () => {
  const parsed = parseRiskScanModelResponse({
    result: {
      summary: { review_priority: 2, priority_level: "一般" },
      risk_items: [{
        id: "risk-1",
        category: "来源",
        severity: "中",
        title: "需要来源",
        quote: "物流成本持续下降。",
        reason: "当前没有出处。",
        follow_up_question: "依据是什么？",
      }],
    },
  });
  assert.equal(parsed?.result.summary.reviewPriority, 40);
  assert.equal(parsed?.result.riskItems[0].status, "待复核");
});

test("builds a submission-specific local fallback", () => {
  const fallback = buildLocalRiskFallback({
    input: { enabledChecks: ["source"], declaration: "仅使用AI翻译" },
    redacted: "行业数据显示，2025年市场增长率达到48%。",
    redactionHits: [],
  });
  assert.equal(fallback.riskItems.length, 1);
  assert.match(fallback.riskItems[0].evidence, /48%/);
  assert.match(fallback.summary.notice, /不代表AI生成概率/);
});
