import { get, set } from 'idb-keyval';

export interface LyricLine {
  time: number; // Time in milliseconds
  text: string;
}

export interface LRCLyricResponse {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
}

const LRCLIB_BASE_URL = 'https://lrclib.net/api/get';

export const fetchLyrics = async (
  trackName: string,
  artistName: string,
  albumName: string,
  durationSeconds: number
): Promise<LyricLine[] | null> => {
  const cacheKey = `lyrics_${artistName}_${trackName}_${durationSeconds}`;

  try {
    // Check cache first
    const cached = await get<LyricLine[]>(cacheKey);
    if (cached) {
      console.log(`Using cached lyrics for: ${trackName}`);
      return cached;
    }

    const params = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
      album_name: albumName,
      duration: durationSeconds.toString(),
    });

    const response = await fetch(`${LRCLIB_BASE_URL}?${params.toString()}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`LRCLIB API error: ${response.status}`);
    }

    const data: LRCLyricResponse = await response.json();

    if (data.syncedLyrics) {
      const parsed = parseSyncedLyrics(data.syncedLyrics);
      // Store in cache
      await set(cacheKey, parsed);
      return parsed;
    }

    return null;
  } catch (error) {
    console.error('Error fetching lyrics from LRCLIB:', error);
    return null;
  }
};

const parseSyncedLyrics = (lrcContents: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  const lrcRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;

  const contentLines = lrcContents.split('\n');

  for (const line of contentLines) {
    const match = line.match(lrcRegex);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const milliseconds = parseInt(match[3].padEnd(3, '0').substring(0, 3));
      const time = minutes * 60 * 1000 + seconds * 1000 + milliseconds;
      const text = match[4].trim();
      
      if (text) {
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
};
