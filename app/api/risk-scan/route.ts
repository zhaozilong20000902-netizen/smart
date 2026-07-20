import { NextRequest, NextResponse } from "next/server";
import { demoRiskResult } from "@/lib/demo-data";
import { modelResponseDiagnostics, parseRiskScanModelResponse, parseUpstreamPayload } from "@/lib/model-response";
import { riskScanSystemPrompt } from "@/lib/prompts";
import { redactSensitiveText } from "@/lib/redaction";
import { buildLocalRiskFallback } from "@/lib/risk-fallback";
import { riskScanSchema } from "@/lib/schema";
import type { RiskScanResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type ModelMode = "model" | "demo";
type ModelFailureCode = "timeout" | "upstream" | "invalid-output";

class ModelFailure extends Error {
  code: ModelFailureCode;

  constructor(code: ModelFailureCode, message: string) {
    super(message);
    this.name = "ModelFailure";
    this.code = code;
  }
}

async function runModel(input: Record<string, unknown>, redacted: string): Promise<{
  result: RiskScanResult;
  mode: ModelMode;
  source?: string;
  repaired?: boolean;
}> {
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
        stream: false,
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
    const rawResponse = await response.text();
    if (!response.ok) throw new ModelFailure("upstream", `模型接口返回 ${response.status}`);
    const data = parseUpstreamPayload(rawResponse);
    const parsed = parseRiskScanModelResponse(data);
    if (!parsed) {
      console.warn("risk-scan model output rejected", modelResponseDiagnostics(data, rawResponse.length));
      throw new ModelFailure("invalid-output", "模型输出未通过JSON结构校验");
    }

    const result = riskScanSchema.safeParse(parsed.result);
    if (!result.success) {
      console.warn("risk-scan normalized schema rejected", {
        ...modelResponseDiagnostics(data, rawResponse.length),
        issues: result.error.issues.map((issue) => issue.path.join(".")).slice(0, 8),
      });
      throw new ModelFailure("invalid-output", "模型JSON结构不符合风险报告格式");
    }

    return { result: result.data, mode: "model", source: parsed.source, repaired: parsed.repaired };
  } catch (error) {
    if (error instanceof ModelFailure) throw error;
    if (error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message))) {
      throw new ModelFailure("timeout", "模型响应超时");
    }
    throw new ModelFailure("upstream", error instanceof Error ? error.message : "模型服务不可用");
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackWarning(code: ModelFailureCode) {
  if (code === "timeout") return "模型响应超时，已使用本地规则生成本次报告。";
  if (code === "invalid-output") return "模型返回内容不完整或格式异常，已使用本地规则生成本次报告。";
  return "模型服务暂时不可用，已使用本地规则生成本次报告。";
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
    const headers: Record<string, string> = {
      "x-zhihe-risk-parser": "resilient-v4",
      "x-zhihe-model-source": analysis.source || analysis.mode,
    };
    if (analysis.repaired) headers["x-zhihe-model-output"] = "repaired";
    return NextResponse.json({
      ...analysis.result,
      redactionHits: hits.map(({ type, replacement }) => ({ type, replacement })),
      mode: analysis.mode,
      storage: "none",
      checkedAt: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    const failure = error instanceof ModelFailure ? error : new ModelFailure("upstream", "模型检查失败");
    console.warn("risk-scan local fallback", { code: failure.code, message: failure.message });
    const fallback = buildLocalRiskFallback({
      input: body,
      redacted,
      redactionHits: hits.map(({ type, replacement }) => ({ type, replacement })),
    });
    return NextResponse.json({
      ...fallback,
      redactionHits: hits.map(({ type, replacement }) => ({ type, replacement })),
      mode: "fallback",
      modelWarning: fallbackWarning(failure.code),
      storage: "none",
      checkedAt: new Date().toISOString(),
    }, {
      headers: {
        "x-zhihe-risk-parser": "resilient-v4",
        "x-zhihe-model-fallback": failure.code,
      },
    });
  }
}
