import { useState, useEffect } from 'react';
import { ModelInfo, useLive2DConfig } from '@/context/live2d-config-context';
import { useWebSocket } from '@/context/websocket-context';
import {
  getLive2DAppearanceModel,
  getStoredLive2DAppearance,
  Live2DAppearanceId,
  setStoredLive2DAppearance,
} from '@/utils/live2d-appearances';

export const useLive2dSettings = () => {
  const Live2DConfigContext = useLive2DConfig();
  const { baseUrl } = useWebSocket();

  const initialModelInfo: ModelInfo = {
    url: '',
    kScale: 0.5,
    initialXshift: 0,
    initialYshift: 0,
    emotionMap: {},
    scrollToResize: true,
  };

  const [modelInfo, setModelInfoState] = useState<ModelInfo>(
    Live2DConfigContext?.modelInfo || initialModelInfo,
  );
  const [originalModelInfo, setOriginalModelInfo] = useState<ModelInfo>(
    Live2DConfigContext?.modelInfo || initialModelInfo,
  );
  const [appearance, setAppearance] = useState<Live2DAppearanceId>(
    getStoredLive2DAppearance() || 'mao_pro',
  );
  const [originalAppearance, setOriginalAppearance] = useState<Live2DAppearanceId>(appearance);

  useEffect(() => {
    if (Live2DConfigContext?.modelInfo) {
      if (JSON.stringify(Live2DConfigContext.modelInfo) !== JSON.stringify(originalModelInfo)) {
        setOriginalModelInfo(Live2DConfigContext.modelInfo);
        setModelInfoState(Live2DConfigContext.modelInfo);
      }
    }
  }, [Live2DConfigContext?.modelInfo]);

  useEffect(() => {
    if (Live2DConfigContext && modelInfo) {
      Live2DConfigContext.setModelInfo(modelInfo);
    }
  }, [modelInfo.pointerInteractive, modelInfo.scrollToResize]);

  const handleInputChange = (key: keyof ModelInfo, value: ModelInfo[keyof ModelInfo]): void => {
    setModelInfoState((prev) => ({ ...prev, [key]: value }));
  };

  const handleAppearanceChange = (nextAppearance: Live2DAppearanceId): void => {
    const nextModel = getLive2DAppearanceModel(nextAppearance, baseUrl);
    const nextModelWithPreferences = {
      ...nextModel,
      pointerInteractive: modelInfo.pointerInteractive ?? true,
      scrollToResize: modelInfo.scrollToResize ?? true,
    };

    setAppearance(nextAppearance);
    setStoredLive2DAppearance(nextAppearance);
    setModelInfoState(nextModelWithPreferences);
    Live2DConfigContext.setModelInfo(nextModelWithPreferences);
  };

  const handleSave = (): void => {
    if (Live2DConfigContext && modelInfo) {
      setOriginalModelInfo(modelInfo);
      setOriginalAppearance(appearance);
    }
  };

  const handleCancel = (): void => {
    setModelInfoState(originalModelInfo);
    setAppearance(originalAppearance);
    setStoredLive2DAppearance(originalAppearance);
    if (Live2DConfigContext && originalModelInfo) {
      Live2DConfigContext.setModelInfo(originalModelInfo);
    }
  };

  return {
    modelInfo,
    appearance,
    handleInputChange,
    handleAppearanceChange,
    handleSave,
    handleCancel,
  };
};
