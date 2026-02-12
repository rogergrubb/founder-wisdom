/**
 * Transcript Collector — YouTube Data API v3 + youtube-transcript
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'transcripts.json');
const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_HANDLE = 'starterstory';
const MIN_DURATION_SECONDS = 120;
const YT_API = 'https://www.googleapis.com/youtube/v3';

async function ytGet(endpoint, params) {
  const url = new URL(`${YT_API}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`YT API: ${data.error.message}`);
  return data;
}

function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function formatDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

async function fetchTranscript(videoId) {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map(s => s.text).join(' ')
      .replace(/\[Music\]/gi, '').replace(/\[Applause\]/gi, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    return { ok: true, text, words: text.split(/\s+/).length };
  } catch (e) {
    return { ok: false, text: '', words: 0, err: e.message?.slice(0, 100) || 'Unknown' };
  }
}

async function collect() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  FOUNDER WISDOM — Transcript Collector');
  console.log('══════════════════════════════════════════════\n');

  if (!API_KEY) {
    console.error('  ERROR: YOUTUBE_API_KEY not set');
    ensureOutput({ status: 'error', message: 'No API key' });
    return;
  }

  // Cache check
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
      const hours = (Date.now() - new Date(existing.metadata?.collectedAt || 0).getTime()) / 3.6e6;
      if (hours < 24 && existing.videos?.length > 5) {
        console.log(`  Cached: ${existing.videos.length} videos (${Math.round(hours)}h ago)`);
        return;
      }
    } catch {}
  }

  // Step 1: Find channel
  console.log('  Step 1/4: Finding channel @' + CHANNEL_HANDLE + '...');
  const ch = await ytGet('channels', { forHandle: CHANNEL_HANDLE, part: 'snippet,contentDetails' });
  if (!ch.items?.length) throw new Error('Channel not found');
  const channel = ch.items[0];
  const uploadsId = channel.contentDetails.relatedPlaylists.uploads;
  console.log(`  Channel: ${channel.snippet.title} (${channel.id})`);

  // Step 2: Get all video IDs from uploads playlist
  console.log('  Step 2/4: Listing videos...');
  const videoIds = [];
  let pageToken = '';
  do {
    const params = { playlistId: uploadsId, part: 'snippet', maxResults: '50' };
    if (pageToken) params.pageToken = pageToken;
    const pl = await ytGet('playlistItems', params);
    pl.items?.forEach(i => videoIds.push(i.snippet.resourceId.videoId));
    pageToken = pl.nextPageToken || '';
    console.log(`  ...${videoIds.length} videos`);
  } while (pageToken);

  // Step 3: Get video details (duration, views) in batches
  console.log(`  Step 3/4: Getting details for ${videoIds.length} videos...`);
  const videoDetails = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const vd = await ytGet('videos', { id: batch.join(','), part: 'snippet,contentDetails,statistics' });
    vd.items?.forEach(v => {
      const dur = parseDuration(v.contentDetails.duration);
      if (dur >= MIN_DURATION_SECONDS) {
        videoDetails.push({
          id: v.id,
          title: v.snippet.title,
          description: v.snippet.description?.slice(0, 300) || '',
          publishedAt: v.snippet.publishedAt,
          thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url || '',
          durationSeconds: dur,
          durationFormatted: formatDuration(dur),
          viewCount: parseInt(v.statistics.viewCount || '0', 10),
        });
      }
    });
  }
  console.log(`  Long-form videos: ${videoDetails.length} (filtered ${videoIds.length - videoDetails.length} shorts)`);

  // Step 4: Fetch transcripts
  console.log(`\n  Step 4/4: Fetching transcripts...`);
  let ok = 0, fail = 0, totalWords = 0;
  const videos = [];

  for (let i = 0; i < videoDetails.length; i++) {
    const v = videoDetails[i];
    process.stdout.write(`  [${i+1}/${videoDetails.length}] ${v.title.slice(0,55)}... `);
    const t = await fetchTranscript(v.id);
    videos.push({
      ...v,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      transcriptAvailable: t.ok,
      transcript: t.text,
      wordCount: t.words,
    });
    if (t.ok) { ok++; totalWords += t.words; console.log(`✓ (${t.words} words)`); }
    else { fail++; console.log(`✗ (${t.err})`); }
    if (i < videoDetails.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  const db = {
    metadata: {
      channelUrl: `https://www.youtube.com/@${CHANNEL_HANDLE}`,
      channelTitle: channel.snippet.title,
      collectedAt: new Date().toISOString(),
      totalVideos: videoDetails.length,
      withTranscripts: ok,
      failedTranscripts: fail,
      totalWords,
    },
    videos: videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(db, null, 2));

  console.log('\n══════════════════════════════════════════════');
  console.log(`  DONE: ${ok} transcripts | ${totalWords.toLocaleString()} words | ${(Buffer.byteLength(JSON.stringify(db))/1048576).toFixed(1)} MB`);
  console.log('══════════════════════════════════════════════\n');
}

function ensureOutput(meta) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
      metadata: { collectedAt: new Date().toISOString(), totalVideos: 0, withTranscripts: 0, totalWords: 0, ...meta },
      videos: [],
    }));
  }
}

collect().catch(err => {
  console.error('Collection failed:', err.message);
  ensureOutput({ status: 'error', message: err.message });
});
