import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
const textExtensions = new Set(["txt", "md", "csv", "json"]);

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "文件不能超过5MB" }, { status: 413 });

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (![...textExtensions, "docx", "pdf"].includes(extension)) {
    return NextResponse.json({ error: "暂不支持该格式，请上传 PDF、DOCX、TXT、MD、CSV 或 JSON" }, { status: 415 });
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    let text = "";
    let pages: number | undefined;
    const warnings: string[] = [];

    if (textExtensions.has(extension)) {
      text = new TextDecoder("utf-8").decode(arrayBuffer);
    } else if (extension === "docx") {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) });
      text = result.value;
      if (result.messages.length) warnings.push("文档中部分复杂版式可能未完整提取");
    } else {
      const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text;
      pages = extracted.totalPages;
      if (!text.trim()) warnings.push("该PDF可能是扫描件，请先进行OCR后再上传");
    }

    text = text.replace(/\u0000/g, "").trim();
    if (!text) return NextResponse.json({ error: warnings[0] || "未能从文件中提取文字" }, { status: 422 });
    if (text.length > 120_000) {
      text = text.slice(0, 120_000);
      warnings.push("内容超过12万字符，已截取前12万字符用于检查");
    }

    return NextResponse.json({
      name: file.name,
      size: file.size,
      type: extension.toUpperCase(),
      text,
      pages,
      characterCount: text.length,
      warnings,
    });
  } catch (error) {
    console.error("file extraction failed", error);
    return NextResponse.json({ error: "文件解析失败，请确认文件未损坏或转换为TXT后重试" }, { status: 422 });
  }
}
