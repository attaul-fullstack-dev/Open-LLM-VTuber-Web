import type { ModelInfo } from '@/context/live2d-config-context';

export const LIVE2D_APPEARANCE_STORAGE_KEY = 'live2dAppearanceId';

export type Live2DAppearanceId = 'mao_pro' | 'shizuku';

interface Live2DAppearanceDefinition {
  id: Live2DAppearanceId;
  modelInfo: Omit<ModelInfo, 'url'> & { url: string };
}

const LIVE2D_APPEARANCES: Record<Live2DAppearanceId, Live2DAppearanceDefinition> = {
  mao_pro: {
    id: 'mao_pro',
    modelInfo: {
      name: 'mao_pro',
      description: 'Mili default appearance',
      url: '/live2d-models/mao_pro/runtime/mao_pro.model3.json',
      kScale: 0.5,
      initialXshift: 0,
      initialYshift: 0,
      idleMotionGroupName: 'Idle',
      emotionMap: {
        neutral: 0,
        anger: 2,
        disgust: 2,
        fear: 1,
        joy: 3,
        smirk: 3,
        sadness: 1,
        surprise: 3,
      },
      tapMotions: {
        HitAreaHead: { '': 1 },
        HitAreaBody: { '': 1 },
      },
    },
  },
  shizuku: {
    id: 'shizuku',
    modelInfo: {
      name: 'shizuku',
      description: 'Mili alternate appearance',
      url: '/live2d-models/shizuku/runtime/shizuku.model3.json',
      kScale: 0.5,
      initialXshift: 0,
      initialYshift: 0,
      idleMotionGroupName: 'idle',
      emotionMap: {
        neutral: 0,
        anger: 2,
        disgust: 2,
        fear: 1,
        joy: 3,
        smirk: 3,
        sadness: 1,
        surprise: 3,
      },
    },
  },
};

export function isLive2DAppearanceId(value: string | null): value is Live2DAppearanceId {
  return value === 'mao_pro' || value === 'shizuku';
}

export function getStoredLive2DAppearance(): Live2DAppearanceId | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const value = window.localStorage.getItem(LIVE2D_APPEARANCE_STORAGE_KEY);
    return isLive2DAppearanceId(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setStoredLive2DAppearance(appearance: Live2DAppearanceId): void {
  window.localStorage.setItem(LIVE2D_APPEARANCE_STORAGE_KEY, appearance);
}

/**
 * Build a browser-ready model descriptor from a stable built-in definition.
 * The explicit base scale prevents mobile scaling from compounding after a
 * settings save or reconnect.
 */
export function getLive2DAppearanceModel(
  appearance: Live2DAppearanceId,
  baseUrl: string,
): ModelInfo {
  const definition = LIVE2D_APPEARANCES[appearance].modelInfo;
  const origin = baseUrl || window.location.origin;

  return {
    ...definition,
    url: new URL(definition.url, origin).toString(),
    baseKScale: definition.kScale,
  };
}
