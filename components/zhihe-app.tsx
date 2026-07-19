"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, Check, CheckCircle2, ChevronRight, CircleHelp, Clipboard,
  CloudUpload, Download, FileCheck2, FileText, Gauge, Info, LayoutDashboard, LoaderCircle,
  LockKeyhole, Play, Printer, RefreshCw, RotateCcw, SearchCheck, ShieldCheck, Sparkles,
  Trash2, Upload, X, Zap,
} from "lucide-react";
import { demoSubmission } from "@/lib/demo-data";
import { listLocalTextbooks, removeLocalTextbook, saveLocalTextbook, type LocalTextbook } from "@/lib/browser-textbook-store";
import { searchTextbook, splitTextbookText } from "@/lib/textbook-search";
import type { ReviewStatus, RiskItem, RiskScanResult } from "@/lib/types";

type View = "scan" | "textbook";
type ScanResponse = RiskScanResult & {
  mode: "model" | "demo";
  storage: "none";
  checkedAt: string;
  redactionHits: { type: string; replacement: string }[];
};
type FileMeta = { name: string; size: number; type: string; pages?: number; characterCount: number; warnings: string[] };
type Book = { id: string; name: string; meta: string; local?: boolean; chunks?: LocalTextbook["chunks"] };

const checks = [
  { id: "textbook", label: "教材一致性", desc: "定位与指定教材明确冲突的陈述" },
  { id: "source", label: "来源与事实", desc: "识别无来源数据、虚构或夸大结论" },
  { id: "declaration", label: "声明一致性", desc: "对照学生AI使用声明与作品内容" },
  { id: "privacy", label: "隐私与版权", desc: "提示敏感信息、引用和授权风险" },
];

const demoBooks: Book[] = [
  { id: "book-1", name: "跨境电商平台运营（第三版）", meta: "演示教材 · 214页" },
  { id: "book-2", name: "商务数据分析基础", meta: "演示教材 · 186页" },
  { id: "book-3", name: "网络营销文案实务", meta: "演示教材 · 168页" },
];

const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ZhiheApp() {
  const [view, setView] = useState<View>("scan");
  const [mobileNav, setMobileNav] = useState(false);
  const [submission, setSubmission] = useState("");
  const [declaration, setDeclaration] = useState("仅使用AI完成部分英文术语翻译，未使用AI生成商品卖点和市场数据。");
  const [file, setFile] = useState<FileMeta | null>(null);
  const [enabledChecks, setEnabledChecks] = useState(checks.map((item) => item.id));
  const [extracting, setExtracting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [filter, setFilter] = useState("全部");
  const [reviews, setReviews] = useState<Record<string, ReviewStatus>>({});
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [books, setBooks] = useState(demoBooks);
  const [activeBook, setActiveBook] = useState("book-1");
  const [bookTest, setBookTest] = useState("平台允许所有商品在主图中直接标注最低价。");
  const [bookTestResult, setBookTestResult] = useState("");
  const [indexingBook, setIndexingBook] = useState(false);
  const [bookError, setBookError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bookInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    listLocalTextbooks()
      .then((storedBooks) => {
        if (!active) return;
        const localBooks: Book[] = storedBooks
          .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
          .map(({ id, name, meta, chunks }) => ({ id, name, meta, chunks, local: true }));
        setBooks((items) => [...localBooks, ...items]);
      })
      .catch(() => active && notify("无法读取本机教材库，当前仍可使用演示教材"));
    return () => { active = false; };
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  async function handleFile(selected?: File) {
    if (!selected) return;
    setError("");
    setResult(null);
    setExtracting(true);
    const data = new FormData();
    data.append("file", selected);
    try {
      const response = await fetch("/api/submission/extract", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "文件解析失败");
      setSubmission(payload.text);
      setFile({ name: payload.name, size: payload.size, type: payload.type, pages: payload.pages, characterCount: payload.characterCount, warnings: payload.warnings });
      notify("文件解析完成，可以开始检查");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文件解析失败");
    } finally {
      setExtracting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleFile(event.dataTransfer.files[0]);
  }

  function loadExample() {
    setSubmission(demoSubmission);
    setFile({ name: "跨境商品详情页作业_示例.txt", size: new Blob([demoSubmission]).size, type: "TXT", characterCount: demoSubmission.length, warnings: [] });
    setResult(null);
    setError("");
    notify("已载入示例作业");
  }

  function clearWorkspace() {
    setSubmission("");
    setFile(null);
    setResult(null);
    setError("");
    setReviews({});
  }

  async function scan() {
    if (!submission.trim()) return setError("请先上传文件或载入示例作业");
    if (!enabledChecks.length) return setError("请至少选择一个检查维度");
    setError("");
    setScanning(true);
    setResult(null);
    try {
      const selectedBook = books.find((book) => book.id === activeBook);
      const textbookEvidence = enabledChecks.includes("textbook") && selectedBook?.chunks?.length
        ? searchTextbook({ name: selectedBook.name, chunks: selectedBook.chunks }, submission)
        : enabledChecks.includes("textbook")
          ? [{ source: "跨境电商平台运营（第三版）", location: "第4章第2节（演示）", rule: "商品主图不得直接展示价格或无法验证的促销承诺。" }]
          : [];
      const response = await fetch("/api/risk-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission,
          declaration,
          enabledChecks,
          task: "依据课程任务完成作品，并说明数据、素材和AI辅助范围。",
          aiPolicy: "可用于术语解释、思路启发和语言润色；不得虚构数据、替代核心分析或上传敏感信息。",
          textbookEvidence,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "检查失败");
      setResult(payload);
      setReviews(Object.fromEntries(payload.riskItems.map((item: RiskItem) => [item.id, item.status])));
      window.setTimeout(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "检查失败，请稍后重试");
    } finally {
      setScanning(false);
    }
  }

  const visibleRisks = useMemo(() => result?.riskItems.filter((item) => filter === "全部" || item.level === filter) || [], [result, filter]);
  const questions = result?.riskItems.map((item) => item.followUpQuestion).filter(Boolean) || [];

  function exportReport() {
    if (!result) return;
    const payload = { file: file?.name || "粘贴文本", result, teacherReviews: reviews };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `AI风险提示单-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    notify("风险提示单已导出");
  }

  async function copySummary() {
    if (!result) return;
    await navigator.clipboard.writeText(`复核优先级：${result.summary.reviewPriority}/100\n风险线索：${result.riskItems.length}项\n提示：${result.summary.notice}`);
    notify("报告摘要已复制");
  }

  async function addDemoBook(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setBookError("");
    setIndexingBook(true);
    const id = `book-${Date.now()}`;
    try {
      const form = new FormData();
      form.append("file", selected);
      const response = await fetch("/api/submission/extract", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "教材解析失败");
      const chunks = splitTextbookText(payload.text);
      if (!chunks.length) throw new Error("教材没有可用于检索的文本");
      const textbook: LocalTextbook = {
        id,
        name: payload.name,
        meta: `本机教材 · ${formatSize(payload.size)} · ${chunks.length}段`,
        size: payload.size,
        type: payload.type,
        addedAt: new Date().toISOString(),
        file: selected,
        text: payload.text,
        chunks,
        pages: payload.pages,
        characterCount: payload.characterCount,
        warnings: payload.warnings,
      };
      await saveLocalTextbook(textbook);
      setBooks((items) => [{ id, name: textbook.name, meta: textbook.meta, chunks: textbook.chunks, local: true }, ...items]);
      setActiveBook(id);
      notify("教材已解析并保存到当前浏览器");
    } catch (reason) {
      setBookError(reason instanceof Error ? reason.message : "教材保存失败，请检查浏览器存储空间");
    } finally {
      setIndexingBook(false);
      event.target.value = "";
    }
  }

  function removeBook(book: Book) {
    setBooks((items) => items.filter((item) => item.id !== book.id));
    if (activeBook === book.id) setActiveBook("");
    if (!book.local) {
      notify("教材已从演示库移除");
      return;
    }
    removeLocalTextbook(book.id)
      .then(() => notify("教材已从当前浏览器删除"))
      .catch(() => notify("教材列表已更新，但本机副本删除失败"));
  }

  function runBookTest() {
    if (!bookTest.trim()) return setBookTestResult("请输入需要核对的陈述。");
    const selectedBook = books.find((book) => book.id === activeBook);
    if (selectedBook?.chunks?.length) {
      const evidence = searchTextbook({ name: selectedBook.name, chunks: selectedBook.chunks }, bookTest);
      return setBookTestResult(evidence.length
        ? `找到 ${evidence.length} 段本机教材依据：${evidence.map((item) => `${item.location}「${item.rule}」`).join("；")}`
        : "未在当前教材全文中找到直接匹配的段落。请调整陈述关键词，或由教师结合原文进一步核验。");
    }
    const conflict = /最低价|保证第一|百分之百|允许所有/.test(bookTest);
    setBookTestResult(conflict ? "发现演示冲突：该陈述与教材示例规则不一致，建议教师核实平台依据。此结果不能证明内容由AI生成。" : "未发现与演示教材的直接冲突；真实系统需基于教材检索证据后再判断。" );
  }

  const nav = [
    { id: "scan" as View, label: "风险检查", icon: SearchCheck },
    { id: "textbook" as View, label: "教材演示库", icon: BookOpen },
  ];

  return (
    <div className="app-shell">
      <aside className={mobileNav ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><div className="brand-mark"><ShieldCheck /></div><div><strong>智核</strong><span>AI TEACHING RISK REVIEW</span></div></div>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="关闭导航"><X /></button>
        <div className="side-label">工作台</div>
        <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => { setView(id); setMobileNav(false); }}><Icon /><span>{label}</span><ChevronRight /></button>)}</nav>
        <div className="side-boundary"><LockKeyhole /><div><strong>核验边界</strong><p>只提示风险线索，不输出“AI率”，不自动作出处罚结论。</p></div></div>
        <div className="side-footer"><span className="status-dot" />本地会话 · 不保存原文</div>
      </aside>
      {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)}><LayoutDashboard /> 菜单</button>
          <div className="crumb">教学AI治理 <ChevronRight /> <strong>{nav.find((item) => item.id === view)?.label}</strong></div>
          <div className="api-pill"><span className="status-dot" />AI辅助核查 · 原文不留存</div>
        </header>

        {view === "scan" && <section className="page scan-page">
          <div className="hero-row"><div><span className="eyebrow"><Sparkles /> 人工智能辅助教师复核</span><h1>人工智能使用风险核查</h1><p>用人工智能辅助核查学生人工智能使用风险：对照教材、来源、使用声明与隐私版权线索，最后由教师复核定案。</p></div><div className="hero-badge"><Gauge /><div><strong>AI辅助，教师定案</strong><span>不计算“AI率”，不自动判定作弊或处罚</span></div></div></div>

          <div className="workspace-grid">
            <div className="panel upload-panel">
              <div className="panel-head"><div><span>01</span><div><h2>导入学生作业</h2><p>文件只用于本次检查，不写入数据库</p></div></div><button className="text-button" onClick={clearWorkspace}><RotateCcw /> 清空</button></div>
              {!file ? <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}>
                {extracting ? <><LoaderCircle className="spin upload-icon" /><h3>正在安全解析文件</h3><p>提取文字后即可进入检查流程</p></> : <><div className="upload-orb"><CloudUpload /></div><h3>拖放文件到这里，或点击选择</h3><p>支持 PDF、DOCX、TXT、MD、CSV、JSON，单文件不超过 5MB</p><button className="secondary-button" type="button" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}><Upload /> 选择文件</button></>}
              </div> : <div className="file-ready"><div className="file-icon"><FileText /></div><div className="file-info"><strong>{file.name}</strong><span>{file.type} · {formatSize(file.size)}{file.pages ? ` · ${file.pages}页` : ""} · {file.characterCount.toLocaleString()}字符</span>{file.warnings.map((item) => <small key={item}><AlertTriangle /> {item}</small>)}</div><div className="file-actions"><button onClick={() => inputRef.current?.click()} title="替换文件"><RefreshCw /></button><button onClick={clearWorkspace} title="移除文件"><Trash2 /></button></div></div>}
              <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={(e) => handleFile(e.target.files?.[0])} />
              <div className="divider"><span>或</span></div>
              <button className="example-button" onClick={loadExample}><Play /> 载入可检查的示例作业 <ChevronRight /></button>
              <label className="field-label" htmlFor="submission">提取内容预览 <span>可直接修改</span></label>
              <textarea id="submission" className="submission-text" value={submission} onChange={(e) => { setSubmission(e.target.value); setResult(null); }} placeholder="上传文件后将在此显示提取的文字，也可以直接粘贴作业内容……" />
            </div>

            <div className="panel config-panel">
              <div className="panel-head"><div><span>02</span><div><h2>设置检查范围</h2><p>所有结论均需教师复核</p></div></div></div>
              <div className="check-list">{checks.map((item) => { const active = enabledChecks.includes(item.id); return <button key={item.id} className={active ? "check-item selected" : "check-item"} onClick={() => setEnabledChecks((current) => active ? current.filter((id) => id !== item.id) : [...current, item.id])}><span className="checkbox">{active && <Check />}</span><div><strong>{item.label}</strong><small>{item.desc}</small></div></button>; })}</div>
              <label className="field-label" htmlFor="declaration">学生AI使用声明 <span>选填</span></label>
              <textarea id="declaration" className="declaration-text" value={declaration} onChange={(e) => setDeclaration(e.target.value)} placeholder="例如：使用AI进行术语翻译和语言润色……" />
              <div className="privacy-note"><ShieldCheck /><span>检查前自动遮蔽手机号、邮箱、身份证号和订单号；接口密钥仅在服务端使用。</span></div>
              {error && <div className="error-message"><AlertTriangle />{error}</div>}
              <button className="primary-button scan-button" onClick={scan} disabled={scanning || extracting || !submission.trim()}>{scanning ? <><LoaderCircle className="spin" />正在生成风险提示单</> : <><Zap />开始风险检查</>}</button>
              <p className="button-caption">提交即表示已确认文件不含不应处理的真实敏感资料</p>
            </div>
          </div>

          {scanning && <div className="scan-progress"><div className="scan-beam" /><div className="progress-copy"><div className="progress-icon"><SearchCheck /></div><div><strong>正在核验作品中的风险线索</strong><span>提取证据 → 对照规则 → 生成教师追问</span></div></div><div className="progress-steps"><span className="done"><Check />文字脱敏</span><span className="active"><LoaderCircle className="spin" />风险分析</span><span>教师提示单</span></div></div>}

          {result && <div id="report" className="report-section">
            <div className="report-top"><div><span className="eyebrow"><FileCheck2 /> AI辅助风险提示单</span><h2>教师复核报告</h2><p>{file?.name || "粘贴文本"} · {new Date(result.checkedAt).toLocaleString("zh-CN")}</p></div><div className="report-actions"><button onClick={copySummary}><Clipboard />复制摘要</button><button onClick={() => window.print()}><Printer />打印</button><button className="dark-button" onClick={exportReport}><Download />导出JSON</button></div></div>
            {result.mode === "demo" && <div className="demo-banner"><Info /><span><strong>当前使用演示结果。</strong> 配置 MODEL_API_URL、MODEL_API_KEY、MODEL_NAME 后会自动调用真实模型。</span></div>}
            <div className="report-summary"><div className="score-ring" style={{ "--score": `${result.summary.reviewPriority * 3.6}deg` } as React.CSSProperties}><div><strong>{result.summary.reviewPriority}</strong><span>/ 100</span></div></div><div className="score-copy"><span>教师复核优先级</span><h3>{result.summary.priorityLevel}</h3><p>{result.summary.notice}</p></div><div className="summary-stats"><div><strong>{result.riskItems.length}</strong><span>风险线索</span></div><div><strong>{result.redactionHits.length}</strong><span>脱敏项目</span></div><div><strong>{Object.values(reviews).filter((s) => s !== "待复核").length}</strong><span>已复核</span></div></div></div>
            <div className="risk-toolbar"><div><h3>风险线索</h3><span>点击状态完成教师判断</span></div><div className="filters">{["全部", "重点", "一般", "提醒"].map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item}{item !== "全部" && ` ${result.riskItems.filter((risk) => risk.level === item).length}`}</button>)}</div></div>
            <div className="risk-list">{visibleRisks.map((item, index) => <article className={`risk-card level-${item.level}`} key={item.id}><div className="risk-index">{String(index + 1).padStart(2, "0")}</div><div className="risk-body"><div className="risk-title"><span className="level-chip">{item.level}</span><span className="type-chip">{item.type}</span><h4>{item.title}</h4><span className="weight">权重 {item.weight}</span></div><blockquote>“{item.evidence}”<small>{item.location}</small></blockquote><div className="basis"><strong>核验依据</strong><p>{item.basis}</p>{item.referenceSource && <span><BookOpen />{item.referenceSource} · {item.referenceLocation}</span>}</div><div className="follow-up"><CircleHelp /><div><strong>建议追问</strong><p>{item.followUpQuestion}</p></div></div><div className="review-row"><span>教师判断</span>{(["确认风险", "不构成风险", "需学生说明"] as ReviewStatus[]).map((status) => <button key={status} className={reviews[item.id] === status ? "selected" : ""} onClick={() => setReviews((current) => ({ ...current, [item.id]: status }))}>{reviews[item.id] === status && <Check />}{status}</button>)}</div></div></article>)}</div>
            <div className="report-footer"><div><ShieldCheck /><p><strong>系统结论不是处罚依据</strong><span>请结合过程材料、版本记录和学生答辩作出最终判断。</span></p></div><div><button onClick={() => setQuestionsOpen(true)}><Sparkles />生成答辩问题</button><button onClick={scan}><RefreshCw />重新检查</button></div></div>
          </div>}
        </section>}

        {view === "textbook" && <section className="page"><PageHeading eyebrow="本机教材库" title="教材一致性证据库" description="教材正文在当前浏览器分段保存，并在风险检查前进行本地关键词检索。" />
          <div className="demo-notice"><Info /><div><strong>教材仅保存到当前浏览器</strong><p>导入时会临时解析文件，再将教材文件、正文和分段索引保存到本机浏览器的 IndexedDB。刷新后仍可检索，删除教材会清除本机副本。教材不会在服务器持久化，作业原文也不会保存。</p></div></div>
          <div className="book-grid"><div className="panel book-list-panel"><div className="panel-title-row"><div><h2>教材列表</h2><p>选择风险检查时使用的课程依据</p></div><button className="secondary-button compact" onClick={() => bookInputRef.current?.click()} disabled={indexingBook}>{indexingBook ? <LoaderCircle className="spin" /> : <Upload />}{indexingBook ? "解析教材中" : "导入教材"}</button><input ref={bookInputRef} className="sr-only" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={addDemoBook} /></div>{bookError && <div className="error-message"><AlertTriangle />{bookError}</div>}<div className="books">{books.map((book) => <div className={activeBook === book.id ? "book-row selected" : "book-row"} key={book.id} onClick={() => setActiveBook(book.id)} role="button" tabIndex={0}><div className="book-cover"><BookOpen /></div><div><strong>{book.name}</strong><span>{book.meta}</span></div><span className="indexed"><CheckCircle2 />{book.chunks?.length ? "已解析" : "演示"}</span><button className="icon-button" onClick={(e) => { e.stopPropagation(); removeBook(book); }} title="删除"><Trash2 /></button></div>)}</div></div>
          <div className="panel book-test-panel"><span className="eyebrow"><SearchCheck />一致性试查</span><h2>验证教材核验交互</h2><p>输入一条学生作品中的陈述，系统演示如何返回“原文证据 + 教材依据 + 边界说明”。</p><label className="field-label" htmlFor="book-test">待核对陈述</label><textarea id="book-test" value={bookTest} onChange={(e) => { setBookTest(e.target.value); setBookTestResult(""); }} /><button className="primary-button" onClick={runBookTest}><SearchCheck />对照当前教材</button>{bookTestResult && <div className="book-result"><AlertTriangle /><p>{bookTestResult}</p></div>}</div></div>
        </section>}

      </main>

      {questionsOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="答辩问题"><button className="modal-backdrop" onClick={() => setQuestionsOpen(false)} aria-label="关闭" /><div className="modal"><div className="modal-head"><div><span className="eyebrow"><Sparkles />个性化答辩</span><h2>建议随机抽问 2—3 题</h2></div><button onClick={() => setQuestionsOpen(false)}><X /></button></div><p className="modal-intro">问题由本次作品风险线索生成，用于确认学生的选择依据、数据来源和修改过程。</p><div className="question-list">{questions.map((question, index) => <div key={question}><span>{String(index + 1).padStart(2, "0")}</span><p>{question}</p><button onClick={() => navigator.clipboard.writeText(question).then(() => notify("问题已复制"))}><Clipboard /></button></div>)}</div><div className="modal-actions"><button onClick={() => setQuestionsOpen(false)}>完成</button><button className="dark-button" onClick={() => navigator.clipboard.writeText(questions.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(() => notify("全部问题已复制"))}><Clipboard />复制全部</button></div></div></div>}
      {toast && <div className="toast"><CheckCircle2 />{toast}</div>}
    </div>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><span className="eyebrow"><Sparkles />{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}
