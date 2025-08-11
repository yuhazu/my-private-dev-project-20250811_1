// defaults.js (初期設定データ)

/**
 * デフォルトの話者リスト
 * 拡張機能を初めて使用する際に、ストレージに保存される初期の話者です。
 */
export const DEFAULT_SPEAKERS = [
    { name: "Anneli (ノーマル)", id: "888753760", engine: 'aivis' },
    { name: "四国めたん（あまあま）", id: "0", engine: 'voicevox' }
];

/**
 * デフォルトのCSSセレクタリスト
 * 一般的なウェブサイトの読み上げ対象を初期設定として提供します。
 */
export const DEFAULT_SELECTORS = [
    { name: "GeminiPWA", selector: ".message.model .message-content" },
    { name: "Google AI Studio", selector: "div.model-prompt-container" },
    { name: "Perplexity", selector: ".prose" },
    { name: "小説家になろう", selector: ".p-novel__text" },
    { name: "カクヨム", selector: ".widget-episodeBody" }
];

/**
 * デフォルトの末尾除外（ノイズ対策）設定
 * 読み上げ時に不要となりやすい文末の記号などを初期設定として定義します。
 */
export const DEFAULT_TRIM_SETTINGS = {
    enabled: true,
    trimStrings: "」\n「\n）\n（\n)\n(\n】\n【\n］\n[\n｝\n｛"
};

/**
 * デフォルトの話者分離設定
 * 初期状態では話者分離は無効になっています。
 */
export const DEFAULT_SEPARATION_SETTINGS = {
    enabled: false,
    readTriggerEnabled: true,
    rules: []
};