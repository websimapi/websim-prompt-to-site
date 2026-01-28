export const room = new WebsimSocket();

export const state = {
    projectId: new URLSearchParams(window.location.search).get('project'),
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
        useOpenRouter: false, 
        openRouterModel: "anthropic/claude-3.5-sonnet",
        hasKey: false, 
    },
    
    // Temp state for PIN flows
    pinFlow: null, 
    pendingPrompt: null, 
};

// Event Bus for decoupled communication
export const events = new EventTarget();