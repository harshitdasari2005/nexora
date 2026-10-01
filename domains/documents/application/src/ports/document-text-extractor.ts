/**
 * @nexora/application-documents — document text-extraction port.
 *
 * The processing seam: bytes → normalized searchable text (DOMAIN_MODEL.md
 * §14 Documents processing pipeline). The pipeline is REPLACEABLE by design
 * — a real OCR/LLM provider can swap in behind this port without touching
 * the application or domain. The default implementation handles plain text,
 * Markdown, JSON, and a MINIMAL subset of PDFs (FlateDecode streams with
 * Tj/TJ operators). When extraction produces no text the uploader sees an
 * honest `failed` processing state — indexing is never faked.
 */

import { inflateSync } from 'node:zlib';

/** Text-extraction failure (surfaced as a safe processing-failed reason). */
export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

/** The text-extraction port. */
export interface DocumentTextExtractor {
  /**
   * Extracts normalized text from the uploaded bytes.
   *
   * @throws {DocumentExtractionError} when no text can be extracted (the
   *         document transitions to `failed` — never silently skipped).
   */
  extract(contentType: string, content: Buffer): Promise<string>;
}

/** The maximum extracted-text length indexed into knowledge (safety bound). */
export const EXTRACTED_TEXT_MAX_LENGTH = 200_000;

/**
 * The default extractor: plain text/Markdown/JSON decoded as UTF-8, plus a
 * minimal PDF path (FlateDecode streams, Tj/TJ text operators). Documented
 * as replaceable by an OCR/LLM provider.
 */
export class DefaultDocumentTextExtractor implements DocumentTextExtractor {
  async extract(contentType: string, content: Buffer): Promise<string> {
    const normalized = contentType.trim().toLowerCase();
    if (normalized === 'application/pdf') {
      const pdfText = extractPdfText(content);
      if (pdfText.length === 0) {
        throw new DocumentExtractionError(
          'PDF text extraction is not available for this document — upload plain text or Markdown',
        );
      }
      return normalizeText(pdfText);
    }
    if (
      normalized === 'text/plain' ||
      normalized === 'text/markdown' ||
      normalized === 'application/json' ||
      normalized.startsWith('text/')
    ) {
      const text = content.toString('utf8').replace(/^\uFEFF/, '');
      if (text.trim().length === 0) {
        throw new DocumentExtractionError('The document contains no text');
      }
      return normalizeText(text);
    }
    throw new DocumentExtractionError(
      `Content type ${contentType} is not supported — upload plain text, Markdown, or PDF`,
    );
  }
}

/** Normalizes whitespace and bounds the extracted text. */
function normalizeText(raw: string): string {
  const collapsed = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return collapsed.length > EXTRACTED_TEXT_MAX_LENGTH
    ? collapsed.slice(0, EXTRACTED_TEXT_MAX_LENGTH)
    : collapsed;
}

/** Unescapes a PDF string literal (`\(`, `\)`, `\\`, `\n`, ...). */
function unescapePdfLiteral(value: string): string {
  return value
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * Decompression-bomb bounds. A few hundred KB of deflate can inflate to GBs and
 * `inflateSync` blocks the event loop, so each stream and the running total are
 * capped; exceeding either rejects the document (it is not silently truncated).
 */
const PDF_STREAM_INFLATED_MAX_BYTES = 2 * 1024 * 1024;
const PDF_TOTAL_INFLATED_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Minimal PDF text extraction: inflates every FlateDecode stream and
 * collects text from `(literal) Tj` operators and `[ ... ] TJ` arrays.
 * Deliberately small — a real PDF/OCR provider replaces this implementation
 * behind the port.
 */
function extractPdfText(bytes: Buffer): string {
  const source = bytes.toString('latin1');
  const parts: string[] = [];
  let offset = 0;
  let inflatedTotal = 0;

  while (offset < source.length) {
    const streamStart = source.indexOf('stream', offset);
    if (streamStart === -1) {
      break;
    }
    let dataStart = streamStart + 'stream'.length;
    if (source[dataStart] === '\r') {
      dataStart += 1;
    }
    if (source[dataStart] === '\n') {
      dataStart += 1;
    }
    const endMarker = source.indexOf('endstream', dataStart);
    if (endMarker === -1) {
      break;
    }
    const raw = Buffer.from(source.slice(dataStart, endMarker), 'latin1');
    let decoded: string | null = null;
    try {
      const inflated = inflateSync(raw, { maxOutputLength: PDF_STREAM_INFLATED_MAX_BYTES });
      inflatedTotal += inflated.length;
      decoded = inflated.toString('latin1');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new DocumentExtractionError('The PDF expands beyond the supported size');
      }
      decoded = null; // not a Flate stream (images, fonts, …) — skipped
    }
    if (inflatedTotal > PDF_TOTAL_INFLATED_MAX_BYTES) {
      throw new DocumentExtractionError('The PDF expands beyond the supported size');
    }
    if (decoded !== null) {
      // Individual text-showing operators: (literal) Tj
      for (const match of decoded.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
        parts.push(unescapePdfLiteral(match[1] ?? ''));
      }
      // Text arrays: [ (a) 12 (b) ] TJ
      for (const arrayMatch of decoded.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        const body = arrayMatch[1] ?? '';
        for (const literal of body.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) {
          parts.push(unescapePdfLiteral(literal[1] ?? ''));
        }
      }
    }
    offset = endMarker + 'endstream'.length;
  }

  return parts.join(' ');
}
