import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智核｜AI教学风险核验平台",
  description: "生成式人工智能规范使用、过程核验与学生AI素养提升平台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
