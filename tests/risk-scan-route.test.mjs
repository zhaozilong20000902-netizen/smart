import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return {
        url: new URL(`${specifier.slice(2)}.ts`, projectRoot).href,
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST } = await import("../app/api/risk-scan/route.ts");
const originalFetch = globalThis.fetch;

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

async function callRoute(fetchImplementation, submission) {
  process.env.MODEL_API_URL = "https://mock.local/v1/chat/completions";
  process.env.MODEL_API_KEY = "test-only-key";
  process.env.MODEL_NAME = "nex-agi/Nex-N2-Pro";
  globalThis.fetch = fetchImplementation;
  try {
    return await POST(new Request("http://localhost/api/risk-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        submission,
        declaration: "仅使用AI进行术语翻译。",
        enabledChecks: ["source"],
        task: "说明数据来源。",
        aiPolicy: "不得虚构数据。",
        textbookEvidence: [],
      }),
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("route repairs truncated reasoning JSON and returns a model report", async () => {
  const truncated = `${JSON.stringify(report).slice(0, -2)},{"id":"risk-2","title":"被截断的线索`;
  const response = await callRoute(async () => new Response(JSON.stringify({
    model: "nex-agi/Nex-N2-Pro",
    choices: [{ message: { content: "", reasoning_content: truncated }, finish_reason: "length" }],
  }), { status: 200, headers: { "content-type": "application/json" } }), "市场增长率达到48%。");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "model");
  assert.equal(payload.riskItems.length, 1);
  assert.equal(response.headers.get("x-zhihe-model-output"), "repaired");
});

test("route returns a local report instead of 502 for invalid model output", async () => {
  const response = await callRoute(async () => new Response(JSON.stringify({
    model: "nex-agi/Nex-N2-Pro",
    choices: [{ message: { content: "", reasoning_content: "analysis without a report" }, finish_reason: "stop" }],
  }), { status: 200, headers: { "content-type": "application/json" } }), "2025年市场增长率达到48%。");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "fallback");
  assert.equal(response.headers.get("x-zhihe-model-fallback"), "invalid-output");
  assert.match(payload.riskItems[0].evidence, /48%/);
});

test("route returns a local report instead of 502 for an upstream error", async () => {
  const response = await callRoute(async () => new Response("upstream unavailable", { status: 500 }), "2025年市场增长率达到48%。");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "fallback");
  assert.equal(response.headers.get("x-zhihe-model-fallback"), "upstream");
});
