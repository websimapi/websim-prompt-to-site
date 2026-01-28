import { escape } from 'https://esm.sh/lodash-es@4.17.21';

// --- State Management ---
// Websim Socket
const room = new WebsimSocket();

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
        toast: document.getElementById('toast'),
        toastMsg: document.getElementById('toast-msg'),
        versionBadge: document.getElementById('version-badge'),
        suggestions: document.querySelectorAll('.suggestion-chip'),
    };

    setupEventListeners();
    
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
        e.stopPropagation();
        toggleProjectMenu();
    });
    
    dom.btnNewProject.addEventListener('click', () => {
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
    dom.versionBadge.classList.add('hidden');
    
    // Clean URL
    const url = new URL(window.location);
    url.searchParams.delete('project');
    window.history.replaceState({}, '', url);

    // Close menus
    if (state.historyOpen) toggleHistory();
    if (state.projectMenuOpen) toggleProjectMenu(false);
}

async function loadProject(id) {
    state.projectId = id;
    localStorage.setItem('last_project_id', id);
    
    // Find name if possible (or fetch logic if we were using a dedicated fetch, but subscribe handles it)
    const p = state.projects.find(proj => proj.id === id);
    if (p) {
        state.projectName = p.name;
    } else {
        // Fallback or loading state name
        // We might not have loaded projects yet, so we'll let the subscription update the name
    }
    dom.currentProjectName.textContent = state.projectName;

    // URL Update
    const url = new URL(window.location);
    url.searchParams.set('project', id);
    window.history.replaceState({}, '', url);

    // Subscribe to versions
    if (state.versionUnsubscribe) state.versionUnsubscribe();
    
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

        // Auto-switch to new version logic
        if (wasAtTip && state.versions.length > 0) {
            state.currentVersionIndex = state.versions.length - 1;
            renderProject(getCurrentFiles());
        } else if (state.currentVersionIndex === -1 && state.versions.length > 0) {
             // Initial load
             state.currentVersionIndex = state.versions.length - 1;
             renderProject(getCurrentFiles());
             dom.welcomeScreen.classList.add('hidden');
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

async function handleSend() {
    const prompt = dom.input.value.trim();
    if (!prompt || state.isGenerating) return;

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
        el.onclick = () => loadProject(p.id);
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
        const completion = await websim.chat.completions.create({
            messages: messages,
            json: true
        });

        return JSON.parse(completion.content);
    } catch (e) {
        console.error("AI Error:", e);
        throw e;
    }
}

// generateRandomProject removed/integrated into logic

// --- Rendering ---

function renderProject(files) {
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
    
    // Update badge
    if (state.versions.length > 0) {
        dom.versionBadge.classList.remove('hidden');
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