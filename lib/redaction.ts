export type RedactionHit = { type: string; value: string; replacement: string };

const rules = [
  { type: "手机号", regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g, replacement: "[联系方式]" },
  { type: "邮箱", regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: "[邮箱]" },
  { type: "身份证号", regex: /(?<!\d)\d{17}[\dXx](?!\d)/g, replacement: "[身份证号]" },
  { type: "订单号", regex: /(?:订单号|order\s*id)[:：\s]*[A-Z0-9-]{6,}/gi, replacement: "订单号：[订单编号]" },
];

export function redactSensitiveText(text: string) {
  const hits: RedactionHit[] = [];
  let redacted = text;
  for (const rule of rules) {
    redacted = redacted.replace(rule.regex, (value) => {
      hits.push({ type: rule.type, value, replacement: rule.replacement });
      return rule.replacement;
    });
  }
  return { redacted, hits };
}
