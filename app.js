import { SecurityManager } from './security.js';

// --- State Management ---
// Websim Socket
const room = new WebsimSocket();
const security = new SecurityManager();

const state = {
    projectId: new URLSearchParams(window.location.search).get('project'), // Null if new project
    projectName: "New Project",
    versions: [], 
    projects: [],
    currentVersionIndex: -1,
    isGenerating: false,
    historyOpen: false,
    projectMenuOpen: false,
    versionUnsubscribe: null,
    
    // Settings State
    settings: {
        isOpen: false,
        useOpenRouter: false, // User preference
        openRouterModel: "anthropic/claude-3.5-sonnet",
        hasKey: false, // If encrypted key exists in storage
    },
    
    // Temp state for PIN flows
    pinFlow: null, // 'setup' | 'unlock' | 'change'
    pendingPrompt: null, // If we intercepted a send
};

// --- DOM Elements ---
let dom = {};

// --- Initialization ---
async function init() {
    // Initialize DOM references safely after load
    dom = {
        preview: document.getElementById('site-preview'),
        input: document.getElementById('prompt-input'),
        btnSend: document.getElementById('btn-send'),
        btnHistory: document.getElementById('btn-history'),
        btnMic: document.getElementById('btn-mic'),
        
        // Project Controls
        btnProjectLabel: document.getElementById('btn-project-label'),
        btnNewProject: document.getElementById('btn-new-project'),
        currentProjectName: document.getElementById('current-project-name'),
        projectMenu: document.getElementById('project-menu'),
        projectList: document.getElementById('project-list'),
        projectSearch: document.getElementById('project-search'),
        
        historyPanel: document.getElementById('history-panel'),
        historyList: document.getElementById('history-list'),
        closeHistory: document.getElementById('close-history'),
        welcomeScreen: document.getElementById('welcome-screen'),
        loadingOverlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        projectLoader: document.getElementById('project-loader'),
        toast: document.getElementById('toast'),
        toastMsg: document.getElementById('toast-msg'),
        versionBadge: document.getElementById('version-badge'),
        suggestions: document.querySelectorAll('.suggestion-chip'),

        // Settings DOM
        btnSettings: document.getElementById('btn-settings'),
        settingsModal: document.getElementById('settings-modal'),
        closeSettings: document.getElementById('close-settings'),
        settingsBackdrop: document.getElementById('settings-backdrop'),
        
        radioDefault: document.querySelector('input[name="model-select"][value="default"]'),
        radioOpenRouter: document.querySelector('input[name="model-select"][value="openrouter"]'),
        openRouterContainer: document.getElementById('openrouter-selection-container'),
        openRouterModelsWrapper: document.getElementById('openrouter-models-wrapper'),
        openRouterModelSelect: document.getElementById('openrouter-model-select'),
        refreshModelsBtn: document.getElementById('refresh-models'),
        
        keyStateNone: document.getElementById('key-state-none'),
        keyStateConfigured: document.getElementById('key-state-configured'),
        btnAddKey: document.getElementById('btn-add-key'),
        btnManageKey: document.getElementById('btn-manage-key'),
        btnRemoveKey: document.getElementById('btn-remove-key'),
        keyStatusIndicator: document.getElementById('key-status-indicator'),
        
        // PIN Modal DOM
        pinModal: document.getElementById('pin-modal'),
        pinBackdrop: document.getElementById('pin-backdrop'),
        pinTitle: document.getElementById('pin-title'),
        pinSubtitle: document.getElementById('pin-subtitle'),
        pinSetupFields: document.getElementById('pin-setup-fields'),
        pinEntryFields: document.getElementById('pin-entry-fields'),
        inputApiKey: document.getElementById('input-api-key'),
        inputPinSetup: document.getElementById('input-pin-setup'),
        inputPinEntry: document.getElementById('input-pin-entry'),
        btnConfirmPin: document.getElementById('btn-confirm-pin'),
        btnCancelPin: document.getElementById('btn-cancel-pin'),
        pinError: document.getElementById('pin-error'),
    };

    // Load persisted settings
    loadSettings();

    setupEventListeners();
    setupSettingsListeners();
    
    // If we have a projectId in URL, try to load it
    if (state.projectId) {
        await loadProject(state.projectId);
    } else {
        // Ensure "New Project" state
        resetToNewProject();
    }
    
    // Subscribe to project list (global)
    room.collection('project').subscribe(projects => {
        state.projects = projects.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        renderProjectList();
        
        // Update current project name if it changed externally
        if (state.projectId) {
            const current = state.projects.find(p => p.id === state.projectId);
            if (current) {
                state.projectName = current.name;
                dom.currentProjectName.textContent = state.projectName;
            }
        }
    });

    if (dom.input) dom.input.focus();
}

function setupEventListeners() {
    // Input Auto-resize
    dom.input.addEventListener('input', () => {
        dom.input.style.height = 'auto';
        dom.input.style.height = Math.min(dom.input.scrollHeight, 120) + 'px';
        updateSendButtonState();
    });

    // Send Button
    dom.btnSend.addEventListener('click', handleSend);
    
    // Enter to send (unless shift held)
    dom.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Suggestions
    dom.suggestions.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.input.value = btn.dataset.prompt;
            dom.input.dispatchEvent(new Event('input')); // Trigger resize
            handleSend();
        });
    });

    // History Toggle
    dom.btnHistory.addEventListener('click', toggleHistory);
    dom.closeHistory.addEventListener('click', toggleHistory);
    
    const historyHandle = document.getElementById('history-handle');
    if (historyHandle) historyHandle.addEventListener('click', toggleHistory);

    // Project Controls
    dom.btnProjectLabel.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleProjectMenu();
    });
    
    dom.btnNewProject.addEventListener('click', (e) => {
        e.preventDefault();
        resetToNewProject();
        showToast("Started new project");
    });

    dom.projectSearch.addEventListener('input', (e) => {
        renderProjectList(e.target.value);
    });

    // Click outside handler for Project Menu
    document.addEventListener('click', (e) => {
        if (state.projectMenuOpen && !dom.projectMenu.contains(e.target) && !dom.btnProjectLabel.contains(e.target)) {
            toggleProjectMenu(false);
        }
    });

    // Voice Input
    setupVoiceInput();
    
    // Security Event Listener
    window.addEventListener('security-locked', () => {
        updateSettingsUI();
        showToast("Session locked due to inactivity");
    });
}

function setupSettingsListeners() {
    // Toggle Settings
    const toggleSettings = (show) => {
        state.settings.isOpen = show;
        if (show) {
            dom.settingsModal.classList.remove('hidden');
            updateSettingsUI();
        } else {
            dom.settingsModal.classList.add('hidden');
        }
    };

    dom.btnSettings.addEventListener('click', () => toggleSettings(true));
    dom.closeSettings.addEventListener('click', () => toggleSettings(false));
    dom.settingsBackdrop.addEventListener('click', () => toggleSettings(false));

    // Model Switching
    dom.radioDefault.addEventListener('change', () => {
        state.settings.useOpenRouter = false;
        saveSettings();
        updateSettingsUI();
    });

    dom.radioOpenRouter.addEventListener('change', () => {
        if (!state.settings.hasKey) {
            // Should not be reachable due to disabled attribute, but safety first
            dom.radioDefault.checked = true;
            return;
        }
        state.settings.useOpenRouter = true;
        saveSettings();
        updateSettingsUI();
        
        // Auto-prompt for unlock if needed
        if (!security.isUnlocked()) {
            startPinFlow('unlock', "Unlock to Enable OpenRouter");
        }
    });

    dom.openRouterModelSelect.addEventListener('change', (e) => {
        state.settings.openRouterModel = e.target.value;
        saveSettings();
    });

    dom.refreshModelsBtn.addEventListener('click', fetchOpenRouterModels);

    // Key Management
    dom.btnAddKey.addEventListener('click', () => startPinFlow('setup'));
    dom.btnManageKey.addEventListener('click', () => startPinFlow('setup')); // Re-setup effectively
    
    dom.btnRemoveKey.addEventListener('click', () => {
        if (confirm("Are you sure you want to remove your API key? You will need to re-enter it to use OpenRouter.")) {
            localStorage.removeItem('openrouter_enc');
            security.lock();
            state.settings.hasKey = false;
            state.settings.useOpenRouter = false;
            dom.radioDefault.checked = true;
            saveSettings();
            updateSettingsUI();
            showToast("API Key removed");
        }
    });

    // PIN Modal Actions
    dom.btnCancelPin.addEventListener('click', closePinModal);
    dom.pinBackdrop.addEventListener('click', closePinModal);
    
    dom.btnConfirmPin.addEventListener('click', handlePinConfirm);
    
    // Enter key in PIN inputs
    const handleEnter = (e) => {
        if (e.key === 'Enter') handlePinConfirm();
    };
    dom.inputPinEntry.addEventListener('keydown', handleEnter);
    dom.inputPinSetup.addEventListener('keydown', handleEnter);
    dom.inputApiKey.addEventListener('keydown', handleEnter);
}

// --- Settings Logic ---

function loadSettings() {
    const stored = JSON.parse(localStorage.getItem('app_settings') || '{}');
    state.settings.useOpenRouter = stored.useOpenRouter || false;
    state.settings.openRouterModel = stored.openRouterModel || "anthropic/claude-3.5-sonnet";
    
    const encData = localStorage.getItem('openrouter_enc');
    state.settings.hasKey = !!encData;
    
    // Safety fallback
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

function updateSettingsUI() {
    // Model Selection UI
    if (state.settings.useOpenRouter) {
        dom.radioOpenRouter.checked = true;
        dom.openRouterModelsWrapper.classList.remove('hidden');
    } else {
        dom.radioDefault.checked = true;
        dom.openRouterModelsWrapper.classList.add('hidden');
    }
    
    // Enable/Disable OpenRouter Option based on Key existence
    if (state.settings.hasKey) {
        dom.radioOpenRouter.disabled = false;
        dom.openRouterContainer.classList.remove('opacity-50', 'pointer-events-none');
        dom.keyStateNone.classList.add('hidden');
        dom.keyStateConfigured.classList.remove('hidden');
        
        // Update Lock Status
        const isUnlocked = security.isUnlocked();
        dom.keyStatusIndicator.innerHTML = isUnlocked 
            ? '<i class="fa-solid fa-lock-open text-[10px]"></i> Unlocked'
            : '<i class="fa-solid fa-lock text-[10px]"></i> Locked';
        dom.keyStatusIndicator.className = `text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${isUnlocked ? 'bg-green-900/20 text-green-400 border-green-900/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`;
        
        if (isUnlocked && dom.openRouterModelSelect.children.length <= 4) {
            // Try to fetch models if we haven't already populated fully
            fetchOpenRouterModels();
        }

    } else {
        dom.radioOpenRouter.disabled = true;
        dom.openRouterContainer.classList.add('opacity-50', 'pointer-events-none');
        dom.keyStateNone.classList.remove('hidden');
        dom.keyStateConfigured.classList.add('hidden');
    }

    // Set dropdown value
    dom.openRouterModelSelect.value = state.settings.openRouterModel;
}

// --- PIN & Security Flow ---

function startPinFlow(mode, customTitle) {
    state.pinFlow = mode;
    dom.pinModal.classList.remove('hidden');
    dom.pinError.classList.add('hidden');
    dom.inputPinEntry.value = '';
    dom.inputPinSetup.value = '';
    dom.inputApiKey.value = '';

    if (mode === 'setup') {
        dom.pinTitle.textContent = "Configure Security";
        dom.pinSubtitle.textContent = "Set a PIN to encrypt your API key locally";
        dom.pinSetupFields.classList.remove('hidden');
        dom.pinEntryFields.classList.add('hidden');
        dom.inputApiKey.focus();
    } else {
        dom.pinTitle.textContent = customTitle || "Enter PIN";
        dom.pinSubtitle.textContent = "Unlock your API key to continue";
        dom.pinSetupFields.classList.add('hidden');
        dom.pinEntryFields.classList.remove('hidden');
        dom.inputPinEntry.focus();
    }
}

function closePinModal() {
    dom.pinModal.classList.add('hidden');
    state.pinFlow = null;
    // If we were pending a prompt and canceled, cancel the generation
    if (state.pendingPrompt) {
        state.pendingPrompt = null;
        setLoading(false);
        updateSendButtonState();
    }
}

async function handlePinConfirm() {
    dom.pinError.classList.add('hidden');
    
    if (state.pinFlow === 'setup') {
        const apiKey = dom.inputApiKey.value.trim();
        const pin = dom.inputPinSetup.value.trim();
        
        if (!apiKey.startsWith('sk-or-')) {
            showPinError("Invalid OpenRouter Key (should start with sk-or-)");
            return;
        }
        if (pin.length < 4) {
            showPinError("PIN must be at least 4 digits");
            return;
        }

        try {
            const encryptedData = await security.encrypt(apiKey, pin);
            localStorage.setItem('openrouter_enc', JSON.stringify(encryptedData));
            
            state.settings.hasKey = true;
            state.settings.useOpenRouter = true; // Auto-select on setup
            saveSettings();
            updateSettingsUI();
            closePinModal();
            showToast("API Key encrypted and saved");
            
            // Initial fetch of models
            fetchOpenRouterModels();
            
        } catch (e) {
            console.error(e);
            showPinError("Encryption failed");
        }

    } else if (state.pinFlow === 'unlock') {
        const pin = dom.inputPinEntry.value.trim();
        const encDataStr = localStorage.getItem('openrouter_enc');
        
        if (!encDataStr) {
            closePinModal();
            showToast("No key found");
            return;
        }

        try {
            const success = await security.decrypt(JSON.parse(encDataStr), pin);
            if (success) {
                closePinModal();
                updateSettingsUI();
                showToast("Unlocked successfully");
                
                // Resume pending action if any
                if (state.pendingPrompt) {
                    const prompt = state.pendingPrompt;
                    state.pendingPrompt = null;
                    // Re-trigger handleSend logic, but bypass the check since we are unlocked
                    handleSend(true); // pass flag to indicate retry
                }
            } else {
                showPinError("Incorrect PIN");
                dom.inputPinEntry.value = '';
            }
        } catch (e) {
            showPinError("Decryption error");
        }
    }
}

function showPinError(msg) {
    dom.pinError.textContent = msg;
    dom.pinError.classList.remove('hidden');
}

async function fetchOpenRouterModels() {
    const key = security.getKey();
    if (!key) return; // Silent fail if locked, user will refresh later
    
    const btnContent = dom.refreshModelsBtn.innerHTML;
    dom.refreshModelsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    
    try {
        const response = await fetch("https://openrouter.ai/api/v1/models", {
            headers: {
                "Authorization": `Bearer ${key}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const models = data.data.sort((a,b) => a.name.localeCompare(b.name));
            
            // Keep default/popular ones at top
            const defaults = ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.1-70b-instruct"];
            
            // Clear existing except defaults
            dom.openRouterModelSelect.innerHTML = '<option value="" disabled>Select a model...</option>';
            
            // Add defaults back if they exist in list (or just add them)
            // Actually, let's just dump the fetched list but prioritize some
            
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.id === state.settings.openRouterModel) opt.selected = true;
                dom.openRouterModelSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Failed to fetch models", e);
    } finally {
        dom.refreshModelsBtn.innerHTML = btnContent;
    }
}

function resetToNewProject() {
    state.projectId = null;
    state.projectName = "New Project";
    state.versions = [];
    state.currentVersionIndex = -1;
    
    if (state.versionUnsubscribe) {
        state.versionUnsubscribe();
        state.versionUnsubscribe = null;
    }

    // UI Updates
    dom.currentProjectName.textContent = state.projectName;
    dom.welcomeScreen.classList.remove('hidden');
    dom.preview.srcdoc = ''; // Clear iframe
    dom.projectLoader.classList.add('hidden');
    updateHistoryUI(); // Ensure history UI is cleared
    
    // Clean URL
    const url = new URL(window.location);
    url.searchParams.delete('project');
    window.history.replaceState({}, '', url);

    // Close menus
    if (state.historyOpen) toggleHistory();
    if (state.projectMenuOpen) toggleProjectMenu(false);
}

async function loadProject(id) {
    if (!id) return;
    state.projectId = id;
    localStorage.setItem('last_project_id', id);
    
    // Find name if possible
    const p = state.projects.find(proj => proj.id === id);
    if (p) {
        state.projectName = p.name;
    }
    dom.currentProjectName.textContent = state.projectName;

    // URL Update
    const url = new URL(window.location);
    url.searchParams.set('project', id);
    window.history.replaceState({}, '', url);

    // Subscribe to versions
    if (state.versionUnsubscribe) state.versionUnsubscribe();
    
    // Clear state and UI immediately to prevent bleeding from previous project
    state.versions = [];
    state.currentVersionIndex = -1;
    dom.preview.srcdoc = ''; // Clear iframe
    dom.projectLoader.classList.remove('hidden'); // Show loading state
    dom.welcomeScreen.classList.add('hidden');
    updateHistoryUI();

    state.versionUnsubscribe = room.collection('version').filter({ project_id: id }).subscribe((records) => {
        // Capture if we were at the latest version before update
        const wasAtTip = state.currentVersionIndex === -1 || (state.versions.length > 0 && state.currentVersionIndex === state.versions.length - 1);
        
        const newVersions = records.reverse().map(r => ({
            id: r.id,
            prompt: r.prompt,
            files: JSON.parse(r.files),
            timestamp: new Date(r.created_at),
            description: r.description
        }));

        state.versions = newVersions;
        dom.projectLoader.classList.add('hidden'); // Hide loading state

        // Auto-switch to new version logic
        if (state.versions.length > 0) {
            if (wasAtTip || state.currentVersionIndex === -1) {
                state.currentVersionIndex = state.versions.length - 1;
                renderProject(getCurrentFiles());
            }
        } else {
             // No versions yet
             dom.welcomeScreen.classList.remove('hidden');
        }

        updateHistoryUI();
    });

    // Close menu if open
    toggleProjectMenu(false);
}

function updateSendButtonState() {
    dom.btnSend.disabled = !dom.input.value.trim() || state.isGenerating;
    dom.btnSend.classList.toggle('opacity-50', dom.btnSend.disabled);
}

// --- Core Logic ---

async function handleSend(isRetry = false) {
    // If this is a retry from PIN unlock, use pending prompt or input
    const prompt = isRetry && state.pendingPrompt ? state.pendingPrompt : dom.input.value.trim();
    
    // Check Prompt
    if (!prompt) return;
    
    // Check Lock State for OpenRouter
    if (state.settings.useOpenRouter && !security.isUnlocked()) {
        state.pendingPrompt = prompt;
        startPinFlow('unlock', "Unlock OpenRouter to Generate");
        return;
    }

    if (state.isGenerating) return;

    setLoading(true, state.projectId ? "Refining project..." : "Architecting new project...");
    
    try {
        // If we are in "New Project" mode (no projectId), create the project first
        if (!state.projectId) {
            // Generate a name from the prompt (first 3 words or so)
            const name = prompt.split(' ').slice(0, 4).join(' ') + (prompt.split(' ').length > 4 ? '...' : '');
            
            const project = await room.collection('project').create({
                name: name
            });
            
            state.projectId = project.id;
            state.projectName = project.name;
            dom.currentProjectName.textContent = state.projectName;
            
            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('project', state.projectId);
            window.history.replaceState({}, '', url);
            
            // Set up subscription for this new project immediately
            loadProject(state.projectId); 
        }

        // Construct Context
        const currentFiles = getCurrentFiles();
        
        // AI Request
        const result = await generateProject(prompt, currentFiles);
        
        if (result) {
            // Clear pending prompt if we succeeded
            state.pendingPrompt = null;

            // Create Version Record
            await room.collection('version').create({
                project_id: state.projectId,
                prompt: prompt,
                files: JSON.stringify(result.files),
                description: result.description || "Updated project",
            });
            
            // UI Cleanup
            dom.input.value = '';
            dom.input.style.height = 'auto';
            dom.welcomeScreen.classList.add('hidden');
            showToast(`Version generated!`);
        }
    } catch (error) {
        console.error(error);
        showToast("Generation failed. Please try again.");
    } finally {
        setLoading(false);
        updateSendButtonState();
    }
}

function getCurrentFiles() {
    if (state.currentVersionIndex === -1) return null;
    if (!state.versions || state.versions.length === 0) return null;
    
    // Safety clamp
    if (state.currentVersionIndex >= state.versions.length) {
        state.currentVersionIndex = state.versions.length - 1;
    }
    
    if (!state.versions[state.currentVersionIndex]) return null;
    return state.versions[state.currentVersionIndex].files;
}

// --- Project UI & Logic ---

function toggleProjectMenu(forceState) {
    if (typeof forceState === 'boolean') {
        state.projectMenuOpen = forceState;
    } else {
        state.projectMenuOpen = !state.projectMenuOpen;
    }
    
    const menu = dom.projectMenu;
    const btn = dom.btnProjectLabel;
    
    if (state.projectMenuOpen) {
        menu.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-2');
        menu.classList.add('opacity-100', 'pointer-events-auto', 'translate-y-0');
        dom.projectSearch.focus();
    } else {
        menu.classList.add('opacity-0', 'pointer-events-none', 'translate-y-2');
        menu.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');
    }
}

function renderProjectList(filterText = '') {
    const list = dom.projectList;
    list.innerHTML = '';
    
    const filtered = state.projects.filter(p => 
        p.name.toLowerCase().includes(filterText.toLowerCase())
    );
    
    if (filtered.length === 0) {
        list.innerHTML = '<div class="text-gray-500 text-xs text-center py-4">No projects found</div>';
        return;
    }
    
    filtered.forEach(p => {
        const isActive = p.id === state.projectId;
        const el = document.createElement('div');
        el.className = `p-2 rounded-lg cursor-pointer flex justify-between items-center group transition-colors ${isActive ? 'bg-blue-900/30 text-blue-200' : 'hover:bg-gray-800 text-gray-300'}`;
        el.innerHTML = `
            <div class="truncate text-xs font-medium pr-2">${p.name}</div>
            <div class="text-[10px] text-gray-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                ${new Date(p.created_at).toLocaleDateString()}
            </div>
        `;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            loadProject(p.id);
        });
        list.appendChild(el);
    });
}

// --- AI Integration ---

async function generateProject(prompt, currentFiles) {
    const systemPrompt = `
You are an expert Frontend Developer. Your task is to generate or modify a static website based on the user's prompt.

CONTEXT:
${currentFiles ? "You are modifying an existing project. I will provide the current files. Please update them to fulfill the request. Maintain existing functionality unless asked to change it." : "You are creating a brand new project from scratch."}

OUTPUT FORMAT:
Return strictly valid JSON with no markdown formatting. The JSON must match this schema:
{
  "files": [
    { "path": "index.html", "content": "..." },
    { "path": "styles.css", "content": "..." },
    { "path": "script.js", "content": "..." }
  ],
  "description": "A very brief summary of changes (max 10 words)"
}

REQUIREMENTS:
- Use semantic HTML5.
- Use modern CSS (Flexbox, Grid). You can use 'https://cdn.tailwindcss.com' in the HTML <head> if you want, or write custom CSS.
- Use vanilla JavaScript.
- Images: Use 'https://source.unsplash.com/random/800x600?keyword' (replace keyword) or placeholder colors.
- If modifying, keep the file structure.
- Ensure the design is mobile-responsive.
- Add basic error handling in JS.

USER PROMPT: ${prompt}
    `;

    // Only send file context if it exists and isn't too huge (simulate token limits)
    let messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
    ];

    if (currentFiles) {
        const contextStr = JSON.stringify(currentFiles);
        // Truncate if insanely large (basic safeguard)
        const safeContext = contextStr.length > 50000 ? contextStr.substring(0, 50000) + "...(truncated)" : contextStr;
        messages.splice(1, 0, { 
            role: "user", 
            content: `CURRENT FILES:\n${safeContext}\n\nINSTRUCTIONS: Modify these files based on: "${prompt}"` 
        });
    }

    try {
        if (state.settings.useOpenRouter) {
            return await generateWithOpenRouter(messages);
        } else {
            const completion = await websim.chat.completions.create({
                messages: messages,
                json: true
            });
            return JSON.parse(completion.content);
        }
    } catch (e) {
        console.error("AI Error:", e);
        throw e;
    }
}

async function generateWithOpenRouter(messages) {
    const key = security.getKey();
    if (!key) throw new Error("OpenRouter Key Locked or Missing");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-Title": "Prompt-to-Site Builder"
        },
        body: JSON.stringify({
            model: state.settings.openRouterModel,
            messages: messages,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`OpenRouter Error: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
}

// generateRandomProject removed/integrated into logic

// --- Rendering ---

function renderProject(files) {
    if (!files || !Array.isArray(files)) {
        return; // Safety exit
    }

    const htmlFile = files.find(f => f.path === 'index.html');
    const cssFile = files.find(f => f.path === 'styles.css');
    const jsFile = files.find(f => f.path === 'script.js');

    if (!htmlFile) {
        console.error("No index.html found");
        return;
    }

    // Combine into a single HTML document for the iframe
    let combinedHTML = htmlFile.content;

    // Inject CSS
    if (cssFile) {
        if (combinedHTML.includes('</head>')) {
            combinedHTML = combinedHTML.replace('</head>', `<style>${cssFile.content}</style></head>`);
        } else {
            combinedHTML += `<style>${cssFile.content}</style>`;
        }
    }

    // Inject JS
    if (jsFile) {
        if (combinedHTML.includes('</body>')) {
            combinedHTML = combinedHTML.replace('</body>', `<script>${jsFile.content}</script></body>`);
        } else {
            combinedHTML += `<script>${jsFile.content}</script>`;
        }
    }

    dom.preview.srcdoc = combinedHTML;
}

// --- History & UI ---

function toggleHistory() {
    state.historyOpen = !state.historyOpen;
    const p = dom.historyPanel;
    const inputBar = document.getElementById('input-bar');
    
    if (state.historyOpen) {
        p.classList.remove('opacity-0', 'translate-y-full', 'pointer-events-none');
        p.classList.add('opacity-100', 'translate-y-0', 'pointer-events-auto');
        
        // Square off bottom corners of history panel to join with input
        // Square off top corners of input bar to join with history
        if (inputBar) {
            inputBar.classList.remove('rounded-2xl');
            inputBar.classList.add('rounded-b-2xl', 'rounded-t-sm');
        }
        
        updateHistoryUI();
    } else {
        p.classList.add('opacity-0', 'translate-y-full', 'pointer-events-none');
        p.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
        
        if (inputBar) {
            inputBar.classList.add('rounded-2xl');
            inputBar.classList.remove('rounded-b-2xl', 'rounded-t-sm');
        }
    }
}

function updateHistoryUI() {
    dom.historyList.innerHTML = '';
    
    // Update badge visibility
    if (state.versions.length > 0) {
        dom.versionBadge.classList.remove('hidden');
    } else {
        dom.versionBadge.classList.add('hidden');
    }

    // Empty state
    if (state.versions.length === 0) {
        dom.historyList.innerHTML = `
            <div class="flex flex-col items-center justify-center h-32 text-gray-500 space-y-2 opacity-50 select-none">
                <i class="fa-solid fa-code-branch text-3xl"></i>
                <p class="text-xs font-medium">No version history</p>
            </div>
        `;
        return;
    }

    // Reverse loop to show newest first
    [...state.versions].reverse().forEach((ver, reversedIndex) => {
        const realIndex = state.versions.length - 1 - reversedIndex;
        const isActive = realIndex === state.currentVersionIndex;
        
        const el = document.createElement('div');
        el.className = `p-3 rounded-lg border cursor-pointer transition-all ${isActive ? 'bg-blue-900/30 border-blue-500' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`;
        el.innerHTML = `
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-mono text-gray-500">#${ver.id.substring(0,8)}</span>
                <span class="text-xs text-gray-400">${ver.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div class="font-medium text-sm text-gray-200 mb-1 line-clamp-2">${ver.prompt}</div>
            <div class="text-xs text-gray-500 flex items-center gap-2">
                ${isActive ? '<span class="text-blue-400 font-bold">● Current</span>' : ''}
                <span>${ver.description}</span>
            </div>
        `;
        
        el.addEventListener('click', () => loadVersion(realIndex));
        dom.historyList.appendChild(el);
    });
}

function loadVersion(index) {
    state.currentVersionIndex = index;
    const ver = state.versions[index];
    renderProject(ver.files);
    updateHistoryUI();
    
    // On mobile, maybe close the panel automatically? Let's keep it open for quick browsing
    // but visualize the change
    showToast(`Restored version ${ver.id}`);
}

// --- Utilities ---

function setLoading(isLoading, text) {
    state.isGenerating = isLoading;
    if (isLoading) {
        dom.loadingOverlay.classList.remove('hidden');
        dom.loadingText.textContent = text;
    } else {
        dom.loadingOverlay.classList.add('hidden');
    }
}

function showToast(msg) {
    dom.toastMsg.textContent = msg;
    dom.toast.classList.remove('opacity-0', 'translate-y-4');
    dom.toast.classList.add('opacity-100', 'translate-y-0');
    
    setTimeout(() => {
        dom.toast.classList.add('opacity-0', 'translate-y-4');
        dom.toast.classList.remove('opacity-100', 'translate-y-0');
    }, 3000);
}

function setupVoiceInput() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => {
            dom.btnMic.classList.add('mic-active');
        };

        recognition.onend = () => {
            dom.btnMic.classList.remove('mic-active');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            dom.input.value += (dom.input.value ? ' ' : '') + transcript;
            dom.input.dispatchEvent(new Event('input')); // Resize
        };

        dom.btnMic.addEventListener('click', () => {
            recognition.start();
        });
    } else {
        dom.btnMic.style.display = 'none';
    }
}

function checkUrlParams() {
    // Simple deep linking mock
    const path = window.location.pathname;
    if (path !== '/' && path !== '/index.html') {
        // Assume user wants to load something specific (not implemented fully)
        // console.log("Deep link detected:", path);
    }
}

// Boot
init();