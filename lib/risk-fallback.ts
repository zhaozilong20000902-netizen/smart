import type { RiskItem, RiskScanResult } from "./types";

type UnknownRecord = Record<string, unknown>;

type FallbackInput = {
  input: Record<string, unknown>;
  redacted: string;
  redactionHits: { type: string; replacement: string }[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enabled(input: Record<string, unknown>, check: string) {
  return !Array.isArray(input.enabledChecks) || input.enabledChecks.includes(check);
}

function statements(text: string) {
  return text
    .split(/[\n。！？!?；;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12)
    .slice(0, 120);
}

function locationFor(allStatements: string[], statement: string) {
  return `作品内容第 ${Math.max(1, allStatements.indexOf(statement) + 1)} 处（本地规则定位）`;
}

function sourceRisk(statement: string, index: number, allStatements: string[]): RiskItem {
  const hasNumber = /\d+(?:\.\d+)?\s*(?:%|％|万|亿|元|美元|小时|天|年)/.test(statement);
  return {
    id: `local-source-${index + 1}`,
    type: "来源与事实",
    level: hasNumber ? "一般" : "提醒",
    title: hasNumber ? "数据性结论缺少可核验来源" : "规则或行业判断需要补充依据",
    evidence: statement.slice(0, 220),
    location: locationFor(allStatements, statement),
    basis: "该陈述包含可核验的数据、政策、平台规则或绝对化判断，但当前提交材料中未识别到明确来源。此项仅提示教师核验，不代表内容由AI生成。",
    referenceSource: "信息不足",
    referenceLocation: "信息不足",
    weight: hasNumber ? 20 : 12,
    followUpQuestion: "请提供该结论的教材页码、法规文件、平台规则或数据报告，并说明你如何核验其有效性。",
    status: "待复核",
  };
}

export function buildLocalRiskFallback({ input, redacted, redactionHits }: FallbackInput): RiskScanResult {
  const riskItems: RiskItem[] = [];
  const allStatements = statements(redacted);

  if (enabled(input, "source")) {
    const claimPattern = /\d+(?:\.\d+)?\s*(?:%|％|万|亿|元|美元|小时|天|年)|增长|下降|持续|政策|规定|允许|禁止|最强|第一|保证|全部|降低|提升|行业数据/;
    const sourcePattern = /来源|出处|根据.{0,20}(?:报告|统计|教材|法规|规则)|https?:\/\/|www\.|doi\b|isbn\b/i;
    allStatements
      .filter((statement) => claimPattern.test(statement) && !sourcePattern.test(statement))
      .slice(0, 2)
      .forEach((statement, index) => riskItems.push(sourceRisk(statement, index, allStatements)));
  }

  if (enabled(input, "declaration") && !(typeof input.declaration === "string" && input.declaration.trim())) {
    riskItems.push({
      id: "local-declaration",
      type: "声明一致性",
      level: "提醒",
      title: "未提供学生AI使用声明",
      evidence: "当前提交未填写AI使用声明。",
      location: "学生AI使用声明",
      basis: "缺少声明时无法对照AI辅助范围与作品形成过程，需要学生补充说明。",
      weight: 10,
      followUpQuestion: "请说明本次作业使用了哪些AI工具、用于哪些环节，并提供必要的修改过程或版本记录。",
      status: "待复核",
    });
  }

  if (enabled(input, "textbook") && Array.isArray(input.textbookEvidence) && input.textbookEvidence.length) {
    const evidence = input.textbookEvidence.find(isRecord);
    if (evidence) {
      const statement = allStatements.find((item) => item.length <= 260) || redacted.slice(0, 220) || "信息不足";
      const rule = typeof evidence.rule === "string" ? evidence.rule : "本地检索已命中相关教材段落";
      riskItems.push({
        id: "local-textbook",
        type: "教材一致性",
        level: "提醒",
        title: "教材检索命中，需教师确认是否构成冲突",
        evidence: statement.slice(0, 220),
        location: locationFor(allStatements, statement),
        basis: `本地教材检索返回相关依据：“${rule.slice(0, 220)}”。关键词命中本身不能证明陈述错误，需教师结合教材上下文核验。`,
        referenceSource: typeof evidence.source === "string" ? evidence.source : "本机教材",
        referenceLocation: typeof evidence.location === "string" ? evidence.location : "信息不足",
        weight: 12,
        followUpQuestion: "请对照教材原文说明该陈述的依据，并解释是否存在适用条件、例外或版本差异。",
        status: "待复核",
      });
    }
  }

  if (enabled(input, "privacy") && redactionHits.length) {
    const types = [...new Set(redactionHits.map((hit) => hit.type))];
    riskItems.push({
      id: "local-privacy",
      type: "隐私与版权",
      level: "一般",
      title: "提交内容包含已自动遮蔽的敏感信息",
      evidence: `系统已遮蔽：${types.join("、")}。`,
      location: "提交内容（进入模型前已脱敏）",
      basis: "真实个人信息不应直接进入外部模型服务；本次请求已在服务端完成基础遮蔽。",
      weight: 18,
      followUpQuestion: "请确认原始作业中的相关信息是否必须保留，并在后续提交前完成匿名化处理。",
      status: "待复核",
    });
  }

  const limitedItems = riskItems.slice(0, 5);
  const reviewPriority = Math.min(100, limitedItems.reduce((sum, item) => sum + item.weight, 0));
  return {
    summary: {
      reviewPriority,
      priorityLevel: reviewPriority >= 60 ? "建议优先核验" : reviewPriority >= 30 ? "建议常规核验" : reviewPriority > 0 ? "提示关注" : "未发现明确线索",
      notice: "该分值只表示教师复核优先顺序，不代表AI生成概率。",
    },
    riskItems: limitedItems,
  };
}
