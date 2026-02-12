/**
 * Transcript Collector - runs at build time on Vercel
 * Fetches all long-form videos from Starter Story and their transcripts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'transcripts.json');
const CHANNEL_HANDLE = 'starterstory';
const MIN_DURATION_SECONDS = 120; // Skip Shorts and clips under 2 min
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// ─── YouTube Data API helpers ───────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getChannelId(handle) {
  const url = `https://www.googleapis.com/youtube/v3/channels?forHandle=${handle}&part=contentDetails,snippet&key=${YOUTUBE_API_KEY}`;
  const data = await fetchJSON(url);
  if (!data.items || data.items.length === 0) {
    throw new Error(`Channel @${handle} not found`);
  }
  const channel = data.items[0];
  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title || handle,
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
  };
}

async function getPlaylistVideos(playlistId) {
  let videos = [];
  let pageToken = '';

  while (true) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${playlistId}&part=snippet,contentDetails&maxResults=50&key=${YOUTUBE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await fetchJSON(url);

    for (const item of data.items || []) {
      videos.push({
        id: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId,
        title: item.snippet?.title,
        description: item.snippet?.description?.slice(0, 500) || '',
        publishedAt: item.snippet?.publishedAt,
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '',
      });
    }

    console.log(`  Fetched ${videos.length} videos so far...`);

    if (data.nextPageToken) {
      pageToken = data.nextPageToken;
    } else {
      break;
    }
  }

  return videos;
}

async function getVideoDurations(videoIds) {
  const durations = {};
  // Process in batches of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${batch.join(',')}&part=contentDetails,statistics&key=${YOUTUBE_API_KEY}`;
    const data = await fetchJSON(url);

    for (const item of data.items || []) {
      const dur = parseDuration(item.contentDetails?.duration || 'PT0S');
      durations[item.id] = {
        durationSeconds: dur,
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
      };
    }
  }
  return durations;
}

function parseDuration(iso8601) {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Transcript fetcher ─────────────────────────────────────────────

async function fetchTranscript(videoId) {
  try {
    // Dynamic import since it's ESM
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

    return {
      success: true,
      text: fullText,
      wordCount: fullText.split(/\s+/).length,
    };
  } catch (err) {
    return {
      success: false,
      text: '',
      wordCount: 0,
      error: err.message?.slice(0, 100) || 'Unknown error',
    };
  }
}

// ─── Main collection pipeline ───────────────────────────────────────

async function collect() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  FOUNDER WISDOM — Transcript Collector');
  console.log('══════════════════════════════════════════════\n');

  // Check for existing data (skip collection if fresh)
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
      const collectedAt = new Date(existing.metadata?.collectedAt || 0);
      const hoursSince = (Date.now() - collectedAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursSince < 24 && existing.videos?.length > 10) {
        console.log(`  Using cached data (${existing.videos.length} videos, collected ${Math.round(hoursSince)}h ago)`);
        console.log('  Delete public/data/transcripts.json to force refresh.\n');
        return;
      }
    } catch {}
  }

  if (!YOUTUBE_API_KEY) {
    console.log('  ⚠ No YOUTUBE_API_KEY environment variable set.');
    console.log('  Using existing transcript data if available.\n');
    
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log('  Found existing transcripts.json — using cached data.');
      return;
    }

    console.log('  No cached data found. Creating placeholder.');
    const placeholder = {
      metadata: {
        channelUrl: `https://www.youtube.com/@${CHANNEL_HANDLE}`,
        channelTitle: 'Starter Story',
        collectedAt: new Date().toISOString(),
        totalVideos: 0,
        withTranscripts: 0,
        totalWords: 0,
        status: 'pending',
        message: 'Set YOUTUBE_API_KEY env var and redeploy to collect transcripts.',
      },
      videos: [],
    };
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(placeholder, null, 2));
    return;
  }

  // Step 1: Get channel info
  console.log(`  Step 1/4: Finding channel @${CHANNEL_HANDLE}...`);
  const { channelId, channelTitle, uploadsPlaylistId } = await getChannelId(CHANNEL_HANDLE);
  console.log(`  Found: ${channelTitle} (${channelId})`);
  console.log(`  Uploads playlist: ${uploadsPlaylistId}\n`);

  // Step 2: List all videos
  console.log('  Step 2/4: Listing all videos...');
  const allVideos = await getPlaylistVideos(uploadsPlaylistId);
  console.log(`  Total videos: ${allVideos.length}\n`);

  // Step 3: Get durations and filter
  console.log('  Step 3/4: Getting video durations and filtering...');
  const videoIds = allVideos.map(v => v.id).filter(Boolean);
  const durations = await getVideoDurations(videoIds);

  const longFormVideos = allVideos.filter(v => {
    const info = durations[v.id];
    return info && info.durationSeconds >= MIN_DURATION_SECONDS;
  });

  console.log(`  Long-form videos (>${MIN_DURATION_SECONDS}s): ${longFormVideos.length}`);
  console.log(`  Filtered out ${allVideos.length - longFormVideos.length} shorts/clips\n`);

  // Step 4: Fetch transcripts
  console.log('  Step 4/4: Fetching transcripts...');
  let successCount = 0;
  let failCount = 0;
  let totalWords = 0;

  const videos = [];

  for (let i = 0; i < longFormVideos.length; i++) {
    const video = longFormVideos[i];
    const info = durations[video.id] || {};
    const progress = `[${i + 1}/${longFormVideos.length}]`;

    process.stdout.write(`  ${progress} ${video.title?.slice(0, 55)}... `);

    const transcript = await fetchTranscript(video.id);

    videos.push({
      id: video.id,
      title: video.title,
      description: video.description,
      publishedAt: video.publishedAt,
      thumbnail: video.thumbnail,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      durationSeconds: info.durationSeconds || 0,
      durationFormatted: formatDuration(info.durationSeconds || 0),
      viewCount: info.viewCount || 0,
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

    // Rate limiting
    if (i < longFormVideos.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Save results
  const database = {
    metadata: {
      channelUrl: `https://www.youtube.com/@${CHANNEL_HANDLE}`,
      channelTitle,
      channelId,
      collectedAt: new Date().toISOString(),
      totalVideos: longFormVideos.length,
      withTranscripts: successCount,
      failedTranscripts: failCount,
      totalWords,
    },
    videos: videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(database, null, 2));

  const fileSizeMB = (Buffer.byteLength(JSON.stringify(database)) / (1024 * 1024)).toFixed(1);

  console.log('\n══════════════════════════════════════════════');
  console.log('  COLLECTION COMPLETE');
  console.log('══════════════════════════════════════════════');
  console.log(`  Videos:      ${longFormVideos.length}`);
  console.log(`  Transcripts: ${successCount}`);
  console.log(`  Failed:      ${failCount}`);
  console.log(`  Total words: ${totalWords.toLocaleString()}`);
  console.log(`  File size:   ${fileSizeMB} MB`);
  console.log(`  Output:      ${OUTPUT_PATH}`);
  console.log('══════════════════════════════════════════════\n');
}

collect().catch(err => {
  console.error('Collection failed:', err.message);
  // Don't fail the build — use cached data if available
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
      metadata: { collectedAt: new Date().toISOString(), totalVideos: 0, withTranscripts: 0, totalWords: 0, status: 'error', message: err.message },
      videos: [],
    }));
  }
});
