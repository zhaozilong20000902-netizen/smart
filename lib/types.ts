export type ReviewStatus = "待复核" | "确认风险" | "不构成风险" | "需学生说明";

export type RiskItem = {
  id: string;
  type: string;
  level: "重点" | "一般" | "提醒";
  title: string;
  evidence: string;
  location: string;
  basis: string;
  referenceSource?: string;
  referenceLocation?: string;
  weight: number;
  followUpQuestion: string;
  status: ReviewStatus;
};

export type RiskScanResult = {
  summary: {
    reviewPriority: number;
    priorityLevel: string;
    notice: string;
  };
  riskItems: RiskItem[];
};
