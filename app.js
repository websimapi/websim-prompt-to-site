import { state, room, events } from './state.js';
import { security } from './security.js';
import { showToast, setLoading, setupVoiceInput } from './utils.js';
import { initSettings, startPinFlow } from './settings.js';
import { initProjects, loadProject, getCurrentFiles } from './projects.js';
import { generateProject } from './ai.js';

// --- Initialization ---
async function init() {
    initSettings();
    initProjects();
    setupEventListeners();
    
    // Resume previous project if ID exists
    if (state.projectId) {
        await loadProject(state.projectId);
    }
    
    document.getElementById('prompt-input')?.focus();
}

function setupEventListeners() {
    const input = document.getElementById('prompt-input');
    const btnSend = document.getElementById('btn-send');
    
    // Input Auto-resize
    input?.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        btnSend.disabled = !input.value.trim() || state.isGenerating;
        btnSend.classList.toggle('opacity-50', btnSend.disabled);
    });

    // Send Handlers
    btnSend?.addEventListener('click', () => handleSend());
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Suggestions
    document.querySelectorAll('.suggestion-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            input.value = btn.dataset.prompt;
            input.dispatchEvent(new Event('input'));
            handleSend();
        });
    });
    
    // Voice
    setupVoiceInput(input, document.getElementById('btn-mic'));

    // Loading State Listener
    window.addEventListener('loading-state-changed', () => {
        btnSend.disabled = !input.value.trim() || state.isGenerating;
        btnSend.classList.toggle('opacity-50', btnSend.disabled);
    });

    // Retry Listener (from Settings/PIN flow)
    events.addEventListener('retry-generation', () => {
        if (state.pendingPrompt) handleSend(true);
    });
}

async function handleSend(isRetry = false) {
    const input = document.getElementById('prompt-input');
    const prompt = isRetry ? state.pendingPrompt : input.value.trim();
    
    if (!prompt) return;
    
    // Security Check
    if (state.settings.useOpenRouter && !security.isUnlocked()) {
        state.pendingPrompt = prompt;
        startPinFlow('unlock', "Unlock OpenRouter to Generate");
        return;
    }

    if (state.isGenerating) return;

    setLoading(true, state.projectId ? "Refining project..." : "Architecting new project...");
    
    try {
        // Create Project if needed
        if (!state.projectId) {
            const name = prompt.split(' ').slice(0, 4).join(' ') + (prompt.split(' ').length > 4 ? '...' : '');
            const project = await room.collection('project').create({ name });
            await loadProject(project.id); // Triggers subscription
            
            // Wait a tick for subscription to activate
            await new Promise(r => setTimeout(r, 100));
        }

        const currentFiles = getCurrentFiles();
        const result = await generateProject(prompt, currentFiles);
        
        if (result) {
            state.pendingPrompt = null;
            await room.collection('version').create({
                project_id: state.projectId,
                prompt: prompt,
                files: JSON.stringify(result.files),
                description: result.description || "Updated project",
            });
            
            input.value = '';
            input.style.height = 'auto';
            showToast(`Version generated!`);
        }
    } catch (error) {
        console.error(error);
        showToast("Generation failed. Please try again.");
    } finally {
        setLoading(false);
    }
}

// Boot
init();