/**
 * Score how relevant a transcript is to a search query
 */
export function scoreRelevance(video, query) {
  if (!query) return 0;
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  let score = 0;

  const title = (video.title || '').toLowerCase();
  const text = (video.transcript || '').toLowerCase();
  const desc = (video.description || '').toLowerCase();

  for (const term of terms) {
    // Title matches worth 5x
    if (title.includes(term)) score += 5;
    // Description matches worth 2x
    if (desc.includes(term)) score += 2;
    // Count occurrences in transcript
    const regex = new RegExp(term, 'gi');
    const matches = text.match(regex);
    if (matches) score += Math.min(matches.length, 20); // Cap at 20
  }

  // Bonus for exact phrase in transcript
  if (text.includes(query.toLowerCase())) score += 15;
  // Bonus for exact phrase in title
  if (title.includes(query.toLowerCase())) score += 25;

  return score;
}

/**
 * Extract the most relevant excerpt from a transcript
 */
export function extractExcerpt(text, query, maxLen = 350) {
  if (!text) return '';
  if (!query) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');

  const lower = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  // Find the position with the highest density of search terms
  let bestPos = 0;
  let bestScore = 0;
  const step = 30;

  for (let i = 0; i < lower.length - 100; i += step) {
    const window = lower.slice(i, i + maxLen);
    let s = 0;
    for (const term of terms) {
      const matches = window.match(new RegExp(term, 'gi'));
      if (matches) s += matches.length;
    }
    if (s > bestScore) {
      bestScore = s;
      bestPos = i;
    }
  }

  // Try to start at a word boundary
  const start = Math.max(0, text.lastIndexOf(' ', bestPos) + 1);
  let excerpt = text.slice(start, start + maxLen);

  // End at a word boundary
  const lastSpace = excerpt.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.7) excerpt = excerpt.slice(0, lastSpace);

  const prefix = start > 0 ? '...' : '';
  const suffix = start + maxLen < text.length ? '...' : '';

  return prefix + excerpt + suffix;
}

/**
 * Highlight search terms in text — returns array of {text, highlight} objects
 */
export function highlightTerms(text, query) {
  if (!text || !query) return [{ text, highlight: false }];
  
  const terms = query.split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return [{ text, highlight: false }];

  const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);

  return parts.map(part => ({
    text: part,
    highlight: regex.test(part) || terms.some(t => part.toLowerCase() === t.toLowerCase()),
  }));
}

/**
 * Format view count
 */
export function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}

/**
 * Format date for display
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
