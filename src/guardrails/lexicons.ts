// Word lists for the guardrail. Every phrase is normalized with the same
// tokenizer as the transcript, so spelling them in plain English is enough.
// A term's first variant is its label in the "Removed by safety check" list.

export type Term = {
  /** First entry is the label; the rest are synonyms that count as the same thing. */
  variants: string[];
  /** For medicines: the group it belongs to, so "antibiotic" is supported by "amoxicillin". */
  category?: string;
};

// ---------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------

/** Named medicines, generic and brand names grouped together. */
export const MEDICINES: Term[] = [
  { variants: ['acetaminophen', 'paracetamol', 'tylenol'], category: 'painkiller' },
  { variants: ['ibuprofen', 'advil', 'motrin'], category: 'painkiller' },
  { variants: ['naproxen', 'aleve'], category: 'painkiller' },
  { variants: ['aspirin'], category: 'painkiller' },
  { variants: ['tramadol'], category: 'painkiller' },
  { variants: ['oxycodone'], category: 'painkiller' },
  { variants: ['hydrocodone'], category: 'painkiller' },
  { variants: ['morphine'], category: 'painkiller' },
  { variants: ['codeine'], category: 'painkiller' },
  { variants: ['insulin'] },
  { variants: ['metformin', 'glucophage'] },
  { variants: ['semaglutide', 'ozempic', 'wegovy'] },
  { variants: ['tirzepatide', 'mounjaro', 'zepbound'] },
  { variants: ['empagliflozin', 'jardiance'] },
  { variants: ['warfarin', 'coumadin'], category: 'blood thinner' },
  { variants: ['apixaban', 'eliquis'], category: 'blood thinner' },
  { variants: ['rivaroxaban', 'xarelto'], category: 'blood thinner' },
  { variants: ['clopidogrel', 'plavix'], category: 'blood thinner' },
  { variants: ['heparin'], category: 'blood thinner' },
  { variants: ['levothyroxine', 'synthroid'] },
  { variants: ['atorvastatin', 'lipitor'], category: 'statin' },
  { variants: ['rosuvastatin', 'crestor'], category: 'statin' },
  { variants: ['simvastatin', 'zocor'], category: 'statin' },
  { variants: ['lisinopril'], category: 'ace inhibitor' },
  { variants: ['amlodipine', 'norvasc'], category: 'blood pressure medicine' },
  { variants: ['losartan'], category: 'blood pressure medicine' },
  { variants: ['metoprolol'], category: 'beta blocker' },
  { variants: ['hydrochlorothiazide'], category: 'diuretic' },
  { variants: ['furosemide', 'lasix'], category: 'diuretic' },
  { variants: ['spironolactone'], category: 'diuretic' },
  { variants: ['omeprazole', 'prilosec'], category: 'acid reducer' },
  { variants: ['esomeprazole', 'nexium'], category: 'acid reducer' },
  { variants: ['pantoprazole', 'protonix'], category: 'acid reducer' },
  { variants: ['famotidine', 'pepcid'], category: 'acid reducer' },
  { variants: ['sertraline', 'zoloft'], category: 'antidepressant' },
  { variants: ['fluoxetine', 'prozac'], category: 'antidepressant' },
  { variants: ['escitalopram', 'lexapro'], category: 'antidepressant' },
  { variants: ['citalopram', 'celexa'], category: 'antidepressant' },
  { variants: ['bupropion', 'wellbutrin'], category: 'antidepressant' },
  { variants: ['trazodone'], category: 'antidepressant' },
  { variants: ['gabapentin', 'neurontin'] },
  { variants: ['prednisone'], category: 'steroid' },
  { variants: ['prednisolone'], category: 'steroid' },
  { variants: ['hydrocortisone'], category: 'steroid' },
  { variants: ['albuterol', 'salbutamol', 'ventolin', 'proair'], category: 'inhaler' },
  { variants: ['montelukast', 'singulair'] },
  { variants: ['amoxicillin', 'amoxil'], category: 'antibiotic' },
  { variants: ['augmentin', 'amoxicillin clavulanate'], category: 'antibiotic' },
  { variants: ['azithromycin', 'zithromax', 'z pack'], category: 'antibiotic' },
  { variants: ['doxycycline'], category: 'antibiotic' },
  { variants: ['cephalexin', 'keflex'], category: 'antibiotic' },
  { variants: ['ciprofloxacin', 'cipro'], category: 'antibiotic' },
  { variants: ['nitrofurantoin', 'macrobid'], category: 'antibiotic' },
  { variants: ['metronidazole', 'flagyl'], category: 'antibiotic' },
  { variants: ['fluconazole', 'diflucan'], category: 'antifungal' },
  { variants: ['valacyclovir', 'valtrex'], category: 'antiviral' },
  { variants: ['acyclovir'], category: 'antiviral' },
  { variants: ['cetirizine', 'zyrtec'], category: 'antihistamine' },
  { variants: ['loratadine', 'claritin'], category: 'antihistamine' },
  { variants: ['diphenhydramine', 'benadryl'], category: 'antihistamine' },
  { variants: ['melatonin'] },
  { variants: ['allopurinol'] },
  { variants: ['colchicine'] },
  { variants: ['methotrexate'] },
  { variants: ['vitamin d'] },
  { variants: ['vitamin b 12', 'b 12'] },
  { variants: ['folic acid'] },
  { variants: ['iron supplement', 'iron pill', 'iron tablet'] },
];

/** Groups of medicines. Supported when the doctor says the group or any medicine in it. */
export const MEDICINE_CATEGORIES: Term[] = [
  { variants: ['antibiotic'] },
  { variants: ['antidepressant'] },
  { variants: ['antihistamine', 'allergy medicine', 'allergy pill'] },
  { variants: ['antiviral'] },
  { variants: ['antifungal'] },
  { variants: ['steroid', 'corticosteroid'] },
  { variants: ['blood thinner', 'anticoagulant'] },
  { variants: ['statin', 'cholesterol medicine', 'cholesterol pill'] },
  { variants: ['beta blocker'] },
  { variants: ['ace inhibitor'] },
  { variants: ['blood pressure medicine', 'blood pressure medication', 'blood pressure pill'] },
  { variants: ['diuretic', 'water pill'] },
  { variants: ['painkiller', 'pain killer', 'pain reliever', 'pain medicine', 'pain medication'] },
  { variants: ['acid reducer', 'antacid'] },
  { variants: ['sleeping pill', 'sleep aid'] },
  { variants: ['inhaler'] },
  { variants: ['birth control', 'contraceptive'] },
  { variants: ['eye drop'] },
  { variants: ['nasal spray'] },
];

/** A medicine in the first group also counts as the second ("lisinopril" supports "blood pressure medicine"). */
export const PARENT_CATEGORIES: Record<string, string> = {
  'ace inhibitor': 'blood pressure medicine',
  'beta blocker': 'blood pressure medicine',
};

/**
 * Drug-name endings. A word of at least 6 letters with one of these endings
 * is treated as a medicine even if it is not in the list above. The value is
 * the group it belongs to, if any.
 */
export const MEDICINE_SUFFIXES: [suffix: string, category: string | null][] = [
  ['statin', 'statin'],
  ['olol', 'beta blocker'],
  ['pril', 'ace inhibitor'],
  ['sartan', 'blood pressure medicine'],
  ['dipine', 'blood pressure medicine'],
  ['cillin', 'antibiotic'],
  ['mycin', 'antibiotic'],
  ['cycline', 'antibiotic'],
  ['floxacin', 'antibiotic'],
  ['prazole', 'acid reducer'],
  ['tidine', 'acid reducer'],
  ['azole', null],
  ['oxetine', 'antidepressant'],
  ['triptan', null],
  ['profen', 'painkiller'],
  ['formin', null],
  ['gliflozin', null],
  ['glutide', null],
  ['gliptin', null],
  ['thiazide', 'diuretic'],
  ['semide', 'diuretic'],
  ['parin', 'blood thinner'],
  ['xaban', 'blood thinner'],
  ['gatran', 'blood thinner'],
  ['olone', 'steroid'],
  ['isone', 'steroid'],
  ['zepam', null],
  ['zolam', null],
  ['apine', null],
  ['lukast', null],
  ['dronate', null],
  ['tropin', null],
  ['mab', null],
  ['nib', null],
  ['vir', 'antiviral'],
];

/** Ordinary words that happen to end like a drug name. */
export const NOT_MEDICINES = new Set([
  'chemistry',
  'imagine',
  'routine',
  'machine',
  'medicine',
  'discipline',
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export const TESTS: Term[] = [
  { variants: ['MRI', 'magnetic resonance'] },
  { variants: ['CT scan', 'ct', 'cat scan'] },
  { variants: ['PET scan'] },
  { variants: ['X-ray', 'xray'] },
  { variants: ['ultrasound', 'sonogram'] },
  { variants: ['echocardiogram', 'echo'] },
  { variants: ['ECG', 'ekg', 'electrocardiogram'] },
  { variants: ['stress test'] },
  { variants: ['blood test', 'blood work', 'bloodwork', 'lab', 'lab work', 'labs', 'blood draw'] },
  { variants: ['urine test', 'urine sample', 'urinalysis'] },
  { variants: ['A1c', 'hemoglobin a1c', 'hba1c'] },
  { variants: ['cholesterol test', 'lipid panel', 'lipid'] },
  { variants: ['thyroid test', 'tsh'] },
  { variants: ['CBC', 'blood count', 'complete blood count'] },
  { variants: ['biopsy'] },
  { variants: ['colonoscopy'] },
  { variants: ['endoscopy'] },
  { variants: ['mammogram'] },
  { variants: ['pap smear', 'pap test'] },
  { variants: ['bone density', 'dexa'] },
  { variants: ['allergy test'] },
  { variants: ['sleep study'] },
  { variants: ['swab', 'culture', 'strep test'] },
  { variants: ['covid test'] },
  { variants: ['pregnancy test'] },
  { variants: ['hearing test'] },
  { variants: ['eye exam'] },
];

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const CONDITIONS: Term[] = [
  { variants: ['diabetes', 'diabetic'] },
  { variants: ['prediabetes', 'pre diabetes', 'prediabetic'] },
  { variants: ['high blood pressure', 'hypertension', 'hypertensive'] },
  { variants: ['low blood pressure', 'hypotension'] },
  { variants: ['high cholesterol', 'hyperlipidemia', 'hypercholesterolemia'] },
  { variants: ['asthma', 'asthmatic'] },
  { variants: ['COPD', 'emphysema'] },
  { variants: ['pneumonia'] },
  { variants: ['bronchitis'] },
  { variants: ['sinusitis', 'sinus infection'] },
  { variants: ['strep throat', 'strep'] },
  { variants: ['flu', 'influenza'] },
  { variants: ['covid', 'coronavirus'] },
  { variants: ['urinary tract infection', 'uti', 'bladder infection'] },
  { variants: ['ear infection', 'otitis'] },
  { variants: ['cancer', 'malignant', 'malignancy', 'tumor', 'tumour', 'carcinoma', 'lymphoma', 'leukemia'] },
  { variants: ['fracture', 'broken bone'] },
  { variants: ['arthritis', 'osteoarthritis', 'rheumatoid'] },
  { variants: ['osteoporosis'] },
  { variants: ['gout'] },
  { variants: ['depression', 'depressed'] },
  { variants: ['anxiety disorder', 'panic disorder', 'generalized anxiety'] },
  { variants: ['ADHD', 'attention deficit'] },
  { variants: ['dementia', 'alzheimer'] },
  { variants: ['migraine'] },
  { variants: ['concussion'] },
  { variants: ['stroke'] },
  { variants: ['heart attack', 'myocardial infarction'] },
  { variants: ['heart failure'] },
  { variants: ['atrial fibrillation', 'afib', 'a fib', 'arrhythmia'] },
  { variants: ['anemia', 'anemic', 'anaemia'] },
  { variants: ['hypothyroidism', 'underactive thyroid'] },
  { variants: ['hyperthyroidism', 'overactive thyroid'] },
  { variants: ['kidney disease', 'renal failure', 'kidney failure'] },
  { variants: ['kidney stone'] },
  { variants: ['liver disease', 'cirrhosis', 'hepatitis', 'fatty liver'] },
  { variants: ['acid reflux', 'reflux', 'gerd', 'heartburn'] },
  { variants: ['irritable bowel', 'ibs'] },
  { variants: ['crohn', 'colitis'] },
  { variants: ['ulcer'] },
  { variants: ['hernia'] },
  { variants: ['appendicitis'] },
  { variants: ['eczema', 'dermatitis'] },
  { variants: ['psoriasis'] },
  { variants: ['sleep apnea', 'apnea'] },
  { variants: ['obesity', 'obese'] },
  { variants: ['sprain', 'sprained'] },
  { variants: ['tendinitis', 'tendonitis'] },
  { variants: ['infection', 'infected'] },
  { variants: ['allergy', 'allergic'] },
  { variants: ['shingles'] },
  { variants: ['lupus'] },
  { variants: ['multiple sclerosis'] },
  { variants: ['epilepsy', 'seizure'] },
  { variants: ['glaucoma'] },
  { variants: ['cataract'] },
];

// ---------------------------------------------------------------------------
// Advice and instructions
// ---------------------------------------------------------------------------

/** Phrases that tell the patient what to do (matched on normalized text). */
export const ADVICE_PATTERN =
  /\b(you should|should|consider|try|it s best|it is best|best to|recommend|recommended|make sure|be sure|avoid|don t|do not|need to|needs to|have to|has to|must|remember to|it would help|it may help|it might help|it can help|ought to|want to)\b/;

/** Verbs that, at the start of an item, make it an instruction ("Take…", "Avoid…"). */
export const IMPERATIVE_VERBS = new Set([
  'take',
  'avoid',
  'eat',
  'drink',
  'exercise',
  'get',
  'call',
  'book',
  'schedule',
  'keep',
  'stop',
  'start',
  'use',
  'try',
  'rest',
  'limit',
  'reduce',
  'increase',
  'decrease',
  'cut',
  'walk',
  'come',
  'go',
  'see',
  'make',
  'check',
  'apply',
  'continue',
  'lose',
  'quit',
  'sleep',
  'wear',
  'ice',
  'elevate',
  'monitor',
  'watch',
  'follow',
  'return',
  'pick',
  'fill',
  'bring',
  'ask',
  'tell',
  'let',
  'skip',
  'switch',
  'change',
]);

/** Phrases in the doctor's words that show an instruction or a plan. */
export const INSTRUCTION_PATTERN =
  /\b(want you to|like you to|let s|we ll|we will|we re going to|we are going to|i m going to|i am going to|i ll|i will|you ll|you will|going to|gonna|please|come back|follow up|see you|next time|next visit|appointment|again|schedule|book|refer|referral|order|ordering|prescrib\w*|send you|start you|put you on|keep taking|continue|plan|in \d+(\.\d+)? (day|week|month|year)s?)\b/;
