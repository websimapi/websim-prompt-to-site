import { state } from './state.js';
import { security } from './security.js';
import { showToast } from './utils.js';
import { initSecurityModal, startPinFlow as _startPinFlow } from './security-modal.js';

// --- HTML Injection ---
const SETTINGS_MODAL_HTML = `
<div id="settings-modal" class="fixed inset-0 z-[60] hidden">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="settings-backdrop"></div>
    <div class="absolute bottom-0 sm:top-1/2 sm:left-1/2 sm:transform sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:w-[500px] bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div class="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800/50">
            <h2 class="text-lg font-semibold text-white flex items-center gap-2"><i class="fa-solid fa-sliders text-blue-400"></i> Settings</h2>
            <button id="close-settings" class="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="p-5 overflow-y-auto custom-scrollbar space-y-6 flex-1">
            <section>
                <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">AI Model</h3>
                <div class="space-y-2">
                    <label class="flex items-center justify-between p-3 rounded-xl border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800 transition-colors group">
                        <div class="flex items-center gap-3">
                            <input type="radio" name="model-select" value="default" class="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800">
                            <div><div class="font-medium text-gray-200">Built-in Assistant</div><div class="text-xs text-gray-500 group-hover:text-gray-400">Claude 3.5 Sonnet (Websim)</div></div>
                        </div>
                        <i class="fa-solid fa-check text-blue-500 opacity-0 selected-indicator"></i>
                    </label>
                    <div id="openrouter-selection-container" class="opacity-50 pointer-events-none transition-opacity">
                        <label class="flex items-center justify-between p-3 rounded-xl border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800 transition-colors group mb-2">
                            <div class="flex items-center gap-3">
                                <input type="radio" name="model-select" value="openrouter" class="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800" disabled>
                                <div><div class="font-medium text-gray-200">OpenRouter</div><div class="text-xs text-gray-500 group-hover:text-gray-400">Use custom models via API</div></div>
                            </div>
                            <i class="fa-solid fa-check text-blue-500 opacity-0 selected-indicator"></i>
                        </label>
                        <div id="openrouter-models-wrapper" class="pl-7 hidden">
                            <select id="openrouter-model-select" class="w-full bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5">
                                <option value="" disabled selected>Select a model...</option>
                                <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                                <option value="openai/gpt-4o">GPT-4o</option>
                                <option value="meta-llama/llama-3.1-70b-instruct">Llama 3.1 70B</option>
                            </select>
                            <div class="flex justify-between items-center mt-1 px-1">
                                <button type="button" id="refresh-models" class="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><i class="fa-solid fa-sync"></i> Refresh list</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <section class="pt-2 border-t border-gray-800">
                <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">OpenRouter Configuration</h3>
                <div id="key-state-none">
                    <button id="btn-add-key" class="w-full py-2 px-4 rounded-xl border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 hover:bg-gray-800 transition-all flex items-center justify-center gap-2 text-sm"><i class="fa-solid fa-plus"></i> Configure OpenRouter API Key</button>
                </div>
                <div id="key-state-configured" class="hidden">
                    <div class="bg-blue-900/10 border border-blue-500/30 rounded-xl p-3 mb-3">
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-2 text-blue-400 text-sm font-medium"><i class="fa-solid fa-shield-halved"></i> API Key Encrypted</div>
                            <div id="key-status-indicator" class="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 flex items-center gap-1"><i class="fa-solid fa-lock text-[10px]"></i> Locked</div>
                        </div>
                        <div class="text-xs text-gray-500 font-mono bg-gray-900/50 p-2 rounded mb-3 truncate tracking-widest">or-••••••••••••••••</div>
                        <div class="flex gap-2">
                            <button id="btn-manage-key" class="flex-1 py-1.5 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors border border-gray-700">Change Key</button>
                            <button id="btn-remove-key" class="py-1.5 px-3 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 text-xs rounded-lg transition-colors border border-red-900/30">Remove</button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</div>`;

// --- Logic ---
export function initSettings() {
    document.body.insertAdjacentHTML('beforeend', SETTINGS_MODAL_HTML);
    
    // Initialize PIN Modal via module
    initSecurityModal({
        saveSettings,
        updateUI,
        fetchModels
    });
    
    loadSettings();
    setupListeners();
}

function loadSettings() {
    const stored = JSON.parse(localStorage.getItem('app_settings') || '{}');
    state.settings.useOpenRouter = stored.useOpenRouter || false;
    state.settings.openRouterModel = stored.openRouterModel || "anthropic/claude-3.5-sonnet";
    const encData = localStorage.getItem('openrouter_enc');
    state.settings.hasKey = !!encData;
    
    if (state.settings.useOpenRouter && !state.settings.hasKey) {
        state.settings.useOpenRouter = false;
    }
}

function saveSettings() {
    localStorage.setItem('app_settings', JSON.stringify({
        useOpenRouter: state.settings.useOpenRouter,
        openRouterModel: state.settings.openRouterModel
    }));
}

function setupListeners() {
    const d = {
        btnSettings: document.getElementById('btn-settings'),
        closeSettings: document.getElementById('close-settings'),
        settingsBackdrop: document.getElementById('settings-backdrop'),
        settingsModal: document.getElementById('settings-modal'),
        radioDefault: document.querySelector('input[name="model-select"][value="default"]'),
        radioOpenRouter: document.querySelector('input[name="model-select"][value="openrouter"]'),
        openRouterModelSelect: document.getElementById('openrouter-model-select'),
        refreshModelsBtn: document.getElementById('refresh-models'),
        btnAddKey: document.getElementById('btn-add-key'),
        btnManageKey: document.getElementById('btn-manage-key'),
        btnRemoveKey: document.getElementById('btn-remove-key'),
    };

    // Toggle
    const toggle = (show) => {
        state.settings.isOpen = show;
        d.settingsModal.classList.toggle('hidden', !show);
        if(show) updateUI();
    };
    d.btnSettings?.addEventListener('click', () => toggle(true));
    d.closeSettings?.addEventListener('click', () => toggle(false));
    d.settingsBackdrop?.addEventListener('click', () => toggle(false));

    // Models
    d.radioDefault?.addEventListener('change', () => {
        state.settings.useOpenRouter = false;
        saveSettings();
        updateUI();
    });
    d.radioOpenRouter?.addEventListener('change', () => {
        if(!state.settings.hasKey) { d.radioDefault.checked = true; return; }
        state.settings.useOpenRouter = true;
        saveSettings();
        updateUI();
        if(!security.isUnlocked()) startPinFlow('unlock', "Unlock to Enable OpenRouter");
    });
    d.openRouterModelSelect?.addEventListener('change', (e) => {
        state.settings.openRouterModel = e.target.value;
        saveSettings();
    });
    d.refreshModelsBtn?.addEventListener('click', fetchModels);

    // Keys (Delegates to Security Module)
    d.btnAddKey?.addEventListener('click', () => startPinFlow('setup'));
    d.btnManageKey?.addEventListener('click', () => startPinFlow('setup'));
    d.btnRemoveKey?.addEventListener('click', () => {
        if(confirm("Remove API key?")) {
            localStorage.removeItem('openrouter_enc');
            security.lock();
            state.settings.hasKey = false;
            state.settings.useOpenRouter = false;
            d.radioDefault.checked = true;
            saveSettings();
            updateUI();
            showToast("Key removed");
        }
    });

    // External Trigger
    window.addEventListener('security-locked', () => {
        updateUI();
        showToast("Session locked");
    });
}

export function updateUI() {
    const els = {
        radioDefault: document.querySelector('input[name="model-select"][value="default"]'),
        radioOpenRouter: document.querySelector('input[name="model-select"][value="openrouter"]'),
        openRouterContainer: document.getElementById('openrouter-selection-container'),
        openRouterModelsWrapper: document.getElementById('openrouter-models-wrapper'),
        openRouterModelSelect: document.getElementById('openrouter-model-select'),
        keyStateNone: document.getElementById('key-state-none'),
        keyStateConfigured: document.getElementById('key-state-configured'),
        keyStatusIndicator: document.getElementById('key-status-indicator'),
    };

    if (state.settings.useOpenRouter) {
        els.radioOpenRouter.checked = true;
        els.openRouterModelsWrapper.classList.remove('hidden');
    } else {
        els.radioDefault.checked = true;
        els.openRouterModelsWrapper.classList.add('hidden');
    }
    
    if (state.settings.hasKey) {
        els.radioOpenRouter.disabled = false;
        els.openRouterContainer.classList.remove('opacity-50', 'pointer-events-none');
        els.keyStateNone.classList.add('hidden');
        els.keyStateConfigured.classList.remove('hidden');
        
        const isUnlocked = security.isUnlocked();
        els.keyStatusIndicator.innerHTML = isUnlocked 
            ? '<i class="fa-solid fa-lock-open text-[10px]"></i> Unlocked'
            : '<i class="fa-solid fa-lock text-[10px]"></i> Locked';
        els.keyStatusIndicator.className = `text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${isUnlocked ? 'bg-green-900/20 text-green-400 border-green-900/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`;
        
        if (isUnlocked && els.openRouterModelSelect.children.length <= 4) fetchModels();
    } else {
        els.radioOpenRouter.disabled = true;
        els.openRouterContainer.classList.add('opacity-50', 'pointer-events-none');
        els.keyStateNone.classList.remove('hidden');
        els.keyStateConfigured.classList.add('hidden');
    }

    els.openRouterModelSelect.value = state.settings.openRouterModel;
}

// Wrapper for Security Modal flow
export function startPinFlow(mode, customTitle) {
    _startPinFlow(mode, customTitle);
}

// tombstone: removed PIN modal HTML and logic (moved to security-modal.js)
// removed function startPinFlow() {} (replaced by wrapper)
// removed function closePinModal() {}
// removed function handlePinConfirm() {}
// removed function showPinError() {}

async function fetchModels() {
    const key = security.getKey();
    if (!key) return; 
    
    const btn = document.getElementById('refresh-models');
    const select = document.getElementById('openrouter-model-select');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    try {
        const response = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${key}` }
        });
        if (response.ok) {
            const data = await response.json();
            const models = data.data.sort((a,b) => a.name.localeCompare(b.name));
            select.innerHTML = '<option value="" disabled>Select a model...</option>';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.id === state.settings.openRouterModel) opt.selected = true;
                select.appendChild(opt);
            });
        }
    } catch (e) { console.error(e); } 
    finally { btn.innerHTML = originalText; }
}