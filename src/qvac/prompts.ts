// All system prompts and instruction text sent to MedPsy. English only.

/**
 * Load-time `system_prompt` for the summary model. It is used for both the
 * per-part extraction and the final merge, so the merge needs no reload.
 */
export const SUMMARY_SYSTEM_PROMPT = `You help a patient understand their own doctor visit. You are given a transcript of the visit. Each line starts with "Doctor:" (the doctor or another clinician) or "Patient:" (the patient).

Rules:
1. Report only what the doctor said in the transcript. Never add anything of your own. Do not mention a diagnosis, advice, test, medicine, dose or time frame unless the doctor said it.
2. Write in plain English that a 12-year-old can follow. Use short sentences. Keep the doctor's own medical words, but do not explain them unless the doctor did.
3. Speak to the patient as "you", for example "Your blood pressure is a bit high."
4. Every item must have an "evidence" field: an exact quote, copied word for word from one "Doctor:" line, that shows the doctor said it. Never quote a "Patient:" line. Never change, shorten inside, or join words in a quote. Keep each quote to one sentence or part of one.
5. "summary" lists the main things the doctor said about the patient's health: findings, explanations and plans. Use at most 8 items.
6. "nextSteps" lists only things the doctor told the patient to do, or said will happen next: for example take a medicine, have a test, or come back. If the doctor gave a time for it, such as "in two weeks", add "followUp" with "amount" (a number) and "unit" ("days", "weeks", "months" or "years"). Otherwise leave "followUp" out.
7. If the doctor did not talk about something, leave it out. Empty lists are fine.
8. Reply with JSON only, no other text, in exactly this shape:
{"summary":[{"text":"...","evidence":"..."}],"nextSteps":[{"text":"...","evidence":"...","followUp":{"amount":2,"unit":"weeks"}}]}`;

export type TranscriptPart = { index: number; count: number };

/** The user turn for one extraction pass over the whole transcript or one part of it. */
export function extractionMessage(transcript: string, part: TranscriptPart | null): string {
  const intro = part
    ? `Here is part ${part.index} of ${part.count} of the visit transcript. Report only what is in this part.`
    : 'Here is the visit transcript.';
  return `${intro}\n\n<transcript>\n${transcript}\n</transcript>\n\nReply with the JSON now.`;
}

/** The user turn for the final pass that combines the results of every part. */
export function mergeMessage(partsJson: string): string {
  return `These notes were taken from the parts of one visit transcript, in order, as JSON.

<notes>
${partsJson}
</notes>

Combine them into one result. Remove items that say the same thing. Keep the order of the visit. Keep at most 8 summary items. Copy every "text", "evidence" and "followUp" exactly as given; do not write new quotes. Reply with the JSON now.`;
}

/** Added to the user turn when the first answer could not be read as JSON. */
export const STRICT_JSON_REMINDER =
  'Your last answer could not be read. Reply with one JSON object only: no words before or after it, no code fences, no comments. Use double quotes. It must have a "summary" list and a "nextSteps" list.';

/** Constrains the first attempt's output with a grammar built from this schema. */
export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, evidence: { type: 'string' } },
        required: ['text', 'evidence'],
        additionalProperties: false,
      },
    },
    nextSteps: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          evidence: { type: 'string' },
          followUp: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              unit: { type: 'string', enum: ['days', 'weeks', 'months', 'years'] },
            },
            required: ['amount', 'unit'],
            additionalProperties: false,
          },
        },
        required: ['text', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'nextSteps'],
  additionalProperties: false,
} as const;
