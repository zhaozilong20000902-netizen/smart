import { z } from "zod";

export const riskScanSchema = z.object({
  summary: z.object({
    reviewPriority: z.number().min(0).max(100),
    priorityLevel: z.string().min(1),
    notice: z.string().min(1),
  }),
  riskItems: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    level: z.enum(["重点", "一般", "提醒"]),
    title: z.string().min(1),
    evidence: z.string().min(1),
    location: z.string().min(1),
    basis: z.string().min(1),
    referenceSource: z.string().optional(),
    referenceLocation: z.string().optional(),
    weight: z.number().min(0).max(100),
    followUpQuestion: z.string().min(1),
    status: z.enum(["待复核", "确认风险", "不构成风险", "需学生说明"]),
  })).max(20),
});
