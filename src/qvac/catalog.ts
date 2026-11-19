import {
  EMBEDDINGGEMMA_300M_Q8_0,
  HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
  PARAKEET_NEMOTRON_3_DIARIZATION_Q8_0,
  PARAKEET_TDT_0_6B_V3_Q8_0,
} from '@qvac/sdk';

/** The four on-device models the app needs. All are downloaded once, on first launch. */
export const MODELS = [
  {
    key: 'asr',
    descriptor: PARAKEET_TDT_0_6B_V3_Q8_0,
    label: 'Speech to text',
    purpose: 'Turns the visit recording into a transcript.',
  },
  {
    key: 'diarization',
    descriptor: PARAKEET_NEMOTRON_3_DIARIZATION_Q8_0,
    label: 'Voice separation',
    purpose: 'Tells apart who is speaking: you or your doctor.',
  },
  {
    key: 'medpsy',
    descriptor: HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
    label: 'Medical language model',
    purpose: 'Writes the plain-English summary and next steps.',
  },
  {
    key: 'embedder',
    descriptor: EMBEDDINGGEMMA_300M_Q8_0,
    label: 'Search model',
    purpose: 'Finds the right visit when you ask a question.',
  },
] as const;

export type ModelKey = (typeof MODELS)[number]['key'];
export type CatalogModel = (typeof MODELS)[number];

export const TOTAL_DOWNLOAD_BYTES = MODELS.reduce((sum, m) => sum + m.descriptor.expectedSize, 0);
