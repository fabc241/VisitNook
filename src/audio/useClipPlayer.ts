import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { visitAudioFile } from '../storage/visits';

/**
 * Plays one time range of a visit's `audio.wav` at a time. `activeKey` says
 * which clip is playing so the UI can show a Stop button on it.
 */
export function useClipPlayer(visitId: string) {
  const player = useAudioPlayer({ uri: visitAudioFile(visitId).uri }, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const endSec = useRef<number | null>(null);

  const stop = useCallback(() => {
    player.pause();
    endSec.current = null;
    setActiveKey(null);
  }, [player]);

  const play = useCallback(
    async (key: string, startMs: number, endMs: number) => {
      player.pause();
      endSec.current = endMs / 1000;
      setActiveKey(key);
      await player.seekTo(startMs / 1000);
      player.play();
    },
    [player],
  );

  // Stop at the end of the clip (or of the file).
  useEffect(() => {
    if (activeKey === null) return;
    const end = endSec.current;
    if (status.didJustFinish || (end !== null && status.playing && status.currentTime >= end)) {
      stop();
    }
  }, [activeKey, status.currentTime, status.didJustFinish, status.playing, stop]);

  return { activeKey, ready: status.isLoaded, play, stop };
}
