// content_ui.js (修正後の完全なコード)

'use strict';

/**
 * 弭 -Yuhazu- のUIを生成し、操作するためのメソッド群を返します。
 * @param {object} callbacks - UIイベント発生時に呼び出される、ロジック側の関数群。
 * @returns {object} - UIを操作するためのAPIオブジェクト。
 */
function createMySpeechUI(callbacks) {
    // -----------------------------------------------------------------
    // 1. 定数、DOM生成、HTML定義
    // -----------------------------------------------------------------
    const PREFIX = 'myspeech-ext-';
    const GUI_HOST_ID = `${PREFIX}gui-host`;
    const COLOR_PALETTE = [ '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf' ];

    const guiHost = document.createElement("div");
    guiHost.id = GUI_HOST_ID;
    const shadowRoot = guiHost.attachShadow({ mode: 'open' });

    const linkElem = document.createElement('link');
    linkElem.setAttribute('rel', 'stylesheet');
    linkElem.setAttribute('href', chrome.runtime.getURL('content_style.css'));
    shadowRoot.appendChild(linkElem);

    // ▼▼▼ [ここから修正] 簡易モードのHTML構造を変更 ▼▼▼
    const guiHtml = `
        <div id="wrapper">
            <div id="header">
                <div id="header-left"> <button id="toggle-mode-btn" title="モード切替">⚙</button> </div>
                <div id="playback-controls">
                    <button id="play-pause-btn" title="読み上げ開始" disabled>▶</button>
                    <button id="stop-btn" title="停止" disabled></button>
                    <button id="auto-read-btn" title="自動読み上げ ON/OFF">AUTO</button>
                    <button id="speaker-popup-btn" title="話者を選択">話者</button>
                    <div id="speaker-select-popup" class="hidden">
                        <div class="popup-header">
                            <span>話者を選択</span>
                        </div>
                        <ul id="popup-speaker-list"></ul>
                    </div>
                </div>
                <div id="header-buttons"> <button id="gui-close-btn" title="閉じる">×</button> </div>
            </div>
            <!-- #simple-mode-top-buttons のdivを削除し、ボタンをフラットな構造にする -->
            <div id="simple-mode-controls" class="hidden">
                <button id="get-and-read-simple-btn" class="main-action-btn">T/▶︎</button>
                <button id="play-pause-simple-btn" class="main-action-btn" disabled>▶</button>
                <button id="auto-read-simple-btn" class="main-action-btn">AUTO</button>
            </div>
            <div id="gui-body">
                <div class="gui-section">
                    <div id="current-speaker-display">---</div>
                </div>
                <div class="collapsible gui-section" id="param-settings-collapsible">
                    <div class="collapsible-header"> <span>音声パラメータ</span> <span class="toggle-icon">▶</span> </div>
                    <div class="collapsible-content"> <div id="parameters-grid"></div> </div>
                </div>
                <div class="gui-section" id="text-section">
                    <div id="settings-actions-group">
                        <button id="text-settings-btn" class="settings-action-btn">テキスト取得設定</button>
                        <button id="speaker-settings-btn" class="settings-action-btn">話者設定</button>
                        <button id="trim-settings-btn" class="settings-action-btn">ノイズ対策</button>
                        <button id="separation-settings-btn" class="settings-action-btn">話者分離</button>
                    </div>

                    <div class="section-divider">
                        <span>読み上げテキスト</span>
                    </div>

                    <div class="text-actions-group"> <button id="get-text-btn" class="main-action-btn">テキストを取得</button> <button id="clear-text-btn" class="main-action-btn">テキストをクリア</button> </div>
                    <div class="checkbox-group"> <input type="checkbox" id="get-all-text-checkbox"> <label for="get-all-text-checkbox">ページ内の一致する要素を全て取得</label> </div>
                    <div class="checkbox-group"> <input type="checkbox" id="scroll-to-highlight-checkbox"> <label for="scroll-to-highlight-checkbox">読み上げ部分に追従する</label> </div>
                    <div id="text-editor-container"> <div id="text-editor" contenteditable="true" spellcheck="false"></div> </div>
                    <div id="read-status">ステータス: 待機中</div>
                    <div id="server-status-container"></div>
                </div>
            </div>

            <div id="text-settings-popup" class="settings-popup hidden">
                <div class="popup-header">
                    <span>テキスト取得設定</span>
                    <button class="popup-close-btn" title="閉じる">×</button>
                </div>
                <div class="popup-content">
                    <div class="form-group"> <label for="selector-select">取得対象</label> <select id="selector-select"></select> </div>
                    <div class="form-group"> <label for="selector-name-input">登録名</label> <input type="text" id="selector-name-input" placeholder="例: AIチャットの返信"> </div>
                    <div class="form-group"> <label for="selector-css-input">CSSセレクタ</label> <input type="text" id="selector-css-input" placeholder="例: .message.model .message-content"> </div>
                    <div id="selector-actions"> <button id="add-selector-btn" class="small-btn">追加/更新</button> <button id="delete-selector-btn" class="small-btn">選択中を削除</button> </div>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
                    <div class="checkbox-group"> <input type="checkbox" id="ruby-processing-checkbox"> <label for="ruby-processing-checkbox">ルビを読みに変換する (小説サイト向け)</label> </div>
                </div>
            </div>
            <div id="speaker-settings-popup" class="settings-popup hidden">
                <div class="popup-header">
                    <span>話者設定</span>
                    <button class="popup-close-btn" title="閉じる">×</button>
                </div>
                <div class="popup-content">
                    <div class="form-group"> <button id="check-speakers-btn" class="small-btn">話者リストを更新</button> </div>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 10px 0 15px 0;">
                    <div class="form-group"> <label for="speaker-select">話者を選択</label> <select id="speaker-select"></select> </div>
                    <div class="form-group"> <label for="speaker-name-input">登録名</label> <input type="text" id="speaker-name-input"> </div>
                    <div class="form-group"> <label for="speaker-id-input">話者ID</label> <input type="text" id="speaker-id-input"> </div>
                    <div class="form-group"> <div class="engine-selector"> <button id="engine-btn-aivis">Aivis</button> <button id="engine-btn-voicevox">VOICEVOX</button> </div> </div>
                    <div id="speaker-actions"> <button id="add-speaker-btn" class="small-btn">手動更新</button> <button id="delete-speaker-btn" class="small-btn">選択中を削除</button> </div>
                </div>
            </div>
            <div id="trim-settings-popup" class="settings-popup hidden">
                <div class="popup-header">
                    <span>ノイズ対策</span>
                    <button class="popup-close-btn" title="閉じる">×</button>
                </div>
                <div class="popup-content">
                    <div class="checkbox-group main-check"> <input type="checkbox" id="enable-trim-checkbox"> <label for="enable-trim-checkbox">文末の指定文字列を読み上げない</label> </div>
                    <div id="trim-content"> <div class="form-group"> <label for="trim-strings-textarea">指定文字列(改行で複数指定)</label> <textarea id="trim-strings-textarea" rows="3"></textarea> </div> </div>
                </div>
            </div>
            <div id="separation-settings-popup" class="settings-popup hidden">
                <div class="popup-header">
                    <span>話者分離</span>
                    <button class="popup-close-btn" title="閉じる">×</button>
                </div>
                <div class="popup-content">
                    <div class="checkbox-group main-check"> <input type="checkbox" id="enable-separation-checkbox"> <label for="enable-separation-checkbox">話者分離を有効にする</label> </div>
                    <div id="separation-content"> <div class="checkbox-group"> <input type="checkbox" id="read-trigger-checkbox"> <label for="read-trigger-checkbox">トリガーを地の文で読み上げる</label> </div> <label>ルール管理</label> <ul id="separation-rules-list"></ul> <div class="form-group"> <label for="rule-trigger-input">トリガー文字列</label> <input type="text" id="rule-trigger-input" placeholder="例: アリス：「"> </div> <div class="form-group"> <label for="rule-speaker-select">話者</label> <select id="rule-speaker-select"></select> </div> <button id="add-separation-rule-btn" class="small-btn">ルールを追加</button> </div>
                </div>
            </div>
        </div>
    `;
    // ▲▲▲ [修正はここまで] ▲▲▲

    const template = document.createElement('template');
    template.innerHTML = guiHtml;
    shadowRoot.appendChild(template.content.cloneNode(true));
    document.body.appendChild(guiHost);

    const s = shadowRoot;
    const dom = {
        wrapper: s.getElementById('wrapper'), header: s.getElementById('header'),
        closeBtn: s.getElementById('gui-close-btn'), toggleModeBtn: s.getElementById('toggle-mode-btn'),
        collapsibles: s.querySelectorAll('.collapsible-header'),
        guiBody: s.getElementById('gui-body'), simpleControls: s.getElementById('simple-mode-controls'),
        getAndReadSimpleBtn: s.getElementById('get-and-read-simple-btn'), playPauseSimpleBtn: s.getElementById('play-pause-simple-btn'),
        autoReadSimpleBtn: s.getElementById('auto-read-simple-btn'),
        serverStatusContainer: s.getElementById('server-status-container'),
        speakerSelect: s.getElementById('speaker-select'),
        engineBtnAivis: s.getElementById('engine-btn-aivis'),
        engineBtnVoicevox: s.getElementById('engine-btn-voicevox'),
        speakerNameInput: s.getElementById('speaker-name-input'),
        speakerIdInput: s.getElementById('speaker-id-input'), addSpeakerBtn: s.getElementById('add-speaker-btn'),
        deleteSpeakerBtn: s.getElementById('delete-speaker-btn'), checkSpeakersBtn: s.getElementById('check-speakers-btn'),
        selectorSelect: s.getElementById('selector-select'), selectorNameInput: s.getElementById('selector-name-input'),
        selectorCssInput: s.getElementById('selector-css-input'), addSelectorBtn: s.getElementById('add-selector-btn'),
        deleteSelectorBtn: s.getElementById('delete-selector-btn'),
        getTextBtn: s.getElementById('get-text-btn'),
        clearTextBtn: s.getElementById('clear-text-btn'),
        getAllTextCheckbox: s.getElementById('get-all-text-checkbox'),
        rubyProcessingCheckbox: s.getElementById('ruby-processing-checkbox'),
        scrollToHighlightCheckbox: s.getElementById('scroll-to-highlight-checkbox'),
        textEditor: s.getElementById('text-editor'),
        playbackControls: s.getElementById('playback-controls'),
        playPauseBtn: s.getElementById('play-pause-btn'), stopBtn: s.getElementById('stop-btn'),
        autoReadBtn: s.getElementById('auto-read-btn'),
        speakerPopupBtn: s.getElementById('speaker-popup-btn'),
        speakerSelectPopup: s.getElementById('speaker-select-popup'),
        popupSpeakerList: s.getElementById('popup-speaker-list'),
        readStatus: s.getElementById('read-status'),
        parametersGrid: s.getElementById('parameters-grid'),
        currentSpeakerDisplay: s.getElementById('current-speaker-display'),
        enableSeparationCheckbox: s.getElementById('enable-separation-checkbox'), readTriggerCheckbox: s.getElementById('read-trigger-checkbox'),
        separationContent: s.getElementById('separation-content'),
        rulesList: s.getElementById('separation-rules-list'), ruleTriggerInput: s.getElementById('rule-trigger-input'),
        ruleSpeakerSelect: s.getElementById('rule-speaker-select'), addRuleBtn: s.getElementById('add-separation-rule-btn'),
        enableTrimCheckbox: s.getElementById('enable-trim-checkbox'), trimContent: s.getElementById('trim-content'),
        trimStringsTextarea: s.getElementById('trim-strings-textarea'),
        textSettingsBtn: s.getElementById('text-settings-btn'),
        speakerSettingsBtn: s.getElementById('speaker-settings-btn'),
        trimSettingsBtn: s.getElementById('trim-settings-btn'),
        separationSettingsBtn: s.getElementById('separation-settings-btn'),
        textSettingsPopup: s.getElementById('text-settings-popup'),
        speakerSettingsPopup: s.getElementById('speaker-settings-popup'),
        trimSettingsPopup: s.getElementById('trim-settings-popup'),
        separationSettingsPopup: s.getElementById('separation-settings-popup'),
    };

    // -----------------------------------------------------------------
    // 2. イベントリスナーを定義し、コールバックを呼び出す
    // -----------------------------------------------------------------
    
    let isComposing = false;

    function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
    const debouncedTextChange = debounce(() => callbacks.onTextChange(), 300);

    dom.closeBtn.onclick = () => callbacks.onClose();
    dom.toggleModeBtn.onclick = () => callbacks.onToggleMode();
    
    const paramCollapsible = s.getElementById('param-settings-collapsible').querySelector('.collapsible-header');
    if(paramCollapsible) {
        paramCollapsible.onclick = () => paramCollapsible.parentElement.classList.toggle('is-open');
    }

    dom.textSettingsBtn.onclick = () => callbacks.onTogglePopup('textSettings');
    dom.speakerSettingsBtn.onclick = () => callbacks.onTogglePopup('speakerSettings');
    dom.trimSettingsBtn.onclick = () => callbacks.onTogglePopup('trimSettings');
    dom.separationSettingsBtn.onclick = () => callbacks.onTogglePopup('separationSettings');

    s.querySelectorAll('.settings-popup .popup-close-btn').forEach(btn => {
        const popup = btn.closest('.settings-popup');
        if (popup) {
            const popupId = popup.id.replace('-popup', '');
            const camelCaseId = popupId.replace(/-(\w)/g, (match, p1) => p1.toUpperCase());
            btn.onclick = () => callbacks.onTogglePopup(camelCaseId, false);
        }
    });
    
    dom.playPauseBtn.onclick = () => callbacks.onPlayPause();
    dom.stopBtn.onclick = () => callbacks.onStop();
    dom.autoReadBtn.onclick = () => callbacks.onAutoReadToggle();
    dom.getAndReadSimpleBtn.onclick = () => callbacks.onGetAndReadSimple();
    dom.playPauseSimpleBtn.onclick = () => callbacks.onPlayPause();
    dom.autoReadSimpleBtn.onclick = () => callbacks.onAutoReadToggle();

    dom.speakerPopupBtn.onclick = () => callbacks.onSpeakerPopupToggle();
    dom.popupSpeakerList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li && li.dataset.speakerId) {
            callbacks.onSpeakerChange(li.dataset.speakerId);
            callbacks.onSpeakerPopupToggle(false);
        }
    });

    dom.selectorSelect.onchange = () => {
        const selectedOption = dom.selectorSelect.options[dom.selectorSelect.selectedIndex];
        callbacks.onSelectorChange(dom.selectorSelect.value, selectedOption ? selectedOption.dataset.name : '');
    };
    dom.speakerSelect.onchange = () => callbacks.onSpeakerChange(dom.speakerSelect.value);

    dom.addSelectorBtn.onclick = () => callbacks.onAddSelector();
    dom.deleteSelectorBtn.onclick = () => callbacks.onDeleteSelector();
    dom.rubyProcessingCheckbox.onchange = (e) => callbacks.onRubyProcessingChange(e.target.checked);
    dom.checkSpeakersBtn.onclick = () => callbacks.onCheckSpeakers();
    dom.engineBtnAivis.onclick = () => callbacks.onEngineSelect('aivis');
    dom.engineBtnVoicevox.onclick = () => callbacks.onEngineSelect('voicevox');
    dom.addSpeakerBtn.onclick = () => callbacks.onAddSpeaker();
    dom.deleteSpeakerBtn.onclick = () => callbacks.onDeleteSpeaker();
    dom.parametersGrid.addEventListener('change', (e) => { if (e.target.type === 'range') callbacks.onParamsChange(); });
    dom.enableTrimCheckbox.onchange = () => callbacks.onSaveTrimSettings();
    dom.trimStringsTextarea.addEventListener('change', () => callbacks.onSaveTrimSettings());
    dom.enableSeparationCheckbox.onchange = () => callbacks.onSaveSeparationSettings();
    dom.readTriggerCheckbox.onchange = () => callbacks.onSaveSeparationSettings();
    dom.addRuleBtn.onclick = () => callbacks.onAddSeparationRule();
    dom.rulesList.addEventListener('click', (e) => { if (e.target.classList.contains('rule-delete-btn')) callbacks.onDeleteSeparationRule(e.target.dataset.trigger); });

    dom.getTextBtn.onclick = () => callbacks.onGetText();
    dom.clearTextBtn.onclick = () => callbacks.onClearText();
    dom.getAllTextCheckbox.onchange = (e) => callbacks.onGetAllTextChange(e.target.checked);
    dom.scrollToHighlightCheckbox.onchange = (e) => callbacks.onScrollToHighlightChange(e.target.checked);
    
    dom.textEditor.addEventListener('compositionstart', () => { isComposing = true; });
    dom.textEditor.addEventListener('compositionend', () => {
        isComposing = false;
        debouncedTextChange();
    });
    dom.textEditor.addEventListener('input', () => {
        if (!isComposing && !callbacks.isUpdatingInternally()) {
            debouncedTextChange();
        }
    });

    const stopEventPropagation = (e) => { e.stopPropagation(); };
    dom.textEditor.addEventListener('keydown', stopEventPropagation);
    dom.textEditor.addEventListener('keyup', stopEventPropagation);
    dom.textEditor.addEventListener('keypress', stopEventPropagation);
    dom.textEditor.addEventListener('mousedown', stopEventPropagation);
    dom.textEditor.addEventListener('mouseup', (e) => { callbacks.onTextMouseUp(); stopEventPropagation(e); });

    dom.parametersGrid.addEventListener('input', (e) => {
        if (e.target.type === 'range') {
            const valueSpan = shadowRoot.getElementById(`val-${e.target.id}`);
            if (valueSpan) valueSpan.textContent = parseFloat(e.target.value).toFixed(2);
        }
    });

    let isDragging = false, dragOffsetX, dragOffsetY;
    dom.header.onmousedown = (e) => { if (e.target.closest('button') || e.target.closest('#speaker-select-popup') || e.target.closest('.settings-popup')) return; isDragging = true; const rect = dom.wrapper.getBoundingClientRect(); dom.wrapper.style.right = 'auto'; dom.wrapper.style.left = `${rect.left}px`; dom.wrapper.style.top = `${rect.top}px`; dragOffsetX = e.clientX - rect.left; dragOffsetY = e.clientY - rect.top; };
    document.addEventListener('mousemove', (e) => { if (isDragging) { let newLeft = e.clientX - dragOffsetX; let newTop = e.clientY - dragOffsetY; const viewportWidth = window.innerWidth; const viewportHeight = window.innerHeight; const wrapperWidth = dom.wrapper.offsetWidth; const wrapperHeight = dom.wrapper.offsetHeight; newLeft = Math.max(0, Math.min(newLeft, viewportWidth - wrapperWidth)); newTop = Math.max(0, Math.min(newTop, viewportHeight - wrapperHeight)); dom.wrapper.style.left = `${newLeft}px`; dom.wrapper.style.top = `${newTop}px`; } }, true);
    document.addEventListener('mouseup', () => { isDragging = false; }, true);

    // -----------------------------------------------------------------
    // 3. UIの見た目を更新する関数群をAPIとして外に公開する
    // -----------------------------------------------------------------
    return {
        getPopupElements: () => ({
            textSettings: { popup: dom.textSettingsPopup, button: dom.textSettingsBtn },
            speakerSettings: { popup: dom.speakerSettingsPopup, button: dom.speakerSettingsBtn },
            trimSettings: { popup: dom.trimSettingsPopup, button: dom.trimSettingsBtn },
            separationSettings: { popup: dom.separationSettingsPopup, button: dom.separationSettingsBtn },
            speaker: { popup: dom.speakerSelectPopup, button: dom.speakerPopupBtn },
        }),

        toggleSettingsPopup: (popup, button, show) => {
            popup.classList.toggle('hidden', !show);
            if (show) {
                const wrapperRect = dom.wrapper.getBoundingClientRect();
                const buttonRect = button.getBoundingClientRect();
                
                let top = buttonRect.bottom - wrapperRect.top;
                let left = buttonRect.left - wrapperRect.left;

                const popupHeight = popup.offsetHeight;
                const viewportHeight = window.innerHeight;
                if (buttonRect.bottom + popupHeight > viewportHeight) {
                    top = buttonRect.top - wrapperRect.top - popupHeight;
                }

                const popupWidth = popup.offsetWidth;
                const viewportWidth = window.innerWidth;
                 if (buttonRect.left + popupWidth > viewportWidth) {
                    left = wrapperRect.width - popupWidth - 20;
                }
                
                popup.style.top = `${Math.max(0, top)}px`;
                popup.style.left = `${Math.max(0, left)}px`;
            }
        },

        getCursorDomInfo: () => {
            const selection = shadowRoot.getSelection();
            if (!selection || selection.rangeCount === 0) return null;
            const range = selection.getRangeAt(0);
            if (!dom.textEditor.contains(range.startContainer)) return null;
            let textNode = range.startContainer;
            let offset = range.startOffset;
            if (textNode.nodeType !== Node.TEXT_NODE) {
                const walker = document.createTreeWalker(dom.textEditor, NodeFilter.SHOW_TEXT);
                let bestNode = null;
                while(walker.nextNode()) {
                    const nodeRange = document.createRange();
                    nodeRange.selectNode(walker.currentNode);
                    if (range.startContainer === nodeRange.endContainer && range.startOffset >= nodeRange.endOffset) {
                         bestNode = walker.currentNode;
                    }
                }
                if (bestNode) {
                    textNode = bestNode;
                    offset = bestNode.nodeValue.length;
                } else {
                    return null;
                }
            }
            return { textNode, offset };
        },
        getTextFromEditor: () => dom.textEditor.innerText,
        setTextInEditor: (text) => { dom.textEditor.textContent = text; },
        getHighlightSpans: () => Array.from(dom.textEditor.querySelectorAll('span')),
        getSelectorValue: () => dom.selectorSelect.value,
        getNewSelectorInfo: () => ({ name: dom.selectorNameInput.value.trim(), selector: dom.selectorCssInput.value.trim() }),
        getSpeakerValue: () => dom.speakerSelect.value,
        getNewSpeakerInfo: () => ({ name: dom.speakerNameInput.value.trim(), id: dom.speakerIdInput.value.trim() }),
        getCurrentParams: () => {
            const params = {};
            dom.parametersGrid.querySelectorAll("input[type=range]").forEach(s => { params[s.id] = s.value; });
            return params;
        },
        getTrimSettings: () => ({ enabled: dom.enableTrimCheckbox.checked, trimStrings: dom.trimStringsTextarea.value }),
        getSeparationEnablement: () => ({ enabled: dom.enableSeparationCheckbox.checked, readTriggerEnabled: dom.readTriggerCheckbox.checked }),
        getNewRuleInfo: () => ({ trigger: dom.ruleTriggerInput.value.trim(), speakerId: dom.ruleSpeakerSelect.value }),
        clearNewRuleInput: () => { dom.ruleTriggerInput.value = ""; },
        isServerRunning: () => !!dom.serverStatusContainer.querySelector('.server-status-indicator.running'),

        remove: () => guiHost.remove(),
        toggleVisibility: () => { guiHost.style.display = (guiHost.style.display === 'none') ? 'block' : 'none'; },

        toggleMode: (isSimple) => {
            dom.wrapper.classList.toggle('simple-mode', isSimple);
            dom.guiBody.classList.toggle('hidden', isSimple);
            dom.simpleControls.classList.toggle('hidden', !isSimple);
            dom.playbackControls.classList.toggle('hidden', isSimple);
        },

        updateStatus: (text) => { dom.readStatus.textContent = text; },
        
        updateServerStatus: (results) => {
            dom.serverStatusContainer.innerHTML = '';
            if (results && Array.isArray(results)) {
                results.forEach(res => {
                    const button = document.createElement('button');
                    button.className = 'server-status-btn';
                    button.title = res.message;
                    button.innerHTML = ` <span class="server-status-indicator ${res.status}"></span> <span class="engine-name">${res.name}</span> `;
                    dom.serverStatusContainer.appendChild(button);
                });
            } else {
                dom.serverStatusContainer.innerHTML = `<button class="server-status-btn">BG通信失敗</button>`;
            }
        },

        renderSpeakerOptions: (speakerList, currentSpeakerId, getSpeakerDisplayName) => {
            const currentVal = dom.speakerSelect.value;
            dom.speakerSelect.innerHTML = "";
            speakerList.forEach(speaker => {
                const option = document.createElement("option");
                option.value = speaker.id;
                option.textContent = getSpeakerDisplayName(speaker);
                dom.speakerSelect.appendChild(option);
            });
            if (currentSpeakerId) dom.speakerSelect.value = currentSpeakerId;
            else if (currentVal) dom.speakerSelect.value = currentVal;
            else if (speakerList.length > 0) dom.speakerSelect.value = speakerList[0].id;
        },
        
        renderSelectorOptions: (selectorList, lastSelector) => {
            const currentVal = dom.selectorSelect.value;
            dom.selectorSelect.innerHTML = "";
            selectorList.forEach(item => {
                const option = document.createElement("option");
                option.value = item.selector;
                option.textContent = item.name;
                option.dataset.name = item.name;
                dom.selectorSelect.appendChild(option);
            });
            if (lastSelector) dom.selectorSelect.value = lastSelector;
            else if (currentVal) dom.selectorSelect.value = currentVal;
            else if (selectorList.length > 0) dom.selectorSelect.value = selectorList[0].selector;
        },

        updateSelectorInputs: (name, selector) => {
            dom.selectorNameInput.value = name;
            dom.selectorCssInput.value = selector;
        },

        updateSpeakerInputs: (name, id, engineId) => {
            dom.speakerNameInput.value = name;
            dom.speakerIdInput.value = id;
            dom.engineBtnAivis.classList.toggle('selected', engineId === 'aivis');
            dom.engineBtnVoicevox.classList.toggle('selected', engineId === 'voicevox');
        },

        updateAllPlaybackButtons: (uiState, hasText, isServerRunning) => {
            if (uiState === 'stopped') {
                dom.playPauseBtn.textContent = '▶'; dom.playPauseBtn.title = '読み上げ開始'; dom.playPauseBtn.disabled = !hasText || !isServerRunning;
                dom.stopBtn.disabled = true;
                dom.playPauseSimpleBtn.textContent = '▶'; dom.playPauseSimpleBtn.title = '再生'; dom.playPauseSimpleBtn.disabled = !hasText || !isServerRunning;
            } else if (uiState === 'paused') {
                dom.playPauseBtn.textContent = '▶'; dom.playPauseBtn.title = '再開'; dom.playPauseBtn.disabled = false;
                dom.stopBtn.disabled = false;
                dom.playPauseSimpleBtn.textContent = '▶'; dom.playPauseSimpleBtn.title = '再開'; dom.playPauseSimpleBtn.disabled = false;
            } else { // playing
                dom.playPauseBtn.textContent = '❙ ❙'; dom.playPauseBtn.title = '一時停止'; dom.playPauseBtn.disabled = false;
                dom.stopBtn.disabled = false;
                dom.playPauseSimpleBtn.textContent = '❙ ❙'; dom.playPauseSimpleBtn.title = '一時停止'; dom.playPauseSimpleBtn.disabled = false;
            }
            if (uiState === 'playing' || uiState === 'paused') {
                dom.getAndReadSimpleBtn.textContent = '■'; dom.getAndReadSimpleBtn.title = '停止'; dom.getAndReadSimpleBtn.classList.add('is-stopping'); dom.getAndReadSimpleBtn.disabled = false;
            } else {
                dom.getAndReadSimpleBtn.textContent = 'T/▶'; dom.getAndReadSimpleBtn.title = 'テキスト取得&再生'; dom.getAndReadSimpleBtn.classList.remove('is-stopping'); dom.getAndReadSimpleBtn.disabled = !isServerRunning;
            }
        },

        createParameterSliders: (lastParams) => {
            const paramDefs = [ { id: 'speed', label: '話速', min: 0.5, max: 2, step: 0.01, val: 1.0 }, { id: 'pitch', label: '音高', min: -0.15, max: 0.15, step: 0.01, val: 0.0 }, { id: 'volume', label: '音量', min: 0, max: 2, step: 0.01, val: 1.0 }, { id: 'intonation', label: '抑揚', min: 0, max: 2, step: 0.01, val: 1.0 }, { id: 'pre', label: '開始無音(秒)', min: 0, max: 1, step: 0.01, val: 0.1 }, { id: 'post', label: '終了無音(秒)', min: 0, max: 1, step: 0.01, val: 0.1 } ];
            if(lastParams){ paramDefs.forEach(p => { if(lastParams[p.id]) p.val = lastParams[p.id]; }); }
            dom.parametersGrid.innerHTML = paramDefs.map(p => `<div class="param-item"><label for="${p.id}">${p.label}</label><div><input type="range" id="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}"><span id="val-${p.id}">${parseFloat(p.val).toFixed(2)}</span></div></div>`).join('');
        },

        renderInitialCheckboxes: (settings) => {
            dom.rubyProcessingCheckbox.checked = settings.ruby;
            dom.getAllTextCheckbox.checked = settings.getAllText;
            dom.scrollToHighlightCheckbox.checked = settings.scrollToHighlight;
        },

        renderTrimSettings: (settings) => {
            dom.enableTrimCheckbox.checked = settings.enabled;
            dom.trimStringsTextarea.value = settings.trimStrings;
        },

        renderSeparationSettings: (settings, speakerList, getSpeakerDisplayName) => {
            dom.enableSeparationCheckbox.checked = settings.enabled;
            dom.readTriggerCheckbox.checked = settings.readTriggerEnabled;
            const getMarkerColorClassName = (speakerId) => { const speakerIndex = speakerList.findIndex(s => s.id === speakerId); return speakerIndex === -1 ? 'marker-color-default' : `marker-color-${speakerIndex % COLOR_PALETTE.length}`; };
            dom.ruleSpeakerSelect.innerHTML = speakerList.map(s => `<option value="${s.id}">${getSpeakerDisplayName(s)}</option>`).join('');
            dom.rulesList.innerHTML = '';
            if (settings.rules) {
                settings.rules.forEach(rule => {
                    const speaker = speakerList.find(s => s.id === rule.speakerId);
                    const li = document.createElement('li');
                    li.innerHTML = `<span><span class="rule-color-marker ${getMarkerColorClassName(rule.speakerId)}"></span>「${rule.trigger}」 → <strong>${speaker ? getSpeakerDisplayName(speaker) : '不明な話者'}</strong></span><button class="small-btn rule-delete-btn" data-trigger="${rule.trigger}">削除</button>`;
                    dom.rulesList.appendChild(li);
                });
            }
        },

        updateAutoReadButtonsUI: (isEnabled) => {
            dom.autoReadBtn.classList.toggle('active', isEnabled);
            dom.autoReadSimpleBtn.classList.toggle('active', isEnabled);
        },
        
        updateHighlight: (chunks, defaultSpeakerId, speakerList) => {
            const saveCursor = () => { const sel = shadowRoot.getSelection(); if (sel.rangeCount > 0) { const range = sel.getRangeAt(0); const preRange = range.cloneRange(); preRange.selectNodeContents(dom.textEditor); preRange.setEnd(range.startContainer, range.startOffset); const start = preRange.toString().length; return { start, end: start + range.toString().length }; } return { start: 0, end: 0 }; };
            const restoreCursor = (pos) => { let charIndex = 0; const range = document.createRange(); range.setStart(dom.textEditor, 0); range.collapse(true); const stack = [dom.textEditor]; let node, foundStart = false; while ((node = stack.pop())) { if (node.nodeType === 3) { const nextCharIndex = charIndex + node.length; if (!foundStart && pos.start >= charIndex && pos.start <= nextCharIndex) { range.setStart(node, pos.start - charIndex); foundStart = true; } if (foundStart && pos.end >= charIndex && pos.end <= nextCharIndex) { range.setEnd(node, pos.end - charIndex); break; } charIndex = nextCharIndex; } else { let i = node.childNodes.length; while (i--) { stack.push(node.childNodes[i]); } } } const sel = shadowRoot.getSelection(); sel.removeAllRanges(); sel.addRange(range); };

            const getSpeakerColorClassName = (id, isTrigger) => {
                const separationEnabled = dom.enableSeparationCheckbox.checked;
                const readTriggerEnabled = dom.readTriggerCheckbox.checked;

                if (!separationEnabled) return 'speaker-color-default';

                if (isTrigger) {
                    return readTriggerEnabled ? 'speaker-color-default' : `speaker-color-${speakerList.findIndex(s => s.id === id) % COLOR_PALETTE.length}`;
                }
                
                const idx = speakerList.findIndex(s => s.id === id);
                return idx === -1 ? 'speaker-color-default' : `speaker-color-${idx % COLOR_PALETTE.length}`;
            };
            
            const cursor = saveCursor();
            dom.textEditor.innerHTML = '';
            if (chunks.length === 0) { dom.textEditor.innerHTML = '<br>'; } 
            else {
                chunks.forEach(chunk => {
                    const span = document.createElement('span');
                    span.className = getSpeakerColorClassName(chunk.speakerId, chunk.isTrigger);
                    span.dataset.speakerId = chunk.speakerId;
                    span.dataset.isTrigger = chunk.isTrigger;
                    span.style.whiteSpace = 'pre-wrap';
                    span.textContent = chunk.text;
                    dom.textEditor.appendChild(span);
                });
            }
            restoreCursor(cursor);
        },

        redrawTextEditorWithHighlight: (chunks, currentPlaybackIndex, scrollToHighlightEnabled, defaultSpeakerId, speakerList) => {
            const getSpeakerColorClassName = (id, isTrigger) => {
                const separationEnabled = dom.enableSeparationCheckbox.checked;
                const readTriggerEnabled = dom.readTriggerCheckbox.checked;
                if (!separationEnabled) return 'speaker-color-default';
                if (isTrigger) {
                    return readTriggerEnabled ? 'speaker-color-default' : `speaker-color-${speakerList.findIndex(s => s.id === id) % COLOR_PALETTE.length}`;
                }
                const idx = speakerList.findIndex(s => s.id === id);
                return idx === -1 ? 'speaker-color-default' : `speaker-color-${idx % COLOR_PALETTE.length}`;
            };
            
            dom.textEditor.innerHTML = '';
            let playableSentenceCounter = 0;

            chunks.forEach(chunk => {
                const span = document.createElement('span');
                span.className = getSpeakerColorClassName(chunk.speakerId, chunk.isTrigger);
                span.dataset.speakerId = chunk.speakerId;
                span.dataset.isTrigger = chunk.isTrigger;

                const sentences = chunk.text.split(/([。！？\n])/g);
                for (let i = 0; i < sentences.length; i += 2) {
                    const sentencePart = sentences[i];
                    const delimiter = sentences[i + 1] || '';
                    const fullSentence = sentencePart + delimiter;
                    if (!fullSentence) continue;

                    let isPlayable = true;
                    if (dom.enableSeparationCheckbox.checked && chunk.isTrigger && !dom.readTriggerCheckbox.checked) {
                        isPlayable = false;
                    }

                    if (isPlayable && fullSentence.trim()) {
                        if (playableSentenceCounter === currentPlaybackIndex) {
                            const mark = document.createElement('mark');
                            mark.className = 'current-sentence';
                            mark.textContent = fullSentence;
                            span.appendChild(mark);
                        } else {
                            span.appendChild(document.createTextNode(fullSentence));
                        }
                        playableSentenceCounter++;
                    } else {
                        span.appendChild(document.createTextNode(fullSentence));
                    }
                }
                dom.textEditor.appendChild(span);
            });
            
            const mark = s.querySelector('mark.current-sentence');
            if(mark && scrollToHighlightEnabled) {
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },

        setCheckSpeakersButtonState: (text, disabled) => {
            dom.checkSpeakersBtn.textContent = text;
            dom.checkSpeakersBtn.disabled = disabled;
        },

        alert: (message) => {
            alert(message);
        },

        toggleSpeakerPopup: (show) => {
            dom.speakerSelectPopup.classList.toggle('hidden', !show);
        },
        renderPopupSpeakerList: (speakerList, currentSpeakerId, getSpeakerDisplayName) => {
            dom.popupSpeakerList.innerHTML = speakerList.map(speaker => `
                <li data-speaker-id="${speaker.id}" class="${speaker.id === currentSpeakerId ? 'selected' : ''}" title="${getSpeakerDisplayName(speaker)}">
                    ${getSpeakerDisplayName(speaker)}
                </li>
            `).join('');
        },
        getPopupElement: () => dom.speakerSelectPopup,
        getSpeakerButtonElement: () => dom.speakerPopupBtn,
        setPopupMaxHeight: (height) => {
            dom.speakerSelectPopup.style.maxHeight = height;
        },
        updateCurrentSpeakerDisplay: (speakerName) => {
            dom.currentSpeakerDisplay.textContent = speakerName;
        },

        blurEditor: () => {
            if (shadowRoot.activeElement === dom.textEditor) {
                dom.textEditor.blur();
            }
        },
    };
}