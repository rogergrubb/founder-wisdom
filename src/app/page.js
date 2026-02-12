'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { scoreRelevance, extractExcerpt, highlightTerms, formatNumber, formatDate } from '../lib/search';

export default function HomePage() {
  const [database, setDatabase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [searchMode, setSearchMode] = useState('ai'); // 'keyword' or 'ai'
  const [expandedId, setExpandedId] = useState(null);
  const [showAllVideos, setShowAllVideos] = useState(false);
  const inputRef = useRef(null);

  // Load transcript data on mount
  useEffect(() => {
    fetch('/data/transcripts.json')
      .then(r => r.json())
      .then(data => {
        setDatabase(data);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to load transcript database.');
        setLoading(false);
      });
  }, []);

  const videosWithTranscripts = database?.videos?.filter(v => v.transcriptAvailable) || [];

  // Keyword search
  const doKeywordSearch = useCallback(() => {
    if (!database || !query.trim()) return;

    const scored = videosWithTranscripts
      .map(v => ({
        ...v,
        score: scoreRelevance(v, query),
        excerpt: extractExcerpt(v.transcript, query),
      }))
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    setResults(scored);
    setSearched(true);
    setAiAnswer('');
  }, [database, query, videosWithTranscripts]);

  // AI search
  const doAiSearch = useCallback(async () => {
    if (!database || !query.trim()) return;
    setAiLoading(true);
    setAiAnswer('');
    setSearched(true);

    // Find relevant videos first
    const scored = videosWithTranscripts
      .map(v => ({
        ...v,
        score: scoreRelevance(v, query),
        excerpt: extractExcerpt(v.transcript, query),
      }))
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    setResults(scored);

    // Build context from top matches
    const topMatches = scored.slice(0, 6);
    const context = topMatches
      .map((v, i) => {
        const text = v.transcript?.slice(0, 3000) || v.excerpt;
        return `[Interview ${i + 1}: "${v.title}" — ${formatDate(v.publishedAt)}]\n${text}`;
      })
      .join('\n\n---\n\n');

    if (topMatches.length === 0) {
      setAiAnswer('No relevant interviews found for this query. Try different keywords.');
      setAiLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context }),
      });
      const data = await res.json();
      setAiAnswer(data.answer || 'No answer generated.');
    } catch (err) {
      setAiAnswer('AI search unavailable. Showing keyword results below.');
    }

    setAiLoading(false);
  }, [database, query, videosWithTranscripts]);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    if (searchMode === 'ai') doAiSearch();
    else doKeywordSearch();
  }, [searchMode, doAiSearch, doKeywordSearch, query]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  // ─── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pulse" style={{ fontSize: 48, marginBottom: 16 }}>🔥</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>Loading founder interviews...</div>
        </div>
      </div>
    );
  }

  // ─── Error / empty state ───────────────────────────────────────
  if (error || !database || videosWithTranscripts.length === 0) {
    const isPending = database?.metadata?.status === 'pending';
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 32 }}>
        <div style={{ textAlign: 'center', maxWidth: 500 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{isPending ? '⏳' : '⚠️'}</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>
            {isPending ? 'Transcripts Not Yet Collected' : 'No Transcripts Available'}
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 15 }}>
            {isPending
              ? 'The YouTube API key needs to be set. Add YOUTUBE_API_KEY as an environment variable in your Vercel project settings, then redeploy.'
              : database?.metadata?.message || error || 'Something went wrong loading the transcript database.'}
          </p>
        </div>
      </div>
    );
  }

  const meta = database.metadata;

  // ─── Main UI ───────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ─── Header ─── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(8,8,12,0.92)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔥</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', letterSpacing: 1 }}>
            FOUNDER WISDOM
          </span>
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-muted)' }}>
          <span><b style={{ color: 'var(--accent)' }}>{meta.withTranscripts}</b> interviews</span>
          <span><b style={{ color: 'var(--accent)' }}>{formatNumber(meta.totalWords)}</b> words</span>
        </div>
      </header>

      {/* ─── Hero / Search ─── */}
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 20px 0' }}>
        {!searched && (
          <div className="fade-in" style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', letterSpacing: 3, marginBottom: 12, textTransform: 'uppercase' }}>
              Starter Story × AI
            </div>
            <h1 style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.15, marginBottom: 14 }}>
              The collective wisdom of<br />
              <span style={{ color: 'var(--accent)' }}>{meta.withTranscripts} founder interviews</span>
            </h1>
            <p style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 520, margin: '0 auto' }}>
              Every Starter Story interview, transcribed and searchable.
              Ask anything — get answers backed by real founders.
            </p>
          </div>
        )}

        {/* Search bar */}
        <div style={{
          display: 'flex', background: 'var(--surface)', borderRadius: 14,
          border: '1px solid var(--border)', overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchMode === 'ai'
              ? 'Ask anything... "How do founders get their first 10 customers?"'
              : 'Search keywords... "bootstrap SaaS revenue"'}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: 'var(--text)', padding: '18px 22px', fontSize: 16,
            }}
          />
          <button
            onClick={handleSearch}
            disabled={aiLoading || !query.trim()}
            style={{
              background: aiLoading ? '#333' : 'var(--accent)',
              border: 'none', color: '#000', padding: '0 30px',
              fontSize: 15, fontWeight: 700, cursor: aiLoading ? 'wait' : 'pointer',
              transition: 'opacity 0.2s', opacity: !query.trim() ? 0.4 : 1,
            }}
          >
            {aiLoading ? '...' : 'Search'}
          </button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {['ai', 'keyword'].map(mode => (
            <button
              key={mode}
              onClick={() => setSearchMode(mode)}
              style={{
                background: searchMode === mode ? (mode === 'ai' ? 'rgba(245,158,11,0.12)' : 'rgba(136,136,160,0.12)') : 'transparent',
                border: `1px solid ${searchMode === mode ? (mode === 'ai' ? 'var(--accent)' : 'var(--text-muted)') : 'var(--border)'}`,
                color: searchMode === mode ? (mode === 'ai' ? 'var(--accent)' : 'var(--text)') : 'var(--text-muted)',
                padding: '7px 18px', borderRadius: 20, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, transition: 'all 0.2s',
              }}
            >
              {mode === 'ai' ? '🧠 AI Answer' : '⚡ Keyword'}
            </button>
          ))}

          {!searched && (
            <button
              onClick={() => setShowAllVideos(!showAllVideos)}
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-muted)', padding: '7px 18px', borderRadius: 20,
                cursor: 'pointer', fontSize: 13, marginLeft: 'auto',
              }}
            >
              {showAllVideos ? 'Hide' : 'Browse'} all interviews
            </button>
          )}
        </div>

        {/* Suggested queries */}
        {!searched && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20, justifyContent: 'center' }}>
            {[
              'How do founders get their first customers?',
              'What mistakes do first-time founders make?',
              'How to validate a business idea?',
              'Side hustle to full-time business',
              'How to price a SaaS product?',
              'Content marketing strategy',
            ].map(q => (
              <button
                key={q}
                onClick={() => { setQuery(q); setSearchMode('ai'); setTimeout(() => doAiSearch(), 100); }}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', padding: '8px 16px', borderRadius: 8,
                  cursor: 'pointer', fontSize: 13, transition: 'all 0.2s',
                }}
                onMouseOver={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--accent)'; }}
                onMouseOut={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-muted)'; }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── Results Area ─── */}
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* AI Answer */}
        {aiLoading && (
          <div className="fade-in" style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(239,68,68,0.06))',
            border: '1px solid rgba(245,158,11,0.15)', borderRadius: 14, padding: 28, marginBottom: 24,
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: 2, marginBottom: 12 }}>
              🧠 SYNTHESIZING ANSWERS FROM {results.length || '...'} INTERVIEWS
            </div>
            <div className="pulse" style={{ color: 'var(--text-muted)', fontSize: 15 }}>
              Reading through transcripts and composing answer...
            </div>
          </div>
        )}

        {aiAnswer && !aiLoading && (
          <div className="fade-in" style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(239,68,68,0.06))',
            border: '1px solid rgba(245,158,11,0.15)', borderRadius: 14, padding: 28, marginBottom: 24,
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: 2, marginBottom: 14 }}>
              🧠 AI SYNTHESIS — {results.length} INTERVIEWS ANALYZED
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.8, color: '#ccc', whiteSpace: 'pre-wrap' }}>
              {aiAnswer}
            </div>
          </div>
        )}

        {/* Result count */}
        {searched && results.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            {results.length} matching interview{results.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* No results */}
        {searched && results.length === 0 && !aiLoading && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 16 }}>No matching interviews for &ldquo;{query}&rdquo;</div>
            <div style={{ fontSize: 14, marginTop: 8 }}>Try broader terms or a different question</div>
          </div>
        )}

        {/* Video results */}
        {results.map((video, idx) => (
          <VideoCard
            key={video.id + '-' + idx}
            video={video}
            query={query}
            isExpanded={expandedId === video.id}
            onToggle={() => setExpandedId(expandedId === video.id ? null : video.id)}
            index={idx}
          />
        ))}

        {/* Browse all videos */}
        {showAllVideos && !searched && (
          <div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16, fontWeight: 500 }}>
              All {videosWithTranscripts.length} interviews
            </div>
            {videosWithTranscripts.map((video, idx) => (
              <VideoCard
                key={video.id + '-browse-' + idx}
                video={{ ...video, excerpt: video.transcript?.slice(0, 250) + '...' }}
                query=""
                isExpanded={expandedId === video.id}
                onToggle={() => setExpandedId(expandedId === video.id ? null : video.id)}
                index={idx}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Video Card Component ────────────────────────────────────────

function VideoCard({ video, query, isExpanded, onToggle, index }) {
  const excerptParts = query ? highlightTerms(video.excerpt || '', query) : [{ text: video.excerpt || '', highlight: false }];

  return (
    <div
      className="fade-in"
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 22, marginBottom: 10,
        transition: 'border-color 0.2s', cursor: 'pointer',
        animationDelay: `${index * 40}ms`, animationFillMode: 'both',
      }}
      onClick={onToggle}
      onMouseOver={e => e.currentTarget.style.borderColor = '#333'}
      onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, margin: 0 }}>
            {video.title}
          </h3>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span>📅 {formatDate(video.publishedAt || video.upload_date)}</span>
            <span>⏱ {video.durationFormatted || video.duration_formatted}</span>
            <span>👁 {formatNumber(video.viewCount || video.views)}</span>
            <span>📝 {formatNumber(video.wordCount || video.word_count)} words</span>
          </div>
        </div>
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
            color: 'var(--accent-red)', padding: '6px 14px', borderRadius: 8,
            fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          ▶ Watch
        </a>
      </div>

      {/* Excerpt */}
      {video.excerpt && (
        <div style={{
          marginTop: 14, fontSize: 14, lineHeight: 1.75, color: 'var(--text-muted)',
          borderLeft: '2px solid rgba(245,158,11,0.2)', paddingLeft: 16,
        }}>
          {excerptParts.map((part, i) =>
            part.highlight
              ? <mark key={i}>{part.text}</mark>
              : <span key={i}>{part.text}</span>
          )}
        </div>
      )}

      {/* Expanded transcript */}
      {isExpanded && video.transcript && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
            Full Transcript
          </div>
          <div style={{
            fontSize: 14, lineHeight: 1.85, color: 'var(--text-muted)',
            maxHeight: 500, overflowY: 'auto', paddingRight: 8,
          }}>
            {video.transcript}
          </div>
        </div>
      )}
    </div>
  );
}
