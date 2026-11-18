import { AudioQuality, IOSOutputFormat, setAudioModeAsync, type RecordingOptions } from 'expo-audio';
import { Directory, Paths } from 'expo-file-system';

import FileProtection from '../../modules/file-protection';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BIT_DEPTH = 16;

/**
 * 16 kHz mono 16-bit Linear PCM in a WAV container: the format Parakeet expects.
 * expo-audio writes the file to `<Documents>/ExpoAudio/<fileName>.wav`.
 */
export const RECORDING_OPTIONS: RecordingOptions = {
  directory: 'document',
  extension: '.wav',
  sampleRate: SAMPLE_RATE,
  numberOfChannels: CHANNELS,
  bitRate: SAMPLE_RATE * CHANNELS * BIT_DEPTH,
  isMeteringEnabled: false,
  ios: {
    extension: '.wav',
    sampleRate: SAMPLE_RATE,
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.MAX,
    linearPCMBitDepth: BIT_DEPTH,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  // The app is iOS-only; these fields are required by the type.
  android: { outputFormat: 'default', audioEncoder: 'default' },
  web: {},
};

/** The folder expo-audio records into (see `RECORDING_OPTIONS.directory`). */
export const recordingDirectory = new Directory(Paths.document, 'ExpoAudio');

/**
 * The app's default protection class is `complete`, which makes files
 * unwritable ~10 s after the phone locks. New files take the class of their
 * folder, so the recording folder uses `completeUnlessOpen`: the open WAV
 * stays writable while the screen is locked.
 */
export async function prepareRecordingDirectory(): Promise<void> {
  recordingDirectory.create({ intermediates: true, idempotent: true });
  await FileProtection.setProtection(recordingDirectory.uri, 'completeUnlessOpen');
  await FileProtection.excludeFromBackup(recordingDirectory.uri);
}

/** Call after `prepareToRecordAsync()` created the file, in case it did not inherit the folder's class. */
export async function protectActiveRecording(uri: string): Promise<void> {
  await FileProtection.setProtection(uri, 'completeUnlessOpen');
  await FileProtection.excludeFromBackup(uri);
}

export function enableRecordingMode(): Promise<void> {
  return setAudioModeAsync({
    allowsRecording: true,
    allowsBackgroundRecording: true,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
  });
}

/** Only call once the recorder has stopped: turning recording off stops active recorders. */
export function enablePlaybackMode(): Promise<void> {
  return setAudioModeAsync({
    allowsRecording: false,
    allowsBackgroundRecording: false,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
  });
}
