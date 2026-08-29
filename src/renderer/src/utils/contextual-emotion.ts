/**
 * Mili Hidup Stage 4 — Contextual Emotion → Avatar.
 *
 * Pure, deterministic mapping from a response emotion LABEL (as emitted by the
 * backend emotion-markup extractor) to a Stage 3 *semantic facial state id*.
 *
 * The final Stage 3 palette is the single visual vocabulary; Stage 4 never
 * defines its own parameter sets. It only translates the conversation's
 * response emotion into one of the palette's faces, which the Stage 3
 * controller then interpolates/applies.
 *
 * Real backend labels (mao_pro `emotionMap` keys, lower-cased): neutral, anger,
 * disgust, fear, joy, smirk, sadness, surprise.
 */
export type ResponseEmotion =
  | 'neutral'
  | 'anger'
  | 'disgust'
  | 'fear'
  | 'joy'
  | 'smirk'
  | 'sadness'
  | 'surprise';
export type FaceId = string;

/**
 * Backend response-emotion label → Stage 3 semantic face id.
 *
 * - joy            -> small_smile   (soft/happy response)
 * - smirk          -> squint_smile  (playful/mischievous response)
 * - sadness        -> sad_soft      (concerned/sad response)
 * - anger          -> angry_pout    (firmly annoyed/mad response)
 * - disgust        -> pout_small    (mild displeasure; the rig can't do a
 *                                    real "yuck" face, this reads as ngambek)
 * - neutral        -> neutral
 * - fear / surprise -> neutral     (the rig's Stage 3 params cannot represent
 *                                    fear or surprise safely — documented as a
 *                                    rig limitation; mapping them to a smile or
 *                                    to sad would be an actively WRONG face)
 */
export const CONTEXTUAL_EMOTION_MAP: Record<ResponseEmotion, string> = {
  neutral: 'neutral',
  joy: 'small_smile',
  smirk: 'squint_smile',
  sadness: 'sad_soft',
  anger: 'angry_pout',
  disgust: 'pout_small',
  fear: 'neutral',
  surprise: 'neutral',
};

/**
 * Legacy fallback: decode the OLD transport form (an ma0_pro preset-index) into
 * a Stage 3 face id. Only used when the backend did not send a semantic label
 * (very likely lossy: sadness/fear share index 1, joy/smirk/surprise share 3),
 * so mappings here are deliberately conservative — anything ambiguous => neutral.
 */
const INDEX_TO_FACE: Record<number, string> = {
  0: 'neutral',
  1: 'sad_soft',
  2: 'angry_pout',
  3: 'squint_smile',
};

/** Map a raw response-emotion label to a Stage 3 face id. Unknown => neutral. */
export function mapEmotionLabelToFaceId(rawLabel: string | null | undefined): string {
  const key = (rawLabel ?? '').trim().toLowerCase() as ResponseEmotion;
  return CONTEXTUAL_EMOTION_MAP[key] ?? 'neutral';
}

/** Map a legacy preset-index expression to a Stage 3 face id. Unknown => neutral. */
export function decodeExpressionIndexToFaceId(index: string | number | null | undefined): string {
  const n = typeof index === 'number' ? index : Number.parseInt(String(index ?? ''), 10);
  if (Number.isNaN(n)) return 'neutral';
  return INDEX_TO_FACE[n] ?? 'neutral';
}

/** Pick the single face id to use for a response, preferring semantic labels. */
export function resolveResponseFaceId(opts: {
  emotions?: (string | null)[] | null;
  expressions?: (string | number | null)[] | null;
}): string {
  const firstLabel = opts.emotions?.find((e) => typeof e === 'string' && e.trim());
  if (firstLabel) return mapEmotionLabelToFaceId(firstLabel);
  const firstIndex = opts.expressions?.find((e) => e !== null && e !== undefined);
  if (firstIndex !== undefined && firstIndex !== null) {
    return decodeExpressionIndexToFaceId(firstIndex);
  }
  return 'neutral';
}