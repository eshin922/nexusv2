/**
 * Extract readable text from a react-pdf document.
 *
 * The naive approach — inflate the streams and read `(literal) Tj` — returns
 * NOTHING here, and returning nothing looks exactly like "the document is
 * empty". react-pdf embeds SUBSET fonts, so its text operators carry glyph
 * ids, not characters:
 *
 *     [<0001> -49.23 <0002> -49.23 <0001>] TJ
 *
 * Those ids are meaningful only through the font's `/ToUnicode` CMap, and the
 * mapping is PER FONT: glyph 1 is a different character in each subset. So the
 * extractor tracks the current font across `Tf` operators and decodes each
 * string with that font's own table. A single merged table would silently
 * mistranslate wherever two subsets disagree, which is worse than failing.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function inflate(buf) {
  try {
    return inflateSync(buf);
  } catch {
    return null;
  }
}

/** Every `N 0 obj … endobj`, by object number. */
function objects(bytes) {
  const latin = bytes.toString("latin1");
  const map = new Map();
  for (const m of latin.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    const body = m[2];
    let stream = null;
    const s = body.indexOf("stream");
    if (s !== -1) {
      let start = m.index + m[1].length + 6 + 1 + s + 6;
      // recompute precisely against the byte buffer
      const abs = latin.indexOf("stream", m.index) + 6;
      let b = abs;
      if (bytes[b] === 0x0d) b++;
      if (bytes[b] === 0x0a) b++;
      const e = latin.indexOf("endstream", b);
      stream = e === -1 ? null : bytes.subarray(b, e);
      void start;
    }
    map.set(Number(m[1]), { dict: body.split("stream")[0], stream });
  }
  return map;
}

/** Parse a ToUnicode CMap into glyph-code -> string. */
function parseToUnicode(text) {
  const map = new Map();
  const hexToStr = (h) => {
    let out = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const cp = parseInt(h.slice(i, i + 4), 16);
      if (!Number.isNaN(cp) && cp !== 0) out += String.fromCharCode(cp);
    }
    return out;
  };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(p[1], 16), hexToStr(p[2]));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of blk[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      const dst = parseInt(p[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) {
        map.set(c, String.fromCharCode(dst + (c - lo)));
      }
    }
  }
  return map;
}

export function extractPdfText(path) {
  const bytes = readFileSync(path);
  const objs = objects(bytes);

  // font object -> its ToUnicode table
  const fontTables = new Map();
  for (const [num, o] of objs) {
    const m = o.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!m) continue;
    const cmapObj = objs.get(Number(m[1]));
    if (!cmapObj?.stream) continue;
    const raw = inflate(cmapObj.stream) ?? cmapObj.stream;
    fontTables.set(num, parseToUnicode(raw.toString("latin1")));
  }

  // resource alias (/F1) -> font object, gathered from every Resources dict
  const alias = new Map();
  for (const [, o] of objs) {
    for (const f of o.dict.matchAll(/\/Font\s*<<([^>]*)>>/g)) {
      for (const p of f[1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
        alias.set(p[1], Number(p[2]));
      }
    }
  }

  const chunks = [];
  for (const [, o] of objs) {
    if (!o.stream) continue;
    const raw = inflate(o.stream);
    if (!raw) continue;
    const content = raw.toString("latin1");
    if (!content.includes("BT")) continue;

    let table = null;
    const token = /\/(\w+)\s+[\d.]+\s+Tf|\[([\s\S]*?)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*Tj|<([0-9A-Fa-f]+)>\s*Tj/g;
    for (const t of content.matchAll(token)) {
      if (t[1] !== undefined) {
        const fontObj = alias.get(t[1]);
        table = fontObj !== undefined ? fontTables.get(fontObj) ?? null : null;
        continue;
      }
      const decodeHex = (h) => {
        let s = "";
        for (let i = 0; i + 1 < h.length; i += 4) {
          const code = parseInt(h.slice(i, i + 4), 16);
          s += table?.get(code) ?? "";
        }
        return s;
      };
      if (t[2] !== undefined) {
        for (const p of t[2].matchAll(/<([0-9A-Fa-f]+)>|\(((?:\\.|[^\\()])*)\)/g)) {
          chunks.push(p[1] !== undefined ? decodeHex(p[1]) : p[2].replace(/\\([()\\])/g, "$1"));
        }
      } else if (t[3] !== undefined) {
        chunks.push(t[3].replace(/\\([()\\])/g, "$1"));
      } else if (t[4] !== undefined) {
        chunks.push(decodeHex(t[4]));
      }
    }
    chunks.push("\n");
  }
  return chunks.join("");
}

if (process.argv[2]) {
  const text = extractPdfText(process.argv[2]);
  process.stdout.write(text);
}
