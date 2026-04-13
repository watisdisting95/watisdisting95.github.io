import { useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, Music, LogOut, ChevronUp, ChevronDown } from 'lucide-react';
import { redirectToAuthCodeFlow, getAccessToken, saveTokens, getSavedTokens, logout } from './SpotifyAuth';
import { getPlaybackState, seekPosition, togglePlayPause, skipToNext, skipToPrevious } from './SpotifyAPI';
import { fetchLyrics, LyricLine } from './LyricsService';
import './App.css';

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 5000;
const ENABLE_INTERPOLATION = import.meta.env.VITE_ENABLE_INTERPOLATION === 'true';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginView />} />
      <Route path="/callback" element={<CallbackView />} />
      <Route path="/dashboard" element={<DashboardView />} />
    </Routes>
  );
}

function LoginView() {
  const tokens = getSavedTokens();
  const navigate = useNavigate();

  useEffect(() => {
    if (tokens) {
      navigate('/dashboard');
    }
  }, [tokens, navigate]);

  return (
    <div className="login-container">
      <h1>Spotify Dashboard</h1>
      <p>Control your music from anywhere.</p>
      <button className="login-button" onClick={redirectToAuthCodeFlow}>
        Log in with Spotify
      </button>
    </div>
  );
}

function CallbackView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (code) {
      getAccessToken(code)
        .then((tokens) => {
          saveTokens(tokens);
          navigate('/dashboard');
        })
        .catch((err) => {
          console.error(err);
          setError('Failed to login. Please try again.');
        });
    }
  }, [code, navigate]);

  if (error) return <div className="error">{error}</div>;
  return <div className="loading">Logging you in...</div>;
}

function DashboardView() {
  const [playback, setPlayback] = useState<any>(null);
  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const pollTimerRef = useRef<number | null>(null);
  const interpolationTimerRef = useRef<number | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);

  const fetchPlayback = async () => {
    try {
      const data = await getPlaybackState();
      setPlayback(data);
      if (data && data.progress_ms !== undefined) {
        setDisplayProgress(data.progress_ms);
      }
      setLoading(false);

      // Check for new track and fetch lyrics
      if (data?.item?.id && data.item.id !== currentTrackIdRef.current) {
        currentTrackIdRef.current = data.item.id;
        setLyrics(null);
        const fetchedLyrics = await fetchLyrics(
          data.item.name,
          data.item.artists[0].name,
          data.item.album.name,
          Math.floor(data.item.duration_ms / 1000)
        );
        setLyrics(fetchedLyrics);
      }
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message === 'Unauthorized') {
        navigate('/');
      }
    }
  };

  useEffect(() => {
    const tokens = getSavedTokens();
    if (!tokens) {
      navigate('/');
      return;
    }

    fetchPlayback();
    pollTimerRef.current = window.setInterval(fetchPlayback, POLL_INTERVAL);

    if (ENABLE_INTERPOLATION) {
      interpolationTimerRef.current = window.setInterval(() => {
        setPlayback((currentPlayback: any) => {
          if (currentPlayback && currentPlayback.is_playing && currentPlayback.item) {
            const nextProgress = currentPlayback.progress_ms + 100;
            if (nextProgress <= currentPlayback.item.duration_ms) {
              const updated = { ...currentPlayback, progress_ms: nextProgress };
              setDisplayProgress(nextProgress);
              return updated;
            }
          }
          return currentPlayback;
        });
      }, 100);
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (interpolationTimerRef.current) clearInterval(interpolationTimerRef.current);
    };
  }, [navigate]);

  const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPos = parseInt(e.target.value);
    setDisplayProgress(newPos);
    setPlayback((prev: any) => ({ ...prev, progress_ms: newPos }));
    try {
      await seekPosition(newPos);
      setTimeout(fetchPlayback, 500);
    } catch (err) {
      console.error('Seek failed', err);
    }
  };

  const handleTogglePlay = async () => {
    const isPlaying = playback?.is_playing;
    setPlayback((prev: any) => ({ ...prev, is_playing: !isPlaying }));
    try {
      await togglePlayPause(isPlaying);
      setTimeout(fetchPlayback, 500);
    } catch (err) {
      console.error('Toggle play failed', err);
    }
  };

  const handleSkip = async (direction: 'next' | 'prev') => {
    try {
      if (direction === 'next') await skipToNext();
      else await skipToPrevious();
      setTimeout(fetchPlayback, 500);
    } catch (err) {
      console.error(`Skip ${direction} failed`, err);
    }
  };

  if (loading) return <div className="loading">Connecting to Spotify...</div>;

  if (!playback || !playback.item) {
    return (
      <div className="no-playback">
        <Music size={64} />
        <h2>No music playing</h2>
        <p>Start playing music on another device to see it here.</p>
        <button className="logout-button" onClick={logout}>
          <LogOut size={20} /> Logout
        </button>
      </div>
    );
  }

  const { item, is_playing } = playback;
  const { album, name, artists, duration_ms } = item;

  const currentLyricIndex = lyrics
    ? lyrics.findLastIndex((l) => l.time <= displayProgress)
    : -1;

  return (
    <div className={`dashboard-container ${showLyrics ? 'show-lyrics' : ''}`}>
      <div className="header">
        <div className="attribution">Powered by Spotify</div>
        <button className="logout-icon-button" onClick={logout} title="Logout">
          <LogOut size={20} />
        </button>
      </div>

      <div className="dashboard-content">
        <div className="player-section">
          <div className="player-card">
            <div className="artwork-container">
              <img src={album.images[0]?.url} alt={album.name} className="artwork" />
            </div>
            
            <div className="track-info">
              <h2 className="track-name">{name}</h2>
              <p className="artist-name">{artists.map((a: any) => a.name).join(', ')}</p>
            </div>

            <div className="controls">
              <button onClick={() => handleSkip('prev')} className="control-button">
                <SkipBack size={32} />
              </button>
              <button onClick={handleTogglePlay} className="control-button play-pause">
                {is_playing ? <Pause size={48} fill="currentColor" /> : <Play size={48} fill="currentColor" />}
              </button>
              <button onClick={() => handleSkip('next')} className="control-button">
                <SkipForward size={32} />
              </button>
            </div>

            <div className="progress-container">
              <input
                type="range"
                min="0"
                max={duration_ms}
                value={displayProgress}
                onChange={handleSeek}
                className="progress-bar"
              />
              <div className="time-info">
                <span>{formatTime(displayProgress)}</span>
                <span>{formatTime(duration_ms)}</span>
              </div>
            </div>
          </div>
          <p className="premium-note">Playback control requires Spotify Premium.</p>
          
          <button 
            className="lyrics-toggle" 
            onClick={() => setShowLyrics(!showLyrics)}
          >
            {showLyrics ? <ChevronDown size={24} /> : <ChevronUp size={24} />}
            {showLyrics ? 'Hide Lyrics' : 'Show Lyrics'}
          </button>
        </div>

        <div className="lyrics-section">
          <div className="lyrics-content">
            {lyrics ? (
              lyrics.map((line, index) => (
                <p 
                  key={index} 
                  className={`lyric-line ${index === currentLyricIndex ? 'active' : ''} ${index > currentLyricIndex ? 'future' : ''}`}
                  onClick={() => {
                    setDisplayProgress(line.time);
                    seekPosition(line.time);
                    setTimeout(fetchPlayback, 500);
                  }}
                >
                  {line.text}
                </p>
              ))
            ) : (
              <p className="no-lyrics">Lyrics not available for this song.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default App;
