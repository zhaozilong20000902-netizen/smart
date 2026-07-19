# 智核｜AI教学风险核验平台

面向职业院校教师的生成式人工智能教学风险核验网页。上传学生作业后，系统完成文字提取、基础脱敏、模型风险分析、教师复核和结果导出。

> 系统只输出风险线索和复核优先级，不输出“AI生成率”，不自动判断作弊，也不提供处罚结论。

## 当前版本

- 无账号、无数据库、无对象存储；学生作业原文不会被持久化。
- 支持 PDF、DOCX、TXT、MD、CSV、JSON，单文件最大 5MB。
- 支持教材一致性、事实来源、AI使用声明、隐私与版权四类检查。
- 教材文件仅保存在导入它的浏览器 IndexedDB 中，刷新或重新打开页面后仍可见；不会上传到服务器。清除浏览器站点数据或在教材库中删除后，本机副本会被移除。
- 未配置模型API时自动返回完整演示报告，便于评审和展示。
- 配置模型API后自动调用真实接口，无需修改前端代码。

## 一键部署到 EdgeOne Makers

EdgeOne Makers 官方说明支持 Next.js、动态 API 和 Cloud Functions，因此本项目可以作为完整 Next.js 项目导入，而不是上传到只支持静态文件的 Drop 页面。

1. 解压源码 ZIP，或把项目上传到 Git 仓库。
2. 在 EdgeOne Makers 新建 Web 应用并导入项目。
3. 安装命令使用 `npm install`，构建命令使用 `npm run build`。
4. 如需真实模型，在项目环境变量中填写下面三项；只做演示可跳过。
5. 发布后访问首页，即可上传文件检查。

```env
MODEL_API_URL=https://你的接口地址/v1/chat/completions
MODEL_API_KEY=你的服务端密钥
MODEL_NAME=你的模型名称
```

`MODEL_API_URL` 需要兼容 OpenAI Chat Completions 请求结构，并支持返回 JSON 内容。API 密钥只在服务端 Route Handler 中读取，不会进入浏览器代码。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

访问 `http://localhost:3000`。生产构建检查：

```bash
npm run build
```

## 核心流程

1. 用户上传文件，`/api/submission/extract` 在服务端提取文字。
2. 用户确认内容和检查范围，点击“开始风险检查”。
3. `/api/risk-scan` 先遮蔽手机号、邮箱、身份证号、订单号，再调用模型。
4. 模型按固定 JSON 结构返回可复核线索，不返回 AI 生成概率。
5. 教师逐条选择“确认风险 / 不构成风险 / 需学生说明”，并可生成答辩问题、打印或导出 JSON。

## 文件结构

```text
app/
  api/risk-scan/          模型风险检查
  api/submission/extract/ 文件文字提取
  globals.css             完整响应式界面
components/zhihe-app.tsx  风险检查、教材演示及全部交互
lib/
  prompts.ts              模型边界与输出结构
  redaction.ts            基础敏感信息遮蔽
  schema.ts               模型结果校验
```

## 上线边界

当前版本适合案例展示、小范围试用和接口联调。正式处理真实学生资料前，还应按学校要求补充数据处理告知、访问日志、接口限流、异常监控、文件恶意内容检测和保留期限策略。基础正则脱敏不能覆盖所有敏感信息，教师仍需在上传前检查材料。
