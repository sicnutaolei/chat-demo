import { MODEL_OVERRIDE } from './api/client.js'
import { useSettings } from './settings.js'

/** 内置默认模型（DeepSeek 官方 id，同时支持深度思考与图片输入） */
export const DEFAULT_MODEL = 'deepseek-flash'
/** config.js 里 __CHAT_MODEL__ 指定的部署默认，没有则为空 */
export const DEPLOY_MODEL = MODEL_OVERRIDE

/**
 * 当前生效的模型 id，优先级：
 * 设置里选的 > config.js 的部署默认 > 内置默认
 */
export const resolveModel = (): string =>
  useSettings.getState().model || DEPLOY_MODEL || DEFAULT_MODEL
