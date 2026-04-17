function normalizeUnicodeNFKC(s) {
  // WeChat JSCore supports String.prototype.normalize on modern base libs,
  // but guard for safety.
  try {
    return s.normalize('NFKC');
  } catch (e) {
    return s;
  }
}

function unifyPunctuation(s) {
  return s
    // dots/bullets to middle dot
    .replace(/[•‧]/g, '·')
    // various dashes to hyphen
    .replace(/[‐‑‒–—―]/g, '-')
    // CJK quotes to ASCII
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function compressWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function removeLatinDots(s) {
  // Remove '.' when it is used inside latin abbreviations.
  // Keeps dots in numbers (e.g. 3.14) and in non-latin contexts reasonably.
  return s.replace(/([a-z])\.(?=[a-z])/gi, '$1').replace(/\.(?=\s|$)/g, '');
}

function latinToLower(s) {
  return s.replace(/[A-Z]/g, c => c.toLowerCase());
}

export function normalizeAuthorName(input) {
  const raw = String(input ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let s = normalizeUnicodeNFKC(trimmed);
  s = unifyPunctuation(s);
  s = compressWhitespace(s);
  s = latinToLower(s);
  s = removeLatinDots(s);
  s = compressWhitespace(s);

  // length guard
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}

export function buildAuthorTokens(nameNorm) {
  const s = normalizeAuthorName(nameNorm);
  if (!s) return [];
  const parts = s.split(/[ \-·/]+/g).map(x => x.trim()).filter(Boolean);
  // dedupe while keeping order
  const seen = new Set();
  const tokens = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    tokens.push(p);
  }
  return tokens.slice(0, 20);
}

