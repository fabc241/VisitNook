// Questions that ask for medical advice are declined before any model runs.
// Pure TypeScript: no React Native imports, unit-tested.

import { extractEntities } from '../guardrails/check';
import { normalize } from '../guardrails/normalize';

export type DeclineReason = 'dose' | 'safety' | 'diagnosis' | 'advice';

export type Precheck = { declined: false } | { declined: true; reason: DeclineReason };

/** Shown instead of an answer. Nothing is generated for these questions. */
export const DECLINE_MESSAGE =
  "I can't give medical advice, such as whether to change or stop a medicine, what dose to take, " +
  'or what a symptom means. Please ask your doctor or pharmacist about that. ' +
  'If you feel very unwell, call your local emergency number.';

/** Shown under the decline so the patient knows what they can ask. */
export const DECLINE_HINT =
  'You can ask what your doctor said, for example: “What did my doctor say about my dose?”';

// Patterns run on `normalize()`d text: lowercase, no punctuation ("what's" →
// "what s"), number words as digits.

const MEDICINE_WORDS =
  'dose|doses|dosage|medicine|medicines|medication|medications|meds|pill|pills|tablet|tablets|prescription|prescriptions|insulin|inhaler|antibiotic|antibiotics';

/**
 * The patient is the one who would act: "should I double…", "is it ok to
 * skip…", "what if I stop…", or a bare "Double my dose?". "Did my doctor
 * change my medicine?" has the doctor as the subject and is not matched.
 */
const PATIENT_ACTS = '(?:^|\\b(?:i|should|can|could|may|might|must|will|would|to)\\s)';

/** Never allowed, even when the question mentions the doctor. */
const HARD_RULES: [RegExp, DeclineReason][] = [
  [
    new RegExp(
      `${PATIENT_ACTS}(double|triple|halve|half|increase|decrease|lower|raise|reduce|up|change|adjust|skip|miss|stop|quit|cut|split|crush) (my|the|a|an|this|that|these|those|one|another|extra|some|all) (${MEDICINE_WORDS})\\b`,
    ),
    'dose',
  ],
  [/\b(an extra|one more|another|a double|double|2) (dose|doses|pill|pills|tablet|tablets|puff|puffs|shot|shots)\b/, 'dose'],
  [new RegExp(`${PATIENT_ACTS}(stop|quit) (taking|using)\\b`), 'dose'],
  [new RegExp(`${PATIENT_ACTS}(go|come) off (my|the|it|them)\\b`), 'dose'],
  [/\bhow (much|many)\b[a-z0-9 ]{0,30}\b(should|can|could|do|must|may) i\b/, 'dose'],
  [/\bis it (safe|ok|okay|alright|all right|fine|bad|dangerous|harmful|risky)\b/, 'safety'],
  [/\b(safe|ok|okay|alright|fine|dangerous) (for me )?to (take|drink|eat|mix|combine|stop|skip|use|exercise|drive|fly|have)\b/, 'safety'],
  [
    /\b(can|could|may|must) i (take|stop|skip|double|triple|increase|decrease|lower|raise|reduce|change|switch|mix|combine|drink|eat|exercise|start|quit|use|try|have)\b/,
    'safety',
  ],
  [/\bwhat (s|is) wrong with me\b/, 'diagnosis'],
  [/\bwhat do i have\b/, 'diagnosis'],
  [/\bam i (sick|ill|dying|okay|ok|fine|going to (be|die|get))\b/, 'diagnosis'],
  [/\bis (this|that|it) (serious|normal|cancer|bad|dangerous|contagious|an emergency)\b/, 'diagnosis'],
  [/\bdiagnos(e|is|ed)\b/, 'diagnosis'],
  [/\bwhat (does|could|might) (this|that|it|my) [a-z ]{0,30}mean\b/, 'diagnosis'],
];

/** Allowed when the question is about what the doctor said. */
const SOFT_RULES: [RegExp, DeclineReason][] = [
  [/\bshould i\b/, 'advice'],
  [/\bought i\b/, 'advice'],
  [/\bdo i (need|have) to\b/, 'advice'],
  [/\b(recommend|suggest|advise|advice)\b/, 'advice'],
  [/\bwhat (dose|dosage|amount)\b/, 'dose'],
  [/\b(best|better|good) (medicine|medication|drug|pill|treatment|supplement|vitamin|way|diet)\b/, 'advice'],
];

/** The question asks what was said in a visit, not for new advice. */
const RECALL_PATTERNS = [
  /\b(did|does|has|had|was|is) (my|the|our) (doctor|dr|nurse|clinician|physician|specialist|surgeon|pharmacist)\b/,
  /\b(doctor|dr|nurse|clinician|physician|specialist|surgeon|they|she|he) (said|say|says|told|tell|tells|mentioned|mention|recommended|recommend|suggested|suggest|advised|advise|wanted|want|wants|asked|ask|prescribed|prescribe|gave|give)\b/,
  /\bwhat (was|were) i told\b/,
  /\btold me\b/,
];

/** Asks whether the patient has a condition ("Do I have diabetes?"). */
function asksForDiagnosis(normalized: string, question: string): boolean {
  if (!/\b(do|might|could|may|can) i have\b/.test(normalized)) return false;
  return extractEntities(question).some((e) => e.kind === 'condition');
}

export function precheckQuestion(question: string): Precheck {
  const s = normalize(question);
  for (const [pattern, reason] of HARD_RULES) {
    if (pattern.test(s)) return { declined: true, reason };
  }
  if (asksForDiagnosis(s, question)) return { declined: true, reason: 'diagnosis' };
  if (RECALL_PATTERNS.some((p) => p.test(s))) return { declined: false };
  for (const [pattern, reason] of SOFT_RULES) {
    if (pattern.test(s)) return { declined: true, reason };
  }
  return { declined: false };
}
