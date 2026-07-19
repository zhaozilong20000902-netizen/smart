import type { RiskScanResult } from "./types";

export const demoSubmission = `任务：为户外便携灯设计北美市场商品详情页。

目标消费者重视续航和防水性能。该产品续航时间为72小时，防水等级达到IP68，是目前同价位产品中性能最强的选择。平台允许所有商品在主图中直接标注最低价，因此主图使用“LOWEST PRICE GUARANTEED”文案。根据行业数据显示，该市场2025年增长率已达到48%。

AI使用声明：仅使用AI完成部分英文术语翻译，未使用AI生成商品卖点和市场数据。`;

export const demoRiskResult: RiskScanResult = {
  summary: {
    reviewPriority: 78,
    priorityLevel: "建议优先核验",
    notice: "该分值只表示教师复核优先顺序，不代表AI生成概率。",
  },
  riskItems: [
    {
      id: "textbook-conflict",
      type: "教材一致性",
      level: "重点",
      title: "促销规则与指定教材明确冲突",
      evidence: "平台允许所有商品在主图中直接标注最低价。",
      location: "最终稿第2段",
      basis: "指定教材明确要求商品主图不得直接展示价格或无法验证的促销承诺。",
      referenceSource: "《跨境电商平台运营（第三版）》",
      referenceLocation: "第4章第2节，第86页",
      weight: 30,
      followUpQuestion: "请说明你判断平台允许在主图标注最低价的规则依据。",
      status: "待复核",
    },
    {
      id: "source",
      type: "来源支撑",
      level: "一般",
      title: "市场增长结论没有可核验来源",
      evidence: "该市场2025年增长率已达到48%。",
      location: "最终稿第2段",
      basis: "学生AI使用声明与过程材料均未提供数据来源。",
      weight: 18,
      followUpQuestion: "增长率数据来自哪个机构？你如何验证其可信度？",
      status: "待复核",
    },
    {
      id: "declaration",
      type: "声明一致性",
      level: "一般",
      title: "最终稿变化超出学生声明的AI使用范围",
      evidence: "最终稿新增完整英文营销文案，但声明仅使用AI翻译术语。",
      location: "AI声明与版本差异",
      basis: "需要学生说明文案形成和修改过程，不能直接推断其由AI生成。",
      weight: 16,
      followUpQuestion: "请说明英文营销文案从初稿到最终稿的形成过程。",
      status: "待复核",
    },
    {
      id: "copyright",
      type: "版权与引用",
      level: "提醒",
      title: "商品图片未记录授权和来源",
      evidence: "最终稿中包含3张网络商品图片，未附图片来源。",
      location: "最终稿图片1—3",
      basis: "任务规范要求网络图片记录来源和可用授权信息。",
      weight: 8,
      followUpQuestion: "请补充图片来源，并说明是否获得合法使用授权。",
      status: "待复核",
    },
  ],
};
