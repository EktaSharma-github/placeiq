/*
 * Shared building blocks for the PlaceIQ Word documents (docx npm package).
 * A4, 1-inch margins, Calibri body, indigo headings, page X of Y footer.
 */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType,
  ShadingType, BorderStyle, ImageRun, TableOfContents, Header, Footer, PageNumber, LevelFormat, PageBreak,
  TableLayoutType, VerticalAlign,
} = require("docx");

const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.resolve(ROOT, "..");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const TEAM = ["Ekta Sharma", "[Member 2]", "[Member 3]", "[Member 4]"];
const SEG = ["Problem & EER", "Schema, normalization & DDL", "SQL queries & rules", "Analytics & performance"];

const COLOR = { indigo: "4F46E5", indigoDark: "312E81", ink: "1F2937", body: "374151", muted: "6B7280",
  soft: "F3F4F8", line: "D1D5DB", amberSoft: "FFF4E6", amber: "C2410C", tealSoft: "E6F6F3", teal: "0F766E",
  redSoft: "FDECEA", red: "B91C1C", codeBg: "F1F5F9" };
const PAGE_W = 9026; // A4 width minus two 1-inch margins, in DXA

// ------------------------------------------------------------ inline text
function runs(text, base = {}) {
  const out = [];
  String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith("**")) out.push(new TextRun({ ...base, text: part.slice(2, -2), bold: true }));
    else if (part.startsWith("`")) out.push(new TextRun({ ...base, text: part.slice(1, -1), font: "Consolas", size: (base.size || 22) - 2, color: "1E1B4B" }));
    else out.push(new TextRun({ ...base, text: part }));
  });
  return out;
}

const P = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run || {}), spacing: { after: 120, line: 276 }, alignment: opts.align, keepNext: opts.keepNext });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)], pageBreakBefore: true });
const H1n = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)], keepNext: true });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)], keepNext: true });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)], keepNext: true });
const bullets = (items, level = 0) => items.map((t) => new Paragraph({ numbering: { reference: "bullets", level }, children: runs(t), spacing: { after: 60, line: 264 } }));
let numberedSeq = 0;
const numbered = (items) => { const ref = `num${numberedSeq++ % 20}`; return items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 60, line: 264 } })); };
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
const spacer = (after = 120) => new Paragraph({ children: [], spacing: { after } });

// ------------------------------------------------------------ tables
function cell(content, width, { header = false, fill, bold = false, size = 19, align } = {}) {
  const paras = String(content ?? "").split("\n").map((line) => new Paragraph({
    children: runs(line, { size, bold: header || bold, color: header ? "FFFFFF" : COLOR.body }),
    spacing: { after: 0, line: 252 }, alignment: align,
  }));
  return new TableCell({
    children: paras, width: { size: width, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: header ? COLOR.indigo : (fill || "FFFFFF") },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function table(headers, rows, fractions, { size = 19, zebra = true, headerFill } = {}) {
  const total = fractions.reduce((a, b) => a + b, 0);
  const widths = fractions.map((f) => Math.floor((f / total) * PAGE_W));
  widths[widths.length - 1] += PAGE_W - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: COLOR.line };
  const trs = [];
  if (headers) trs.push(new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { header: true, size })) }));
  rows.forEach((r, ri) => trs.push(new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], { size, fill: zebra && ri % 2 ? COLOR.soft : "FFFFFF" })) })));
  return new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: trs,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } });
}

// ------------------------------------------------------------ callout & code
function callout(title, lines, { fill = COLOR.amberSoft, color = COLOR.amber } = {}) {
  const children = [];
  if (title) children.push(new Paragraph({ children: [new TextRun({ text: title, bold: true, color, size: 22 })], spacing: { after: 60 } }));
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => children.push(new Paragraph({ children: runs(l, { size: 21 }), spacing: { after: 60, line: 264 } })));
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: [PAGE_W], layout: TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({ children, width: { size: PAGE_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: "auto", fill }, margins: { top: 140, bottom: 100, left: 200, right: 200 } })] })] });
}

function code(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const paras = lines.map((l) => new Paragraph({ children: [new TextRun({ text: l || " ", font: "Consolas", size: 17, color: "0F172A" })], spacing: { after: 0, line: 240 } }));
  return new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: [PAGE_W], layout: TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({ children: [new TableCell({ children: paras, width: { size: PAGE_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.codeBg }, margins: { top: 120, bottom: 120, left: 180, right: 180 } })] })] });
}

// ------------------------------------------------------------ figures
function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), buf };
}
let figNo = 0;
function figure(file, caption, widthIn = 6.27) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const { w, h, buf } = pngSize(abs);
  const width = Math.round(widthIn * 96), height = Math.round((width * h) / w);
  figNo += 1;
  return [
    new Paragraph({ children: [new ImageRun({ type: "png", data: buf, transformation: { width, height } })], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true }),
    new Paragraph({ children: [new TextRun({ text: `Figure ${figNo}. `, bold: true, size: 18, color: COLOR.muted }), new TextRun({ text: caption, italics: true, size: 18, color: COLOR.muted })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
  ];
}
let tabNo = 0;
const tcap = (caption) => { tabNo += 1; return new Paragraph({ children: [new TextRun({ text: `Table ${tabNo}. `, bold: true, size: 18, color: COLOR.muted }), new TextRun({ text: caption, italics: true, size: 18, color: COLOR.muted })], spacing: { before: 160, after: 80 }, keepNext: true }); };

// ------------------------------------------------------------ cover & document
function cover({ title, subtitle, kind, extra = [] }) {
  const big = (t, size, color, opts = {}) => new Paragraph({ children: [new TextRun({ text: t, size, color, bold: opts.bold, font: opts.font })], spacing: { after: opts.after ?? 120 }, alignment: AlignmentType.LEFT });
  const team = table(["Member", "Name", "Presentation segment"], TEAM.map((n, i) => [`M${i + 1}`, n, SEG[i]]), [1, 3, 4]);
  return [
    spacer(1400),
    big(kind.toUpperCase(), 22, COLOR.amber, { bold: true, after: 200 }),
    big(title, 64, COLOR.indigoDark, { bold: true, font: "Cambria", after: 160 }),
    big(subtitle, 30, COLOR.body, { after: 600 }),
    big("Fundamentals of Database Systems (FDS)", 24, COLOR.ink, { bold: true, after: 60 }),
    big("Prof. Debapriyay Mukhopadhyay  ·  PGDBA Batch 12, IIM Calcutta", 22, COLOR.muted, { after: 400 }),
    team,
    spacer(300),
    ...extra,
    big("November 2026  ·  github.com/EktaSharma-github/placeiq", 20, COLOR.muted, { after: 0 }),
    pageBreak(),
  ];
}

const toc = () => [
  new Paragraph({ children: [new TextRun({ text: "Contents", bold: true, size: 32, color: COLOR.indigoDark, font: "Cambria" })], spacing: { after: 200 } }),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new TextRun({ text: "(If page numbers are missing, right-click the table and choose Update Field.)", italics: true, size: 16, color: COLOR.muted })] }),
];

function build(file, docTitle, children) {
  const numberingConfigs = [{ reference: "bullets", levels: [
    { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
    { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 270 } } } }] }];
  for (let i = 0; i < 20; i++) numberingConfigs.push({ reference: `num${i}`, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] });

  const doc = new Document({
    creator: TEAM.join(", "), title: docTitle, description: "PlaceIQ: FDS course project",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: COLOR.body } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: "Cambria", size: 36, bold: true, color: COLOR.indigoDark }, paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: "Calibri", size: 27, bold: true, color: COLOR.indigo }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: "Calibri", size: 23, bold: true, color: COLOR.ink }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: numberingConfigs },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `PlaceIQ  ·  ${docTitle}`, size: 16, color: COLOR.muted })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: COLOR.muted })] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(path.join(ROOT, file), buf); console.log("wrote", file); });
}

module.exports = { D, TEAM, SEG, COLOR, ROOT, PROJECT, P, H1, H1n, H2, H3, bullets, numbered, pageBreak, spacer, table, tcap,
  callout, code, figure, cover, toc, build, runs };
