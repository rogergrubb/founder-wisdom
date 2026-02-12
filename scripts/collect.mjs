/**
 * Transcript Collector — ZERO API KEYS needed
 * Uses @distube/ytsr (scraping) to find channel
 * Uses @distube/ytpl (scraping) for video listing  
 * Uses youtube-transcript for transcript extraction
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ytpl from '@distube/ytpl';
import ytsr from '@distube/ytsr';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'transcripts.json');
const CHANNEL_HANDLE = 'starterstory';
const MIN_DURATION_SECONDS = 120;

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchTranscript(videoId) {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId);

    const fullText = segments
      .map(s => s.text)
      .join(' ')
      .replace(/\[Music\]/gi, '')
      .replace(/\[Applause\]/gi, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    return { success: true, text: fullText, wordCount: fullText.split(/\s+/).length };
  } catch (err) {
    return { success: false, text: '', wordCount: 0, error: err.message?.slice(0, 100) || 'Unknown' };
  }
}

async function collect() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  FOUNDER WISDOM — Transcript Collector');
  console.log('  (No API keys needed)');
  console.log('══════════════════════════════════════════════\n');

  // Check cache
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
      const collectedAt = new Date(existing.metadata?.collectedAt || 0);
      const hoursSince = (Date.now() - collectedAt.getTime()) / (1000 * 60 * 60);

      if (hoursSince < 24 && existing.videos?.length > 5) {
        console.log(`  Using cached data (${existing.videos.length} videos, collected ${Math.round(hoursSince)}h ago)`);
        return;
      }
    } catch {}
  }

  // Step 1: Resolve channel handle to channel URL via search
  console.log('  Step 1/3: Resolving channel @' + CHANNEL_HANDLE + '...');
  let channelUrl;
  try {
    const searchResults = await ytsr(CHANNEL_HANDLE, { limit: 10 });
    const channelResult = searchResults.items.find(i => 
      i.type === 'channel' && 
      (i.name?.toLowerCase().includes('starter story') || i.url?.includes(CHANNEL_HANDLE))
    );
    if (channelResult) {
      channelUrl = channelResult.url;
      console.log(`  Found: ${channelResult.name} → ${channelUrl}`);
    } else {
      // Try first channel result
      const anyChannel = searchResults.items.find(i => i.type === 'channel');
      if (anyChannel) {
        channelUrl = anyChannel.url;
        console.log(`  Found (best match): ${anyChannel.name} → ${channelUrl}`);
      } else {
        throw new Error('No channel found in search results');
      }
    }
  } catch (err) {
    console.error('  Search failed:', err.message);
    // Fallback: try direct channel URL formats
    channelUrl = `https://www.youtube.com/@${CHANNEL_HANDLE}`;
    console.log(`  Using fallback URL: ${channelUrl}`);
  }

  // Step 2: Get all videos from channel
  console.log('  Step 2/3: Fetching video list...');
  let playlist;
  try {
    playlist = await ytpl(channelUrl, { limit: Infinity });
  } catch (err) {
    console.error('  Failed to fetch channel:', err.message);
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log('  Using existing cached data.');
      return;
    }
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
      metadata: { collectedAt: new Date().toISOString(), totalVideos: 0, withTranscripts: 0, totalWords: 0, status: 'error', message: err.message },
      videos: [],
    }));
    return;
  }

  console.log(`  Channel: ${playlist.title}`);
  console.log(`  Total videos found: ${playlist.items.length}`);

  // Filter to long-form only
  const longForm = playlist.items.filter(item => {
    let durationSec = 0;
    if (typeof item.duration === 'string') {
      const parts = item.duration.split(':').map(Number);
      if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
    } else if (typeof item.durationSec === 'number') {
      durationSec = item.durationSec;
    }
    item._durationSec = durationSec;
    return durationSec >= MIN_DURATION_SECONDS;
  });

  console.log(`  Long-form videos (>${MIN_DURATION_SECONDS}s): ${longForm.length}`);
  console.log(`  Filtered out ${playlist.items.length - longForm.length} shorts/clips\n`);

  // Step 2: Fetch transcripts
  console.log('  Step 3/3: Fetching transcripts...');
  let successCount = 0;
  let failCount = 0;
  let totalWords = 0;
  const videos = [];

  for (let i = 0; i < longForm.length; i++) {
    const item = longForm[i];
    const progress = `[${i + 1}/${longForm.length}]`;
    process.stdout.write(`  ${progress} ${(item.title || '').slice(0, 55)}... `);

    const transcript = await fetchTranscript(item.id);

    videos.push({
      id: item.id,
      title: item.title,
      description: '',
      publishedAt: item.uploadDate || '',
      thumbnail: item.bestThumbnail?.url || item.thumbnails?.[0]?.url || '',
      url: item.shortUrl || `https://www.youtube.com/watch?v=${item.id}`,
      durationSeconds: item._durationSec || 0,
      durationFormatted: item.duration || formatDuration(item._durationSec || 0),
      viewCount: parseInt(String(item.views || '0').replace(/[^0-9]/g, ''), 10) || 0,
      transcriptAvailable: transcript.success,
      transcript: transcript.text,
      wordCount: transcript.wordCount,
    });

    if (transcript.success) {
      successCount++;
      totalWords += transcript.wordCount;
      console.log(`✓ (${transcript.wordCount} words)`);
    } else {
      failCount++;
      console.log(`✗ (${transcript.error})`);
    }

    if (i < longForm.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const database = {
    metadata: {
      channelUrl: `https://www.youtube.com/@${CHANNEL_HANDLE}`,
      channelTitle: playlist.title || 'Starter Story',
      collectedAt: new Date().toISOString(),
      totalVideos: longForm.length,
      withTranscripts: successCount,
      failedTranscripts: failCount,
      totalWords,
    },
    videos: videos.sort((a, b) => {
      if (a.publishedAt && b.publishedAt) return new Date(b.publishedAt) - new Date(a.publishedAt);
      return 0;
    }),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(database, null, 2));

  const fileSizeMB = (Buffer.byteLength(JSON.stringify(database)) / (1024 * 1024)).toFixed(1);

  console.log('\n══════════════════════════════════════════════');
  console.log('  COLLECTION COMPLETE');
  console.log('══════════════════════════════════════════════');
  console.log(`  Videos:      ${longForm.length}`);
  console.log(`  Transcripts: ${successCount}`);
  console.log(`  Failed:      ${failCount}`);
  console.log(`  Total words: ${totalWords.toLocaleString()}`);
  console.log(`  File size:   ${fileSizeMB} MB`);
  console.log('══════════════════════════════════════════════\n');
}

collect().catch(err => {
  console.error('Collection failed:', err.message);
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
      metadata: { collectedAt: new Date().toISOString(), totalVideos: 0, withTranscripts: 0, totalWords: 0, status: 'error', message: err.message },
      videos: [],
    }));
  }
});
