export function toCamelCase(inputString) {
  if (!inputString) return null;

  const original = inputString.trim().replace(/\s+/g, " ");

  // Helper: title-case a single token, but keep all-caps acronyms as-is
  const titleCaseToken = (token) => {
    // Keep acronyms like UNIS, API, HR (2+ letters, all caps)
    if (/^[A-Z]{2,}$/.test(token)) return token;

    // Otherwise normal Title Case
    const lower = token.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  // 1) Normalize spaces around dots (initials)
  let s = original.replace(/\s*\.\s*/g, ".");

  // 2) Fix initials blocks while preserving original letters:
  // "R. M." -> "R.M.", "r.m." -> "R.M.", "A.r.nasar" -> "A.R.Nasar"
  // We'll do this on a lowercase copy for safety, then re-apply casing rules later.
  s = s.toLowerCase();

  // Uppercase sequences like "r.m." "a.r." etc.
  s = s.replace(/\b(?:[a-z]\.)+(?=[a-z])/g, (m) => m.toUpperCase());

  // Add a space if initials got glued to next word: "R.M.Salman" -> "R.M. Salman"
  s = s.replace(/(\b(?:[A-Z]\.)+)(?=[a-z])/g, "$1 ");

  // 3) Now rebuild word-by-word, preserving acronyms from the ORIGINAL input
  const originalTokens = original.split(" ");
  const processedTokens = s.split(" ");

  const out = processedTokens.map((tok, i) => {
    // Keep acronyms exactly as user typed if that original token was all-caps
    const origTok = originalTokens[i] ?? "";
    if (/^[A-Z]{2,}$/.test(origTok)) return origTok;

    // Also keep initials like "R.M." as-is
    if (/^(?:[A-Z]\.)+$/.test(tok)) return tok;

    // Title case normal tokens
    return titleCaseToken(tok);
  });

  return out.join(" ");
}
