import type { LocalTextbook, TextbookChunk } from "@/lib/browser-textbook-store";

export type TextbookEvidence = {
  source: string;
  location: string;
  rule: string;
};

const MAX_CHUNK_LENGTH = 900;
const MAX_EVIDENCE = 4;

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function splitTextbookText(text: string): TextbookChunk[] {
  const paragraphs = text
    .split(/\n{2,}|(?<=[。！？!?])\s+/)
    .map(cleanText)
    .filter(Boolean);
  const chunks: TextbookChunk[] = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 1 > MAX_CHUNK_LENGTH) {
      chunks.push({ id: `chunk-${chunks.length + 1}`, location: `第${chunks.length + 1}段`, text: buffer });
      buffer = "";
    }
    if (paragraph.length > MAX_CHUNK_LENGTH) {
      for (let start = 0; start < paragraph.length; start += MAX_CHUNK_LENGTH) {
        const part = paragraph.slice(start, start + MAX_CHUNK_LENGTH);
        chunks.push({ id: `chunk-${chunks.length + 1}`, location: `第${chunks.length + 1}段`, text: part });
      }
      continue;
    }
    buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
  }
  if (buffer) chunks.push({ id: `chunk-${chunks.length + 1}`, location: `第${chunks.length + 1}段`, text: buffer });
  return chunks;
}

function getSearchTerms(text: string) {
  const chineseTerms = text.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  const latinTerms = text.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return [...new Set([...chineseTerms, ...latinTerms])].slice(0, 120);
}

export function searchTextbook(textbook: Pick<LocalTextbook, "name" | "chunks">, query: string): TextbookEvidence[] {
  const terms = getSearchTerms(query);
  if (!terms.length || !textbook.chunks.length) return [];

  return textbook.chunks
    .map((chunk) => {
      const haystack = chunk.text.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term.toLowerCase()) ? term.length : 0), 0);
      return { chunk, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EVIDENCE)
    .map(({ chunk }) => ({
      source: textbook.name,
      location: chunk.location,
      rule: chunk.text.slice(0, 500),
    }));
}
