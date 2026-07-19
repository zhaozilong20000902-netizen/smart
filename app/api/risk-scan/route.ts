import { NextRequest, NextResponse } from "next/server";
import { demoRiskResult } from "@/lib/demo-data";
import { riskScanSystemPrompt } from "@/lib/prompts";
import { redactSensitiveText } from "@/lib/redaction";
import { riskScanSchema } from "@/lib/schema";
import type { RiskScanResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function parseModelJson(value: unknown) {
  if (typeof value !== "string") return value;
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型未返回有效JSON");
  }
}

function preview(value: unknown) {
  return JSON.stringify(value, null, 2)?.slice(0, 1200);
}

function extractModelContent(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const payload = data as Record<string, any>;
  const choice = payload.choices?.[0];
  const candidates = [
    choice?.message?.content,
    choice?.message?.reasoning_content,
    choice?.text,
    payload.output_text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      const joined = candidate.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n");
      if (joined.trim()) return joined;
    }
  }
  if (Array.isArray(payload.output)) {
    const joinedOutput = payload.output
      .flatMap((item) => item?.content || [])
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n");
    if (joinedOutput.trim()) return joinedOutput;
  }

  return undefined;
}

async function runModel(input: Record<string, unknown>, redacted: string): Promise<{ result: RiskScanResult; mode: string }> {
  const endpoint = process.env.MODEL_API_URL;
  const apiKey = process.env.MODEL_API_KEY;
  const model = process.env.MODEL_NAME;
  if (!endpoint || !apiKey || !model) return { result: demoRiskResult, mode: "demo" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 24_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2400,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: riskScanSystemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              taskRequirement: input.task || "未提供",
              allowedAiScope: input.aiPolicy || "未提供",
              studentDeclaration: input.declaration || "未提供",
              enabledChecks: input.enabledChecks || [],
              textbookEvidence: input.textbookEvidence || [],
              submission: redacted,
            }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`模型接口返回 ${response.status}`);
    const data = await response.json();
    const raw = extractModelContent(data);
    if (!raw) {
      console.error("risk-scan empty model content", preview(data));
      throw new Error("模型接口响应中没有找到可解析内容");
    }

    const parsed = parseModelJson(raw);
    const result = riskScanSchema.safeParse(parsed);
    if (!result.success) {
      console.error("risk-scan invalid model schema", result.error.flatten(), preview(parsed));
      throw new Error("模型JSON结构不符合风险报告格式");
    }

    return { result: result.data, mode: "model" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.submission !== "string" || !body.submission.trim()) {
    return NextResponse.json({ error: "请先上传文件或粘贴待检查内容" }, { status: 400 });
  }
  if (body.submission.length > 120_000) {
    return NextResponse.json({ error: "文本内容过长，请控制在12万字符以内" }, { status: 413 });
  }

  const { redacted, hits } = redactSensitiveText(body.submission);
  try {
    const analysis = await runModel(body, redacted);
    return NextResponse.json({
      ...analysis.result,
      redactionHits: hits.map(({ type, replacement }) => ({ type, replacement })),
      mode: analysis.mode,
      storage: "none",
      checkedAt: new Date().toISOString(),
    }, { headers: { "x-zhihe-risk-parser": "candidate-fields-v3" } });
  } catch (error) {
    console.error("risk-scan failed", error);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({
        ...demoRiskResult,
        redactionHits: hits.map(({ type, replacement }) => ({ type, replacement })),
        mode: "demo",
        modelWarning: "模型响应超时，已返回演示结果。可更换响应更快的模型，或稍后重试。",
        storage: "none",
        checkedAt: new Date().toISOString(),
      }, { headers: { "x-zhihe-risk-parser": "candidate-fields-v3", "x-zhihe-model-fallback": "timeout" } });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "模型检查失败，请稍后重试" },
      { status: 502 },
    );
  }
}
