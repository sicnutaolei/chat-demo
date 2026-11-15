declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** 运行时配置，见 public/config.js；优先于 __API_ORIGIN__ */
interface Window {
  __CHAT_API_ORIGIN__?: string
  /** 运行时模型覆盖，见 public/config.js */
  __CHAT_MODEL__?: string
  /** 运行时占位 Key（密钥由反代注入时使用），见 public/config.js */
  __CHAT_KEY__?: string
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
