    // popup.js — Web-Jotter (stable callbacks, multi-view, newest-first, dropdown, highlights)

    const STORAGE_KEY = "sessions";
    const HL_KEY = "highlights";
    const ACTIVE_VIEW_KEY = "active_view"; // "sessions" | "highlights"

    /* ---------------------------
    Promise helpers (callback-safe)
    ---------------------------- */
    function storageGet(keyOrKeys) {
    return new Promise(resolve => chrome.storage.local.get(keyOrKeys, res => resolve(res)));
    }
    function storageSet(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, () => resolve()));
    }
    function tabsQuery(queryInfo) {
    return new Promise(resolve => chrome.tabs.query(queryInfo, tabs => resolve(tabs)));
    }

    /* ---------------------------
    Init
    ---------------------------- */
    document.addEventListener("DOMContentLoaded", () => {
    init().catch(err => console.error("[Web-Jotter] init error:", err));
    });

    async function init() {
    // Tabs: wire up view switching
    const tabButtons = document.querySelectorAll('.feature-tabs .tab');
    tabButtons.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

    // Sessions: save button
    document.getElementById("saveSessionBtn")?.addEventListener("click", () => {
        saveCurrentTabs().catch(err => console.error("[Web-Jotter] saveCurrentTabs error:", err));
    });

    // Highlights: save button
    document.getElementById("saveHighlightBtn")?.addEventListener("click", () => {
        saveHighlight().catch(err => console.error("[Web-Jotter] saveHighlight error:", err));
    });

    await renderSessions();
    await renderHighlights();

    // Restore last view (default to sessions)
    const store = await storageGet(ACTIVE_VIEW_KEY);
    const last = store[ACTIVE_VIEW_KEY];
        setView(last === "sessions" ? "sessions" : "highlights");
    }

    /* ---------------------------
    View Switching
    ---------------------------- */
    async function setView(view) {
    const sessionsView = document.getElementById('view-sessions');
    const highlightsView = document.getElementById('view-highlights');

    if (view === 'highlights') {
        sessionsView?.classList.add('is-hidden');
        highlightsView?.classList.remove('is-hidden');
    } else {
        highlightsView?.classList.add('is-hidden');
        sessionsView?.classList.remove('is-hidden');
        view = 'sessions';
    }

    document.querySelectorAll('.feature-tabs .tab').forEach(btn => {
        const isActive = btn.dataset.view === view;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });

    await storageSet({ [ACTIVE_VIEW_KEY]: view });
    }

    /* ---------------------------
    Sessions (Tab Saver)
    ---------------------------- */

    // Save current window’s tabs (store {url, title}; NEWEST on TOP)
    async function saveCurrentTabs() {
    const tabs = await tabsQuery({ currentWindow: true });
    const urls = tabs
        .filter(t => t && t.url)
        .map(t => ({ url: t.url, title: t.title || "" }));

    const store = await storageGet(STORAGE_KEY);
    const sessions = Array.isArray(store[STORAGE_KEY]) ? store[STORAGE_KEY] : [];

    const now = Date.now();
    const session = {
        id: now,
        createdAt: now,
        name: `Session ${new Date(now).toLocaleTimeString()}`,
        urls
    };

    sessions.unshift(session); // newest first
    await storageSet({ [STORAGE_KEY]: sessions });
    await renderSessions();
    }

    // Open all tabs from a session
    async function restoreSession(id) {
    const store = await storageGet(STORAGE_KEY);
    const sessions = store[STORAGE_KEY] || [];
    const s = sessions.find(x => x.id === id);
    if (!s) return;

    for (const entry of s.urls || []) {
        const url = typeof entry === "string" ? entry : entry.url;
        if (url) chrome.tabs.create({ url });
    }
    }

    // Delete a saved session
    async function deleteSession(id) {
    const store = await storageGet(STORAGE_KEY);
    const sessions = store[STORAGE_KEY] || [];
    const next = sessions.filter(s => s.id !== id);
    await storageSet({ [STORAGE_KEY]: next });
    await renderSessions();
    }

    // Render session list (sorted newest-first; robust to legacy shapes)
    async function renderSessions() {
    const listEl = document.getElementById("sessionList");
    if (!listEl) return;
    listEl.innerHTML = "";

    const store = await storageGet(STORAGE_KEY);
    let sessions = Array.isArray(store[STORAGE_KEY]) ? store[STORAGE_KEY] : [];

    sessions = sessions
        .map(s => ({
        ...s,
        createdAt: typeof s?.createdAt === "number" ? s.createdAt
                    : (typeof s?.id === "number" ? s.id : 0),
        urls: Array.isArray(s?.urls) ? s.urls : []
        }))
        .sort((a, b) => b.createdAt - a.createdAt);

    if (!sessions.length) {
        listEl.innerHTML = `<li class="session-item"><em>No sessions saved yet.</em></li>`;
        return;
    }

    for (const s of sessions) {
        const li = document.createElement("li");
        li.className = "session-item";

        // header with toggle
        const header = document.createElement("div");
        header.className = "session-header";

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "session-toggle";
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.title = "Show pages";
        toggleBtn.textContent = "▸";

        const titleEl = document.createElement("strong");
        titleEl.className = "session-title";
        titleEl.textContent = `${s.name} • ${s.urls.length} tabs`;

        header.appendChild(toggleBtn);
        header.appendChild(titleEl);

        // centered CTA box (buttons only)
        const ctaBox = document.createElement("div");
        ctaBox.className = "session-cta-box";

        const actions = document.createElement("div");
        actions.className = "session-actions";
        const restoreBtn = document.createElement("button");
        restoreBtn.className = "btn restore";
        restoreBtn.textContent = "Restore";
        restoreBtn.onclick = () => restoreSession(s.id);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn delete";
        deleteBtn.textContent = "Delete";
        deleteBtn.onclick = () => deleteSession(s.id);

        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);
        ctaBox.appendChild(actions);

        // heading above the dropdown list
        const listHeading = document.createElement("div");
        listHeading.className = "tab-section-title";
        listHeading.textContent = "extensions";

        // collapsible list of titles (or hostname/url as fallback)
        const tabList = document.createElement("ul");
        tabList.className = "tab-list is-collapsed";

        for (const entry of s.urls) {
        const url = typeof entry === "string" ? entry : entry.url;
        const title = typeof entry === "string" ? "" : (entry.title || "");
        const label = (title && title.trim()) || hostnameFrom(url) || url || "(unknown)";

        const liTab = document.createElement("li");
        liTab.className = "tab-row";
        liTab.innerHTML = `
            <span class="tab-title" title="${escapeHtml(url || "")}">${escapeHtml(label)}</span>
        `;
        tabList.appendChild(liTab);
        }

        // toggle behavior
        toggleBtn.addEventListener("click", () => {
        const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
        toggleBtn.setAttribute("aria-expanded", String(!isOpen));
        toggleBtn.textContent = isOpen ? "▸" : "▾";
        tabList.classList.toggle("is-collapsed", isOpen);
        });

        li.appendChild(header);
        li.appendChild(ctaBox);
        li.appendChild(listHeading);
        li.appendChild(tabList);
        listEl.appendChild(li);
    }
    }

    /* ---------------------------
    Highlights (local-first)
    ---------------------------- */

    async function saveHighlight() {
    const inp = document.getElementById('highlightInput');
    if (!inp) return;
    const text = (inp.value || '').trim();
    if (!text) return;

    const now = Date.now();
    const store = await storageGet(HL_KEY);
    const arr = Array.isArray(store[HL_KEY]) ? store[HL_KEY] : [];
    arr.unshift({ id: now, createdAt: now, text });

    await storageSet({ [HL_KEY]: arr });
    inp.value = '';
    await renderHighlights();
    }

    async function deleteHighlight(id) {
    const store = await storageGet(HL_KEY);
    const arr = Array.isArray(store[HL_KEY]) ? store[HL_KEY] : [];
    const next = arr.filter(h => h.id !== id);
    await storageSet({ [HL_KEY]: next });
    await renderHighlights();
    }

    async function renderHighlights() {
    const list = document.getElementById('highlightList');
    if (!list) return;
    list.innerHTML = '';

    const store = await storageGet(HL_KEY);
    const arr = Array.isArray(store[HL_KEY]) ? store[HL_KEY] : [];
    if (!arr.length) {
        list.innerHTML = `<li class="hl-item"><em>No highlights yet.</em></li>`;
        return;
    }

    for (const h of arr) {
        const li = document.createElement('li');
        li.className = 'hl-item';

        const row = document.createElement('div');
        row.className = 'hl-row';

        const text = document.createElement('div');
        text.className = 'hl-text';
        text.textContent = h.text;

        const actions = document.createElement('div');
        actions.className = 'hl-actions';

        const copy = document.createElement('button');
        copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(h.text);
            copy.textContent = 'Copied!';
            setTimeout(() => (copy.textContent = 'Copy'), 1200);
        } catch (e) {
            console.error('Clipboard error', e);
            alert('Could not copy to clipboard');
        }
        });

        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', () => deleteHighlight(h.id));

        actions.appendChild(copy);
        actions.appendChild(del);


        actions.appendChild(del);
        row.appendChild(text);
        row.appendChild(actions);
        li.appendChild(row);
        list.appendChild(li);
    }
    }

    /* ---------------------------
    Helpers
    ---------------------------- */
    function hostnameFrom(u) {
    try { return new URL(u).hostname; } catch { return ""; }
    }
    function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, m =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])
    );
    }
