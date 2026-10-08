import { MODEL_ANALYSIS_ENABLED } from './edition'

export const LOCAL_ANALYSIS_ONLY_MESSAGE = '本版本仅提供本地分析，云模型接入已关闭。'

export function requireModelAnalysis(): void {
  if (!MODEL_ANALYSIS_ENABLED) throw Error(LOCAL_ANALYSIS_ONLY_MESSAGE)
}
