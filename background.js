// background.js (追従スクロールの設定保存/読み込み機能を追加)

import { 
    DEFAULT_SPEAKERS, 
    DEFAULT_SELECTORS, 
    DEFAULT_TRIM_SETTINGS,
    DEFAULT_SEPARATION_SETTINGS
} from './defaults.js';

// --- グローバル状態（バックグラウンド） ---
let currentJobId = null;

const ENGINES = {
    'aivis': { 
        name: 'Aivis',
        url: 'http://127.0.0.1:10101'
    },
    'voicevox': {
        name: 'VOICEVOX',
        url: 'http://127.0.0.1:50021'
    }
};

chrome.action.onClicked.addListener((tab) => {
    if (tab.url && (tab.url.startsWith("http") || tab.url.startsWith("https"))) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content_ui.js', 'content.js']
        });
    } else {
        console.log("Cannot inject script on this URL:", tab.url);
    }
});

const STORAGE_KEY_SPEAKERS = "my-speech-gui-speakers";
const STORAGE_KEY_SELECTORS = "my-speech-gui-selectors";
const STORAGE_KEY_LAST_SPEAKER = "my-speech-gui-last-speaker";
const STORAGE_KEY_LAST_SELECTOR = "my-speech-gui-last-selector";
const STORAGE_KEY_LAST_PARAMS = "my-speech-gui-last-params";
const STORAGE_KEY_SEPARATION = "my-speech-gui-separation-settings";
const STORAGE_KEY_TRIM_SETTINGS = "my-speech-gui-trim-settings";
const STORAGE_KEY_RUBY_PROCESSING = "my-speech-gui-ruby-processing";
const STORAGE_KEY_GET_ALL_TEXT = "my-speech-gui-get-all-text";
const STORAGE_KEY_IS_SIMPLE_MODE = "my-speech-gui-is-simple-mode";
const STORAGE_KEY_SCROLL_TO_HIGHLIGHT = "my-speech-gui-scroll-to-highlight";

// --- ヘルパー関数 ---
function blobToDataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
function splitText(text) { const sentences = text.split(/([。！？\n])/g); const result = []; for (let i = 0; i < sentences.length; i += 2) { const sentencePart = sentences[i]; const delimiter = sentences[i + 1] || ''; if (sentencePart || delimiter.trim()) { result.push((sentencePart + delimiter).trim()); } } return result.filter(s => s); }
function trimEndChars(text, trimStrings) { let trimmedText = text; let wasTrimmed = true; while (wasTrimmed) { wasTrimmed = false; for (const str of trimStrings) { if (trimmedText.endsWith(str)) { trimmedText = trimmedText.slice(0, -str.length); wasTrimmed = true; } } } return trimmedText; }

// --- API通信 ---
async function checkAllServerStatus() {
    const statusPromises = Object.entries(ENGINES).map(async ([engineId, engineConfig]) => {
        try {
            const response = await fetch(`${engineConfig.url}/speakers`, { signal: AbortSignal.timeout(1500) });
            if (response.ok) { return { engine: engineId, name: engineConfig.name, status: "running", message: "起動中" }; }
            else { return { engine: engineId, name: engineConfig.name, status: "stopped", message: "停止中" }; }
        } catch (error) { return { engine: engineId, name: engineConfig.name, status: "error", message: "接続エラー" }; }
    });
    return Promise.all(statusPromises);
}
async function generateAudioDataUrl(text, speakerId, params, speakerList) {
    const speaker = speakerList.find(s => s.id === speakerId);
    if (!speaker) { console.error(`Speaker with ID ${speakerId} not found.`); return null; }
    const engineUrl = ENGINES[speaker.engine]?.url;
    if (!engineUrl) { console.error(`Engine URL for engine "${speaker.engine}" not found.`); return null; }
    try {
        const queryResponse = await fetch(`${engineUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!queryResponse.ok) throw new Error(`audio_query失敗: ${queryResponse.status} for engine ${speaker.engine}`);
        const audioQuery = await queryResponse.json();
        Object.assign(audioQuery, { speedScale: parseFloat(params.speed), pitchScale: parseFloat(params.pitch), volumeScale: parseFloat(params.volume), intonationScale: parseFloat(params.intonation), prePhonemeLength: parseFloat(params.pre), postPhonemeLength: parseFloat(params.post) });
        const synthResponse = await fetch(`${engineUrl}/synthesis?speaker=${speakerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audioQuery) });
        if (!synthResponse.ok) throw new Error(`synthesis失敗: ${synthResponse.status} for engine ${speaker.engine}`);
        const blob = await synthResponse.blob();
        return await blobToDataURL(blob);
    } catch (error) { console.error("音声生成エラー:", error); return null; }
}
async function fetchAllSpeakersFromEngines() {
    const fetchPromises = Object.entries(ENGINES).map(async ([engineId, config]) => {
        try {
            const response = await fetch(`${config.url}/speakers`, { signal: AbortSignal.timeout(5000) });
            if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
            const data = await response.json();
            return data.flatMap(character => character.styles.map(style => ({ name: `${character.name}（${style.name}）`, id: String(style.id), engine: engineId })));
        } catch (error) { console.warn(`Could not fetch speakers from ${config.name}. It might be offline.`, error.message); return []; }
    });
    const results = await Promise.all(fetchPromises);
    return results.flat();
}
function processTextForSeparation(text, defaultSpeakerId, rules, readTriggerEnabled) { const microChunks = []; const sortedRules = [...rules].sort((a, b) => b.trigger.length - a.trigger.length); const lines = text.replace(/\r\n|\r/g, '\n').split('\n'); for (const line of lines) { let remainingLine = line; while (remainingLine) { let bestMatch = null; for (const rule of sortedRules) { const index = remainingLine.indexOf(rule.trigger); if (index !== -1 && (!bestMatch || index < bestMatch.index)) { bestMatch = { rule, index }; } } if (bestMatch) { const beforeText = remainingLine.substring(0, bestMatch.index); if (beforeText) { microChunks.push({ text: beforeText, speakerId: defaultSpeakerId }); } if (readTriggerEnabled) { microChunks.push({ text: bestMatch.rule.trigger, speakerId: defaultSpeakerId }); } remainingLine = remainingLine.substring(bestMatch.index + bestMatch.rule.trigger.length); if (remainingLine) { let nextSpeakerId = bestMatch.rule.speakerId; let nextMatch = null; for (const rule of sortedRules) { const index = remainingLine.indexOf(rule.trigger); if (index !== -1 && (!nextMatch || index < nextMatch.index)) { nextMatch = { rule, index }; } } if(nextMatch) { const dialogue = remainingLine.substring(0, nextMatch.index); if (dialogue) { microChunks.push({ text: dialogue, speakerId: nextSpeakerId }); } remainingLine = remainingLine.substring(nextMatch.index); } else { microChunks.push({ text: remainingLine, speakerId: nextSpeakerId }); remainingLine = ""; } } } else { if(remainingLine) microChunks.push({ text: remainingLine, speakerId: defaultSpeakerId }); break; } } microChunks.push({ text: '\n', speakerId: defaultSpeakerId }); } if (microChunks.length > 0 && microChunks[microChunks.length - 1].text === '\n') { microChunks.pop(); } if (microChunks.length === 0) return []; const mergedChunks = [ { text: microChunks[0].text, speakerId: microChunks[0].speakerId } ]; for (let i = 1; i < microChunks.length; i++) { const lastChunk = mergedChunks[mergedChunks.length - 1]; const currentChunk = microChunks[i]; if (currentChunk.speakerId === lastChunk.speakerId) { lastChunk.text += currentChunk.text; } else { mergedChunks.push({ text: currentChunk.text, speakerId: currentChunk.speakerId }); } } return mergedChunks.filter(chunk => chunk.text.trim() !== ''); }

// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let isAsync = true;
    switch (request.action) {
        case 'getEngineSettings': chrome.tabs.sendMessage(sender.tab.id, { type: 'ENGINE_SETTINGS', data: ENGINES }); isAsync = false; break;
        case 'checkServerStatus': checkAllServerStatus().then(sendResponse); break;
        case 'fetchAndSyncSpeakers': (async () => { try { const apiSpeakers = await fetchAllSpeakersFromEngines(); if (apiSpeakers.length === 0) { throw new Error("起動中の音声合成エンジンから話者情報を取得できませんでした。"); } const storageResult = await chrome.storage.local.get([STORAGE_KEY_SPEAKERS]); let existingSpeakers = storageResult[STORAGE_KEY_SPEAKERS] || []; const existingSpeakersMap = new Map(existingSpeakers.map(s => [`${s.id}@${s.engine}`, s])); apiSpeakers.forEach(apiSpeaker => { const key = `${apiSpeaker.id}@${apiSpeaker.engine}`; if (!existingSpeakersMap.has(key)) { existingSpeakers.push(apiSpeaker); } }); await chrome.storage.local.set({ [STORAGE_KEY_SPEAKERS]: existingSpeakers }); sendResponse(existingSpeakers); } catch (error) { console.error("Error during fetchAndSyncSpeakers:", error); sendResponse({ error: error.message }); } })(); break;
        
        case 'loadSpeakers': 
            chrome.storage.local.get([STORAGE_KEY_SPEAKERS], (result) => { 
                if (result[STORAGE_KEY_SPEAKERS]) { 
                    const speakers = result[STORAGE_KEY_SPEAKERS]; 
                    let needsMigration = false; 
                    const migratedSpeakers = speakers.map(speaker => { 
                        if (!speaker.engine) { 
                            needsMigration = true; 
                            return { ...speaker, engine: 'aivis' }; 
                        } 
                        return speaker; 
                    }); 
                    if (needsMigration) { 
                        chrome.storage.local.set({ [STORAGE_KEY_SPEAKERS]: migratedSpeakers }, () => { 
                            sendResponse(migratedSpeakers); 
                        }); 
                    } else { 
                        sendResponse(speakers); 
                    } 
                } else { 
                    chrome.storage.local.set({ [STORAGE_KEY_SPEAKERS]: DEFAULT_SPEAKERS }, () => sendResponse(DEFAULT_SPEAKERS));
                } 
            }); 
            break;
        
        case 'saveSpeakers': chrome.storage.local.set({ [STORAGE_KEY_SPEAKERS]: request.data }, () => sendResponse({ success: true })); break;
        
        case 'loadSelectors':
            chrome.storage.local.get([STORAGE_KEY_SELECTORS], (result) => {
                if (result[STORAGE_KEY_SELECTORS]) {
                    sendResponse(result[STORAGE_KEY_SELECTORS]);
                } else {
                    chrome.storage.local.set({ [STORAGE_KEY_SELECTORS]: DEFAULT_SELECTORS }, () => sendResponse(DEFAULT_SELECTORS));
                }
            });
            break;

        case 'saveSelectors': chrome.storage.local.set({ [STORAGE_KEY_SELECTORS]: request.data }, () => sendResponse({ success: true })); break;
        
        case 'loadLastSettings':
            chrome.storage.local.get([
                STORAGE_KEY_LAST_SPEAKER, 
                STORAGE_KEY_LAST_SELECTOR, 
                STORAGE_KEY_LAST_PARAMS,
                STORAGE_KEY_RUBY_PROCESSING,
                STORAGE_KEY_GET_ALL_TEXT,
                STORAGE_KEY_IS_SIMPLE_MODE,
                STORAGE_KEY_SCROLL_TO_HIGHLIGHT
            ], (result) => { 
                sendResponse(result || {}); 
            }); 
            break;

        case 'saveLastSpeaker': chrome.storage.local.set({ [STORAGE_KEY_LAST_SPEAKER]: request.data }); isAsync = false; break;
        case 'saveLastSelector': chrome.storage.local.set({ [STORAGE_KEY_LAST_SELECTOR]: request.data }); isAsync = false; break;
        case 'saveLastParams': chrome.storage.local.set({ [STORAGE_KEY_LAST_PARAMS]: request.data }); isAsync = false; break;
        
        case 'loadSeparationSettings': 
            chrome.storage.local.get([STORAGE_KEY_SEPARATION], (result) => { 
                if (result[STORAGE_KEY_SEPARATION]) { 
                    sendResponse(result[STORAGE_KEY_SEPARATION]); 
                } else { 
                    sendResponse(DEFAULT_SEPARATION_SETTINGS);
                } 
            }); 
            break;
        
        case 'saveSeparationSettings': chrome.storage.local.set({ [STORAGE_KEY_SEPARATION]: request.data }, () => { sendResponse({ success: true }); }); break;
        
        case 'loadTrimSettings':
            chrome.storage.local.get([STORAGE_KEY_TRIM_SETTINGS], (result) => {
                if (result[STORAGE_KEY_TRIM_SETTINGS]) {
                    sendResponse(result[STORAGE_KEY_TRIM_SETTINGS]);
                } else {
                    sendResponse(DEFAULT_TRIM_SETTINGS);
                }
            });
            break;

        case 'saveTrimSettings': chrome.storage.local.set({ [STORAGE_KEY_TRIM_SETTINGS]: request.data }, () => { sendResponse({ success: true }); }); break;
        case 'saveRubyProcessingSetting': chrome.storage.local.set({ [STORAGE_KEY_RUBY_PROCESSING]: request.data }); isAsync = false; break;
        case 'loadRubyProcessingSetting': chrome.storage.local.get([STORAGE_KEY_RUBY_PROCESSING], (result) => { sendResponse(result[STORAGE_KEY_RUBY_PROCESSING] === undefined ? false : result[STORAGE_KEY_RUBY_PROCESSING]); }); break;
        case 'saveGetAllText': chrome.storage.local.set({ [STORAGE_KEY_GET_ALL_TEXT]: request.data }); isAsync = false; break;
        case 'loadGetAllText': chrome.storage.local.get([STORAGE_KEY_GET_ALL_TEXT], (result) => { sendResponse(result[STORAGE_KEY_GET_ALL_TEXT] === undefined ? false : result[STORAGE_KEY_GET_ALL_TEXT]); }); break;
        case 'saveIsSimpleMode': chrome.storage.local.set({ [STORAGE_KEY_IS_SIMPLE_MODE]: request.data }); isAsync = false; break;
        case 'loadIsSimpleMode': chrome.storage.local.get([STORAGE_KEY_IS_SIMPLE_MODE], (result) => { sendResponse(result[STORAGE_KEY_IS_SIMPLE_MODE] === undefined ? false : result[STORAGE_KEY_IS_SIMPLE_MODE]); }); break;
        
        case 'saveScrollToHighlight':
            chrome.storage.local.set({ [STORAGE_KEY_SCROLL_TO_HIGHLIGHT]: request.data });
            isAsync = false;
            break;
        
        case 'stopReading': currentJobId = null; isAsync = false; break;

        case 'processAndGenerateAudioFromList':
            (async () => {
                try {
                    const jobId = Date.now();
                    currentJobId = jobId;
                    const { payload, params } = request;
                    const tabId = sender.tab.id;

                    const data = await chrome.storage.local.get([STORAGE_KEY_SPEAKERS]);
                    const speakerList = data[STORAGE_KEY_SPEAKERS] || [];
                    
                    if (!payload || payload.length === 0) {
                        await chrome.tabs.sendMessage(tabId, { type: 'READING_COMPLETE' }).catch(e => console.log(e));
                        sendResponse({ success: true, status: 'empty_payload' });
                        return;
                    }

                    const trimSettingsResult = await chrome.storage.local.get([STORAGE_KEY_TRIM_SETTINGS]);
                    const trimSettings = trimSettingsResult[STORAGE_KEY_TRIM_SETTINGS] || { enabled: true, trimStrings: "" };
                    const trimStrings = (trimSettings.enabled && trimSettings.trimStrings) ? trimSettings.trimStrings.split('\n').filter(s => s) : [];

                    for (let i = 0; i < payload.length; i++) {
                        if (currentJobId !== jobId) {
                            console.log("Audio generation job cancelled.");
                            break;
                        }
                        let item = payload[i];
                        const isLast = (i === payload.length - 1);

                        if (trimStrings.length > 0) {
                            // 1. まず末尾の文字を削除する
                            item.text = trimEndChars(item.text, trimStrings);

                            // ▼▼▼ [ここから修正] 2. 次に、テキスト全体が除外文字そのものでないかチェックする ▼▼▼
                            if (trimStrings.includes(item.text.trim())) {
                                item.text = ""; // テキストが除外文字そのものだった場合、空にする
                            }
                            // ▲▲▲ [修正はここまで] ▲▲▲
                        }

                        if (!item.text.trim()) {
                            if (isLast) {
                                 await chrome.tabs.sendMessage(tabId, { type: 'READING_COMPLETE' }).catch(e => console.log(e));
                            }
                            continue;
                        }

                        await chrome.tabs.sendMessage(tabId, { type: 'UPDATE_STATUS', text: `音声生成中: ${item.text.substring(0, 30)}...` }).catch(e => console.log(e));
                        if (currentJobId !== jobId) break;

                        const audioDataUrl = await generateAudioDataUrl(item.text, item.speakerId, params, speakerList);
                        if (currentJobId !== jobId) break;

                        if (audioDataUrl) {
                            await chrome.tabs.sendMessage(tabId, { type: 'PLAY_AUDIO', audioUrl: audioDataUrl, isLast }).catch(e => console.log(e));
                        } else {
                            await chrome.tabs.sendMessage(tabId, { type: 'GENERATION_ERROR', error: `「${item.text.substring(0, 10)}...」の生成失敗`, isLast }).catch(e => console.log(e));
                        }
                    }
                    
                    const wasCancelled = currentJobId !== jobId;
                    const hasPlayableAudio = payload.some(item => item.text.trim());
                    if (!wasCancelled && !hasPlayableAudio) {
                        await chrome.tabs.sendMessage(tabId, { type: 'READING_COMPLETE' }).catch(e => console.log(e));
                    }
                    
                    sendResponse({ success: true, status: wasCancelled ? 'cancelled' : 'completed' });

                } catch (error) {
                    console.error("Error in processAndGenerateAudioFromList:", error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            break;

        default:
            isAsync = false;
            break;
    }
    return isAsync;
});