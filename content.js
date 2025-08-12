// content.js (ロジック・統括担当)

'use strict';

// 即時実行関数でグローバルスコープの汚染を防ぐ
(() => {
    // この拡張機能が既に挿入済みなら何もしない
    if (window.mySpeechExtensionInstance) { return; }

    // -----------------------------------------------------------------
    // 1. 状態管理 (State Management)
    // -----------------------------------------------------------------
    let speakerList = [];
    let selectorList = [];
    let currentSpeakerId = null;
    let selectedEngineId = 'aivis';
    let separationSettings = { enabled: false, readTriggerEnabled: false, rules: [] };
    let trimSettings = { enabled: false, trimStrings: "" };
    let rubyProcessingEnabled = true;
    let scrollToHighlightEnabled = false;
    let autoReadEnabled = false;
    let getAllTextEnabled = false;
    let isSimpleMode = false;
    let openPopupId = null; 

    let uiState = 'stopped'; // 'stopped', 'playing', 'paused'
    const audioQueue = [];
    let isReading = false;
    let isLastItemReceived = false;
    const audioPlayer = new Audio();
    
    let currentObjectUrl = null;

    let mutationObserver = null;
    let lastAutoReadText = "";
    let isUpdatePending = false;
    let autoReadFinalityTimer = null; 

    let currentPlaybackQueue = [];
    let currentPlaybackIndex = 0;
    let originalTextForPlayback = "";
    let chunksForHighlight = []; 
    let isUpdatingInternally = false;
    
    let engineSettings = {};

    // -----------------------------------------------------------------
    // 2. コアロジック (Core Logic) - UI非依存
    // -----------------------------------------------------------------

    function getSpeakerDisplayName(speaker) {
        if (!speaker || !speaker.engine || !engineSettings[speaker.engine]) return speaker ? speaker.name : '';
        const engineName = engineSettings[speaker.engine].name;
        if (speaker.name.includes(`(${engineName})`)) {
            return speaker.name;
        }
        return `${speaker.name} (${engineName})`;
    }

    function getPureSpeakerName(speaker) {
        if (!speaker || !speaker.engine || !engineSettings[speaker.engine]) return speaker ? speaker.name : '';
        const engineName = ` (${engineSettings[speaker.engine].name})`;
        if (speaker.name.endsWith(engineName)) {
            return speaker.name.slice(0, -engineName.length);
        }
        return speaker.name;
    }

    function generateHighlightChunks(text, defaultSpeakerId, rules) {
        if (!separationSettings.enabled || !rules || rules.length === 0) {
            return [{ text: text, speakerId: defaultSpeakerId, isTrigger: false }];
        }
        const chunks = [];
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matches = [];
            for (const rule of rules) {
                if (!rule.trigger) continue;
                let from = 0;
                while ((from = line.indexOf(rule.trigger, from)) !== -1) {
                    matches.push({ start: from, end: from + rule.trigger.length, speakerId: rule.speakerId });
                    from += rule.trigger.length;
                }
            }
            matches.sort((a, b) => a.start - b.start);
            let lastIndex = 0;
            let lastSpeakerId = defaultSpeakerId;
            matches.forEach(match => {
                if (match.start > lastIndex) {
                    const textPart = line.substring(lastIndex, match.start);
                    chunks.push({ text: textPart, speakerId: lastSpeakerId, isTrigger: false });
                }
                const triggerText = line.substring(match.start, match.end);
                chunks.push({ text: triggerText, speakerId: match.speakerId, isTrigger: true });
                lastIndex = match.end;
                lastSpeakerId = match.speakerId;
            });
            if (lastIndex < line.length) {
                const textPart = line.substring(lastIndex);
                chunks.push({ text: textPart, speakerId: lastSpeakerId, isTrigger: false });
            }
            if (i < lines.length - 1) {
                chunks.push({ text: '\n', speakerId: defaultSpeakerId, isTrigger: false });
            }
        }
        if (chunks.length === 0) return [];
        const merged = [chunks[0]];
        for (let i = 1; i < chunks.length; i++) {
            const last = merged[merged.length - 1];
            const current = chunks[i];
            if (last.speakerId === current.speakerId && last.isTrigger === current.isTrigger) {
                last.text += current.text;
            } else {
                merged.push(current);
            }
        }
        return merged.filter(chunk => chunk.text.length > 0);
    }

    function _calculateStartIndex(cursorDomInfo) {
        if (!cursorDomInfo) return 0;

        const allSpans = ui.getHighlightSpans();
        if (allSpans.length === 0) return 0;

        const getLastTextNode = (element) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let lastNode = null;
            let currentNode;
            while ((currentNode = walker.nextNode())) {
                if (currentNode.textContent.trim() !== '') {
                    lastNode = currentNode;
                }
            }
            const reverseWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const nodeIterator = [];
            while(reverseWalker.nextNode()) nodeIterator.push(reverseWalker.currentNode);
            return nodeIterator.length > 0 ? nodeIterator[nodeIterator.length - 1] : null;
        };

        const lastSpan = allSpans[allSpans.length - 1];
        const lastTextNodeInEditor = getLastTextNode(lastSpan);

        if (lastTextNodeInEditor &&
            cursorDomInfo.textNode === lastTextNodeInEditor &&
            cursorDomInfo.offset === lastTextNodeInEditor.length) {
            return 0;
        }

        let playableSentenceCount = 0;
        let startIndex = -1;

        for (const span of allSpans) {
            const isTrigger = span.dataset.isTrigger === 'true';
            
            if (span.contains(cursorDomInfo.textNode)) {
                let cursorOffsetInSpan = 0;
                const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                    if (node === cursorDomInfo.textNode) {
                        cursorOffsetInSpan += cursorDomInfo.offset;
                        break;
                    }
                    cursorOffsetInSpan += node.length;
                }

                let sentenceStartPosInSpan = 0;
                const sentences = span.textContent.split(/([。！？\n])/g);

                for (let i = 0; i < sentences.length; i += 2) {
                    const fullSentence = (sentences[i] || '') + (sentences[i + 1] || '');
                    if (!fullSentence) continue;

                    const sentenceEndPosInSpan = sentenceStartPosInSpan + fullSentence.length;
                    let isPlayable = true;
                    if (separationSettings.enabled && isTrigger && !separationSettings.readTriggerEnabled) {
                        isPlayable = false;
                    }

                    if (cursorOffsetInSpan >= sentenceStartPosInSpan && cursorOffsetInSpan < sentenceEndPosInSpan) {
                        if (isPlayable && fullSentence.trim()) {
                            startIndex = playableSentenceCount;
                            const relativeOffset = cursorOffsetInSpan - sentenceStartPosInSpan;
                            if (currentPlaybackQueue[startIndex]) {
                                currentPlaybackQueue[startIndex].text = currentPlaybackQueue[startIndex].text.substring(relativeOffset);
                            }
                        }
                        break; 
                    }
                    
                    if (isPlayable && fullSentence.trim()) {
                        playableSentenceCount++;
                    }
                    sentenceStartPosInSpan = sentenceEndPosInSpan;
                }
                break; 
            } else {
                const sentences = span.textContent.split(/([。！？\n])/g);
                for (let i = 0; i < sentences.length; i += 2) {
                    const fullSentence = (sentences[i] || '') + (sentences[i + 1] || '');
                    if (!fullSentence.trim()) continue;

                    let isPlayable = true;
                    if (separationSettings.enabled && isTrigger && !separationSettings.readTriggerEnabled) {
                        isPlayable = false;
                    }
                    if (isPlayable) {
                        playableSentenceCount++;
                    }
                }
            }
        }
        
        if (startIndex === -1) {
            startIndex = playableSentenceCount;
        }

        return Math.min(startIndex, currentPlaybackQueue.length > 0 ? currentPlaybackQueue.length - 1 : 0);
    }

    function extractTextFromElements(selector, getAll) {
        if (!selector) return null;
        const foundElements = document.querySelectorAll(selector);
        if (foundElements.length === 0) return null;
        const elementsToProcess = getAll ? Array.from(foundElements) : [foundElements[foundElements.length - 1]];
        let combinedText = "";
        if (rubyProcessingEnabled) {
            const tempDiv = document.createElement('div');
            for (const el of elementsToProcess) {
                const clone = el.cloneNode(true);
                clone.querySelectorAll('ruby').forEach(ruby => {
                    const rt = ruby.querySelector('rt');
                    if (rt && rt.textContent) ruby.replaceWith(document.createTextNode(rt.textContent));
                });
                tempDiv.appendChild(clone);
            }
            let processedHTML = tempDiv.innerHTML;
            processedHTML = processedHTML.replace(/｜([^《]+)《([^》]+)》/g, '$2');
            tempDiv.innerHTML = processedHTML;
            combinedText = tempDiv.innerText;
        } else {
            combinedText = elementsToProcess.map(el => el.innerText).join('\n');
        }
        return combinedText;
    }

    function startObserver() {
        if (mutationObserver) mutationObserver.disconnect();
        const targetNode = document.body;
        const observeConfig = { childList: true, characterData: true, subtree: true };
        mutationObserver = new MutationObserver(callbacks.onMutation);
        mutationObserver.observe(targetNode, observeConfig);
    }
    
    function stopObserver() { 
        if (mutationObserver) { 
            mutationObserver.disconnect(); 
            mutationObserver = null; 
        }
        clearTimeout(autoReadFinalityTimer);
    }

    // -----------------------------------------------------------------
    // 3. UIイベントに対する処理 (Callbacks)
    // -----------------------------------------------------------------
    const callbacks = {
        onClose: () => {
            stopObserver();
            callbacks.onStop();
            ui.remove();
            window.mySpeechExtensionInstance = null;
        },
        onToggleMode: () => {
            isSimpleMode = !isSimpleMode;
            ui.toggleMode(isSimpleMode);
            chrome.runtime.sendMessage({ action: 'saveIsSimpleMode', data: isSimpleMode });
        },
        onPlayPause: () => {
            if (autoReadEnabled && uiState === 'stopped') {
                lastAutoReadText = ui.getTextFromEditor().trim();
            }

            if (uiState === 'playing') {
                uiState = 'paused';
                audioPlayer.pause();
                ui.updateStatus("ステータス: 一時停止中");
                callbacks.updateAllButtons();
                return;
            }

            if (uiState === 'paused') {
                uiState = 'playing';
                ui.updateStatus("ステータス: 再生中...");
                if (audioPlayer.src && !audioPlayer.ended) {
                    audioPlayer.play().catch(e => console.error("Resume playback failed:", e));
                } else {
                    playNextInQueue();
                }
                callbacks.updateAllButtons();
                return;
            }
            
            if (uiState === 'stopped') {
                resetPlaybackState();
                
                originalTextForPlayback = ui.getTextFromEditor();
                const rulesToApply = separationSettings.enabled ? separationSettings.rules : [];
                chunksForHighlight = generateHighlightChunks(originalTextForPlayback, currentSpeakerId, rulesToApply);

                const sentences = [];
                chunksForHighlight.forEach(chunk => {
                    const splitSentences = chunk.text.split(/([。！？\n])/g);
                    for (let i = 0; i < splitSentences.length; i += 2) {
                        const fullSentence = (splitSentences[i] || '') + (splitSentences[i + 1] || '');
                        if (!fullSentence.trim()) continue;

                        let isPlayable = true;
                        let textToPlay = fullSentence;
                        let speakerForPlay = chunk.speakerId;

                        if (separationSettings.enabled && chunk.isTrigger) {
                            if (separationSettings.readTriggerEnabled) {
                                speakerForPlay = currentSpeakerId;
                            } else {
                                isPlayable = false;
                            }
                        }
                        if (isPlayable) {
                           sentences.push({ text: textToPlay, speakerId: speakerForPlay });
                        }
                    }
                });
                currentPlaybackQueue = sentences;

                if (currentPlaybackQueue.length === 0) {
                    callbacks.onStop(true);
                    return;
                }

                const cursorDomInfo = ui.getCursorDomInfo();
                currentPlaybackIndex = _calculateStartIndex(cursorDomInfo);
                
                const finalPayload = currentPlaybackQueue.slice(currentPlaybackIndex);
                if (finalPayload.length === 0) {
                    callbacks.onStop(true);
                    return;
                }

                audioQueue.length = 0;
                isReading = false;
                isLastItemReceived = false;
                uiState = 'playing';
                ui.updateStatus("ステータス: 読み上げ準備中...");
                callbacks.updateAllButtons();
                
                ui.redrawTextEditorWithHighlight(chunksForHighlight, currentPlaybackIndex, scrollToHighlightEnabled, currentSpeakerId, speakerList);
                
                const params = ui.getCurrentParams();
                chrome.runtime.sendMessage({ action: 'processAndGenerateAudioFromList', payload: finalPayload, params });
            }
        },
        onStop: (isCompletion = false) => {
            if (uiState === 'stopped' && !isCompletion) return;
            
            uiState = 'stopped';

            clearTimeout(autoReadFinalityTimer);
            chrome.runtime.sendMessage({ action: 'stopReading' });
            
            audioPlayer.pause();
            
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
            
            audioQueue.length = 0;
            isReading = false;
            isLastItemReceived = false;
            
            resetPlaybackState();
            ui.updateStatus(isCompletion ? "ステータス: 全ての再生が完了しました。" : "ステータス: 停止しました。");
            callbacks.updateAllButtons();

            if (!isCompletion && autoReadEnabled) {
                lastAutoReadText = "";
                isUpdatePending = false;
            }

            if (isCompletion && autoReadEnabled && isUpdatePending) {
                callbacks.onMutation();
            }
        },
        onAutoReadToggle: () => {
            autoReadEnabled = !autoReadEnabled;
            ui.updateAutoReadButtonsUI(autoReadEnabled);
            if (autoReadEnabled) {
                isUpdatePending = false;
                startObserver();
                callbacks.onMutation(); 
            } else {
                stopObserver();
                lastAutoReadText = "";
                isUpdatePending = false;
            }
        },
        onGetAndReadSimple: () => {
            if (uiState === 'playing' || uiState === 'paused') {
                callbacks.onStop();
            } else {
                if (callbacks.onGetText()) {
                    callbacks.onPlayPause();
                }
            }
        },
        onSelectorChange: (value, name) => {
            if (name && value) {
                ui.updateSelectorInputs(name, value);
            }
            chrome.runtime.sendMessage({ action: 'saveLastSelector', data: value });
            if (autoReadEnabled) {
                lastAutoReadText = "";
                isUpdatePending = false;
                startObserver();
            }
        },
        onAddSelector: async () => {
            const { name, selector } = ui.getNewSelectorInfo();
            if (!name || !selector) return ui.alert("登録名とCSSセレクタの両方を入力してください。");
            const index = selectorList.findIndex(item => item.name === name);
            if (index !== -1) {
                selectorList[index].selector = selector;
            } else {
                selectorList.push({ name, selector });
            }
            await chrome.runtime.sendMessage({ action: 'saveSelectors', data: selectorList });
            ui.renderSelectorOptions(selectorList, selector);
            callbacks.onSelectorChange(selector, name);
        },
        onDeleteSelector: async () => {
            if (selectorList.length <= 1) return ui.alert("最後のセレクタは削除できません。");
            const selectorToDelete = ui.getSelectorValue();
            selectorList = selectorList.filter(item => item.selector !== selectorToDelete);
            await chrome.runtime.sendMessage({ action: 'saveSelectors', data: selectorList });
            const newSelector = selectorList.length > 0 ? selectorList[0] : { selector: '', name: '' };
            ui.renderSelectorOptions(selectorList, newSelector.selector);
            callbacks.onSelectorChange(newSelector.selector, newSelector.name);
        },
        onRubyProcessingChange: (isChecked) => {
            rubyProcessingEnabled = isChecked;
            chrome.runtime.sendMessage({ action: 'saveRubyProcessingSetting', data: rubyProcessingEnabled });
        },
        onCheckSpeakers: async () => {
            ui.setCheckSpeakersButtonState("更新中...", true);
            try {
                const updatedSpeakers = await chrome.runtime.sendMessage({ action: 'fetchAndSyncSpeakers' });
                if (updatedSpeakers && !updatedSpeakers.error) {
                    speakerList = updatedSpeakers;
                    ui.renderSpeakerOptions(speakerList, currentSpeakerId, getSpeakerDisplayName);
                    ui.renderSeparationSettings(separationSettings, speakerList, getSpeakerDisplayName);
                    ui.alert('話者リストを正常に更新しました。\n新しく発見された話者がリストに追加されています。');
                } else {
                    throw new Error(updatedSpeakers.error || '不明なエラーが発生しました。');
                }
            } catch (e) {
                console.error("話者リストの更新に失敗しました:", e);
                ui.alert(`話者リストの更新に失敗しました:\n${e.message}`);
            } finally {
                ui.setCheckSpeakersButtonState("話者リストを更新", false);
                checkServerStatus();
            }
        },
        // ▼▼▼ [ここから修正] updateCurrentSpeakerDisplayの呼び出しを修正 ▼▼▼
        onSpeakerChange: (speakerId) => {
            currentSpeakerId = speakerId;
            const selectedSpeaker = speakerList.find(s => s.id === currentSpeakerId);
            
            if (selectedSpeaker) {
                selectedEngineId = selectedSpeaker.engine;
                ui.updateSpeakerInputs(getPureSpeakerName(selectedSpeaker), selectedSpeaker.id, selectedEngineId);
                // 必要な引数(speakerId, speakerList)をすべて渡すように変更
                ui.updateCurrentSpeakerDisplay(getSpeakerDisplayName(selectedSpeaker), selectedSpeaker.id, speakerList);
            } else {
                ui.updateCurrentSpeakerDisplay('---', null, speakerList);
            }
            
            chrome.runtime.sendMessage({ action: 'saveLastSpeaker', data: currentSpeakerId });
            ui.renderSpeakerOptions(speakerList, currentSpeakerId, getSpeakerDisplayName);
            callbacks.onTextChange();
        },
        // ▲▲▲ [修正はここまで] ▲▲▲
        onTogglePopup: (popupId, forceState) => {
            const shouldOpen = forceState === undefined ? openPopupId !== popupId : forceState;
            
            if (openPopupId) {
                const elements = ui.getPopupElements();
                const targetId = openPopupId === 'speakerPopup' ? 'speaker' : openPopupId;
                if (elements[targetId]) {
                    if (targetId === 'speaker') {
                        ui.toggleSpeakerPopup(false);
                    } else {
                        ui.toggleSettingsPopup(elements[targetId].popup, elements[targetId].button, false);
                    }
                }
            }
    
            openPopupId = null;
            document.removeEventListener('mousedown', callbacks.onDocumentClick, true);
            
            if (shouldOpen) {
                openPopupId = popupId;
                const elements = ui.getPopupElements();
                const targetId = openPopupId;
    
                if (targetId === 'speaker') {
                    ui.renderPopupSpeakerList(speakerList, currentSpeakerId, getSpeakerDisplayName);
                    const buttonRect = ui.getSpeakerButtonElement().getBoundingClientRect();
                    const spaceBelow = window.innerHeight - buttonRect.bottom;
                    const margin = 20;
                    const maxHeight = Math.max(100, spaceBelow - margin);
                    ui.setPopupMaxHeight(maxHeight + 'px');
                    ui.toggleSpeakerPopup(true);
                } else if (elements[targetId]) {
                    ui.toggleSettingsPopup(elements[targetId].popup, elements[targetId].button, true);
                }
                document.addEventListener('mousedown', callbacks.onDocumentClick, true);
            }
        },
        
        onDocumentClick: (event) => {
            if (!openPopupId) return;
    
            const elements = ui.getPopupElements();
            const targetId = openPopupId;
            
            const popup = elements[targetId]?.popup;
            const button = elements[targetId]?.button;
    
            if (popup && button) {
                const path = event.composedPath();
                if (!path.includes(popup) && !path.includes(button)) {
                    callbacks.onTogglePopup(openPopupId, false);
                }
            }
        },
        onSpeakerPopupToggle: (forceState) => {
            callbacks.onTogglePopup('speaker', forceState);
        },
        onEngineSelect: (engine) => {
            selectedEngineId = engine;
            const { name, id } = ui.getNewSpeakerInfo();
            ui.updateSpeakerInputs(name, id, selectedEngineId);
        },
        onAddSpeaker: async () => {
            const { name, id } = ui.getNewSpeakerInfo();
            const engine = selectedEngineId;
            if (!name || !id || !engine) return ui.alert("名前と話者IDを入力し、エンジンを選択してください。");
            const index = speakerList.findIndex(s => s.id === id && s.engine === engine);
            if (index !== -1) {
                speakerList[index].name = name;
            } else {
                speakerList.push({ name, id, engine });
            }
            currentSpeakerId = id;
            await chrome.runtime.sendMessage({ action: 'saveSpeakers', data: speakerList });
            ui.renderSpeakerOptions(speakerList, currentSpeakerId, getSpeakerDisplayName);
            ui.renderSeparationSettings(separationSettings, speakerList, getSpeakerDisplayName);
        },
        onDeleteSpeaker: async () => {
            if (speakerList.length <= 1) return ui.alert("最後の話者は削除できません。");
            const idToDelete = ui.getSpeakerValue();
            const selectedSpeaker = speakerList.find(s => s.id === idToDelete);
            if(!selectedSpeaker) return;
            speakerList = speakerList.filter(s => !(s.id === idToDelete && s.engine === selectedSpeaker.engine));
            const newSpeakerId = speakerList.length > 0 ? speakerList[0].id : null;
            await chrome.runtime.sendMessage({ action: 'saveSpeakers', data: speakerList });
            ui.renderSpeakerOptions(speakerList, newSpeakerId, getSpeakerDisplayName);
            ui.renderSeparationSettings(separationSettings, speakerList, getSpeakerDisplayName);
            callbacks.onSpeakerChange(newSpeakerId);
        },
        onParamsChange: () => {
            const paramsToSave = ui.getCurrentParams();
            chrome.runtime.sendMessage({ action: 'saveLastParams', data: paramsToSave });
        },
        onSaveTrimSettings: async () => {
            trimSettings = ui.getTrimSettings();
            await chrome.runtime.sendMessage({ action: 'saveTrimSettings', data: trimSettings });
        },
        onSaveSeparationSettings: async () => {
            const enablement = ui.getSeparationEnablement();
            separationSettings.enabled = enablement.enabled;
            separationSettings.readTriggerEnabled = enablement.readTriggerEnabled;
            await chrome.runtime.sendMessage({ action: 'saveSeparationSettings', data: separationSettings });
            callbacks.onTextChange();
        },
        onAddSeparationRule: () => {
            const { trigger, speakerId } = ui.getNewRuleInfo();
            if (!trigger) { return ui.alert("トリガー文字列を入力してください。"); }
            const existingRuleIndex = separationSettings.rules.findIndex(rule => rule.trigger === trigger);
            if (existingRuleIndex !== -1) {
                separationSettings.rules[existingRuleIndex].speakerId = speakerId;
            } else {
                separationSettings.rules.push({ trigger, speakerId });
            }
            callbacks.onSaveSeparationSettings().then(() => {
                ui.renderSeparationSettings(separationSettings, speakerList, getSpeakerDisplayName);
                ui.clearNewRuleInput();
            });
        },
        onDeleteSeparationRule: (triggerToDelete) => {
            separationSettings.rules = separationSettings.rules.filter(rule => rule.trigger !== triggerToDelete);
            callbacks.onSaveSeparationSettings().then(() => {
                ui.renderSeparationSettings(separationSettings, speakerList, getSpeakerDisplayName);
            });
        },
        onGetText: () => {
            const selector = ui.getSelectorValue();
            const combinedText = extractTextFromElements(selector, getAllTextEnabled);
            if (combinedText === null) {
                ui.alert("指定されたCSSセレクタに一致する要素が見つかりませんでした。");
                return false;
            }
            ui.setTextInEditor(combinedText);
            callbacks.onTextChange();
            return true;
        },
        onClearText: () => {
            ui.setTextInEditor('');
            callbacks.onTextChange();
        },
        onGetAllTextChange: (isChecked) => {
            getAllTextEnabled = isChecked;
            chrome.runtime.sendMessage({ action: 'saveGetAllText', data: getAllTextEnabled });
        },
        onScrollToHighlightChange: (isChecked) => {
            scrollToHighlightEnabled = isChecked;
            chrome.runtime.sendMessage({ action: 'saveScrollToHighlight', data: scrollToHighlightEnabled });
        },
        onTextChange: () => {
            if (isUpdatingInternally) return;

            const text = ui.getTextFromEditor();
            const rulesToApply = separationSettings.enabled ? separationSettings.rules : [];
            const chunks = generateHighlightChunks(text, currentSpeakerId, rulesToApply);
            
            isUpdatingInternally = true;
            ui.updateHighlight(chunks, currentSpeakerId, speakerList);
            isUpdatingInternally = false;

            callbacks.updateAllButtons();
        },
        onTextMouseUp: () => {
            if (uiState === 'paused') {
                callbacks.onStop();
                ui.updateStatus("ステータス: 停止しました。クリック位置から再生待機中です。");
            }
        },
        onMutation: () => {
            if (!autoReadEnabled) return;
            if (uiState !== 'stopped') {
                isUpdatePending = true;
                return;
            }
            isUpdatePending = false;
            clearTimeout(autoReadFinalityTimer);
            autoReadFinalityTimer = setTimeout(() => {
                const selector = ui.getSelectorValue();
                const newText = extractTextFromElements(selector, false);
                const newTextTrimmed = newText ? newText.trim() : "";
                
                if (newTextTrimmed && newTextTrimmed !== lastAutoReadText) {
                    lastAutoReadText = newTextTrimmed;
                    ui.setTextInEditor(newText);
                    callbacks.onTextChange();
                    setTimeout(() => callbacks.onPlayPause(), 50);
                }
            }, 1500);
        },
        updateAllButtons: () => {
            const hasText = ui.getTextFromEditor().trim().length > 0;
            const isRunning = ui.isServerRunning();
            ui.updateAllPlaybackButtons(uiState, hasText, isRunning);
        },
        isUpdatingInternally: () => {
            return isUpdatingInternally;
        },
    };

    // -----------------------------------------------------------------
    // 4. UI生成と接続 (UI Instantiation and Connection)
    // -----------------------------------------------------------------
    const ui = createMySpeechUI(callbacks);

    // -----------------------------------------------------------------
    // 5. 内部ロジック (Internal Logic) - UI依存
    // -----------------------------------------------------------------
    
    function resetPlaybackState() {
        currentPlaybackQueue = [];
        currentPlaybackIndex = 0;
        originalTextForPlayback = "";
        chunksForHighlight = []; 
        const text = ui.getTextFromEditor();
        const rulesToApply = separationSettings.enabled ? separationSettings.rules : [];
        const chunks = generateHighlightChunks(text, currentSpeakerId, rulesToApply);
        ui.updateHighlight(chunks, currentSpeakerId, speakerList);
        ui.blurEditor();
    }
    
    async function playNextInQueue() {
        if (audioQueue.length === 0) {
            if (isLastItemReceived) {
                callbacks.onStop(true);
            }
            return;
        }

        if (isReading || uiState === 'paused') {
            return;
        }

        isReading = true;

        const item = audioQueue.shift();
        ui.updateStatus(`再生中: ${currentPlaybackQueue[currentPlaybackIndex]?.text || ''}`);
        
        ui.redrawTextEditorWithHighlight(chunksForHighlight, currentPlaybackIndex, scrollToHighlightEnabled, currentSpeakerId, speakerList);
        
        try {
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }

            const response = await fetch(item.audioUrl);
            const blob = await response.blob();
            currentObjectUrl = URL.createObjectURL(blob);
            audioPlayer.src = currentObjectUrl;
            await audioPlayer.play();
        } catch (error) {
            console.error("Playback failed:", error);
            isReading = false;
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
            if (uiState !== 'paused' && uiState !== 'stopped') {
                callbacks.onStop();
            }
        }
    }

    audioPlayer.onended = () => {
        isReading = false;
        currentPlaybackIndex++;
        if (uiState !== 'paused' && uiState !== 'stopped') {
            setTimeout(() => {
                playNextInQueue();
            }, 0);
        }
    };

    audioPlayer.onerror = (e) => {
        isReading = false;
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
        }
        if (uiState !== 'stopped') {
             console.error("Audio Player Error:", e);
             ui.updateStatus("エラー: 再生に失敗");
             callbacks.onStop();
        }
    };
    
    async function checkServerStatus() {
        try {
            const results = await chrome.runtime.sendMessage({ action: 'checkServerStatus' });
            ui.updateServerStatus(results);
        } catch (e) {
            console.error("Could not check server status.", e);
            ui.updateServerStatus(null);
        } finally {
            callbacks.updateAllButtons();
        }
    }

    // -----------------------------------------------------------------
    // 6. 初期化とメッセージリスナー (Initialization and Listeners)
    // -----------------------------------------------------------------
    function handleBackgroundMessage(message) {
        if (message.type === 'ENGINE_SETTINGS') {
            engineSettings = message.data;
            return;
        }
        if (uiState === 'stopped') return;

        switch (message.type) {
            case 'UPDATE_STATUS':
                ui.updateStatus(message.text);
                break;
            case 'PLAY_AUDIO':
                audioQueue.push({ audioUrl: message.audioUrl });
                if (message.isLast) {
                    isLastItemReceived = true;
                }
                playNextInQueue();
                break;
            case 'GENERATION_ERROR':
                ui.updateStatus(`エラー: ${message.error}`);
                currentPlaybackIndex++;
                if (message.isLast) {
                    isLastItemReceived = true;
                }
                playNextInQueue();
                break;
            case 'READING_COMPLETE':
                isLastItemReceived = true;
                if (audioQueue.length === 0 && !isReading) {
                    callbacks.onStop(true);
                }
                break;
        }
    }

    async function init() {
        try {
            await chrome.runtime.sendMessage({ action: 'getEngineSettings' });
            const lastSettings = await chrome.runtime.sendMessage({ action: 'loadLastSettings' });
            
            speakerList = await chrome.runtime.sendMessage({ action: 'loadSpeakers' });
            if (speakerList && !speakerList.error) {
                const lastSpeakerId = lastSettings['my-speech-gui-last-speaker'] || (speakerList[0] ? speakerList[0].id : null);
                callbacks.onSpeakerChange(lastSpeakerId);
            } else { speakerList = []; }
            
            selectorList = await chrome.runtime.sendMessage({ action: 'loadSelectors' });
            if (selectorList && !selectorList.error) {
                const lastSelector = lastSettings['my-speech-gui-last-selector'];
                const initialSelector = lastSelector || (selectorList[0] ? selectorList[0].selector : '');
                const initialSelectorName = (selectorList.find(s => s.selector === initialSelector) || {name: ''}).name;
                ui.renderSelectorOptions(selectorList, initialSelector);
                callbacks.onSelectorChange(initialSelector, initialSelectorName);
            } else { selectorList = []; }
            
            separationSettings = await chrome.runtime.sendMessage({ action: 'loadSeparationSettings' });
            if (separationSettings) ui.renderSeparationSettings(separationSettings, speakerList, getSpeakerDisplayName);
            
            trimSettings = await chrome.runtime.sendMessage({ action: 'loadTrimSettings' });
            if (trimSettings) ui.renderTrimSettings(trimSettings);
            
            rubyProcessingEnabled = lastSettings['my-speech-gui-ruby-processing'] || false;
            getAllTextEnabled = lastSettings['my-speech-gui-get-all-text'] || false;
            scrollToHighlightEnabled = lastSettings['my-speech-gui-scroll-to-highlight'] || false;
            ui.renderInitialCheckboxes({ ruby: rubyProcessingEnabled, getAllText: getAllTextEnabled, scrollToHighlight: scrollToHighlightEnabled });

            isSimpleMode = lastSettings['my-speech-gui-is-simple-mode'] || false;
            if(isSimpleMode) ui.toggleMode(true);
            
            ui.createParameterSliders(lastSettings['my-speech-gui-last-params']);
            
            ui.updateAutoReadButtonsUI(autoReadEnabled);
            await checkServerStatus();
        } catch (e) {
            console.error("初期化中にエラー:", e);
            callbacks.updateAllButtons();
        }
    }
    
    if (!window.mySpeechExtensionListenerAttached) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (window.mySpeechExtensionInstance) {
                 if (message.action === 'toggleUI') window.mySpeechExtensionInstance.toggleVisibility(); 
                 else window.mySpeechExtensionInstance.handleBackgroundMessage(message);
            }
        });
        window.mySpeechExtensionListenerAttached = true;
    }
    
    window.mySpeechExtensionInstance = {
        toggleVisibility: () => ui.toggleVisibility(),
        handleBackgroundMessage: handleBackgroundMessage,
    };
    
    init();

})();