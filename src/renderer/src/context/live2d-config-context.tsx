import {
  createContext, useContext, useState, useMemo,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useConfig } from '@/context/character-config-context';

/**
 * Model emotion mapping interface
 * @interface EmotionMap
 */
interface EmotionMap {
  [key: string]: number | string;
}

/**
 * Motion weight mapping interface
 * @interface MotionWeightMap
 */
export interface MotionWeightMap {
  [key: string]: number;
}

/**
 * Tap motion mapping interface
 * @interface TapMotionMap
 */
export interface TapMotionMap {
  [key: string]: MotionWeightMap;
}

/**
 * Live2D model information interface
 * @interface ModelInfo
 */
export interface ModelInfo {
  /** Model name */
  name?: string;

  /** Model description */
  description?: string;

  /** Model URL */
  url: string;

  /** Scale factor */
  kScale: number;

  /** Unscaled model factor used to keep mobile scale adjustments idempotent. */
  baseKScale?: number;

  /** Initial X position shift */
  initialXshift: number;

  /** Initial Y position shift */
  initialYshift: number;

  /** Idle motion group name */
  idleMotionGroupName?: string;

  /** Default emotion */
  defaultEmotion?: number | string;

  /** Emotion mapping configuration */
  emotionMap: EmotionMap;

  /** Enable pointer interactivity */
  pointerInteractive?: boolean;

  /** Tap motion mapping configuration */
  tapMotions?: TapMotionMap;

  /** Enable scroll to resize */
  scrollToResize?: boolean;

  /** Initial scale */
  initialScale?: number;
}

/**
 * Live2D configuration context state interface
 * @interface Live2DConfigState
 */
interface Live2DConfigState {
  modelInfo?: ModelInfo;
  setModelInfo: (info: ModelInfo | undefined) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

/**
 * Default values and constants
 */
const DEFAULT_CONFIG = {
  modelInfo: undefined as ModelInfo | undefined,
  isLoading: false,
};

/**
 * Create the Live2D configuration context
 */
export const Live2DConfigContext = createContext<Live2DConfigState | null>(null);

/**
 * Live2D Configuration Provider Component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function Live2DConfigProvider({ children }: { children: React.ReactNode }) {
  const { confUid } = useConfig();

  const [isLoading, setIsLoading] = useState(DEFAULT_CONFIG.isLoading);

  const [modelInfo, setModelInfoState] = useLocalStorage<ModelInfo | undefined>(
    "modelInfo",
    DEFAULT_CONFIG.modelInfo,
    {
      filter: (value) => (value ? { ...value, url: "" } : value),
    },
  );

  // Old builds could persist a partial object without a model URL. Treat it as
  // unset so the Live2D SDK never constructs "undefined/undefined.model3.json".
  const validModelInfo = modelInfo?.url ? modelInfo : undefined;

  // const [modelInfo, setModelInfoState] = useState<ModelInfo | undefined>(DEFAULT_CONFIG.modelInfo);

  const setModelInfo = (info: ModelInfo | undefined) => {
    if (!info?.url) {
      setModelInfoState(undefined);
      return;
    }

    // Apply the mobile adjustment only from an explicit base scale. This avoids
    // compounding the scale when a settings change reuses the current model.
    const mobileScaleFactor = window.innerWidth < 768 ? 1.45 : 2;
    const baseKScale = Number(info.baseKScale ?? info.kScale ?? 0.5);
    const finalScale = baseKScale * mobileScaleFactor;
    console.log("Setting model info with default scale:", finalScale);

    setModelInfoState({
      ...info,
      kScale: finalScale,
      baseKScale,
      pointerInteractive:
        "pointerInteractive" in info
          ? info.pointerInteractive
          : (validModelInfo?.pointerInteractive ?? true),
      scrollToResize:
        "scrollToResize" in info
          ? info.scrollToResize
          : (validModelInfo?.scrollToResize ?? true),
    });
  };

  const contextValue = useMemo(
    () => ({
      modelInfo: validModelInfo,
      setModelInfo,
      isLoading,
      setIsLoading,
    }),
    [validModelInfo, isLoading, setIsLoading],
  );

  return (
    <Live2DConfigContext.Provider value={contextValue}>
      {children}
    </Live2DConfigContext.Provider>
  );
}

/**
 * Custom hook to use the Live2D configuration context
 * @throws {Error} If used outside of Live2DConfigProvider
 */
export function useLive2DConfig() {
  const context = useContext(Live2DConfigContext);

  if (!context) {
    throw new Error('useLive2DConfig must be used within a Live2DConfigProvider');
  }

  return context;
}

// Export the provider as default
export default Live2DConfigProvider;
