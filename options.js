// options.js - Gerencia configurações avançadas da extensão
// - Toggle do filtro adulto
// - Armazenar/remover chave Safe Browsing
// - Listar/remover padrões auto bloqueados
// - Resetar uso diário

function $(id) {
    return document.getElementById(id);
}

async function loadState() {
    const {enableAdultFilter, safeBrowsingApiKey, autoBlockedPatterns = []} = await chrome.storage.local.get([
        'enableAdultFilter', 'safeBrowsingApiKey', 'autoBlockedPatterns'
    ]);
    $('adultFilterToggle').checked = !!enableAdultFilter;
    $('apiKeyInput').value = safeBrowsingApiKey || '';
    renderAuto(autoBlockedPatterns);
    updateApiKeyStatus();
}

function updateApiKeyStatus() {
    const val = $('apiKeyInput').value.trim();
    $('apiKeyStatus').textContent = val ? 'Chave armazenada (oculta).' : 'Nenhuma chave.';
}

function renderAuto(patterns) {
    const tbody = $('autoTableBody');
    tbody.innerHTML = '';
    if (!patterns.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 2;
        td.className = 'small';
        td.textContent = 'Nenhum domínio auto bloqueado.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    patterns.forEach((p) => { // removed unused idx
        const tr = document.createElement('tr');
        const tdP = document.createElement('td');
        tdP.textContent = p;
        tr.appendChild(tdP);
        const tdA = document.createElement('td');
        const btn = document.createElement('button');
        btn.textContent = 'Remover';
        btn.className = 'danger';
        btn.onclick = async () => {
            const {autoBlockedPatterns = []} = await chrome.storage.local.get('autoBlockedPatterns');
            const filtered = autoBlockedPatterns.filter(x => x !== p);
            await chrome.storage.local.set({autoBlockedPatterns: filtered});
            renderAuto(filtered);
        };
        tdA.appendChild(btn);
        tr.appendChild(tdA);
        tbody.appendChild(tr);
    });
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

async function getUsageToday() {
    return new Promise(resolve => {
        chrome.storage.local.get('usageToday', ({usageToday}) => {
            if (!usageToday || usageToday.date !== todayStr()) return resolve({});
            resolve(usageToday.usage || {});
        });
    });
}

function saveEntries(entries, cb) {
    chrome.storage.local.set({blockedEntries: entries}, () => {
        cb && cb();
    });
}

function renderList() {
    const tbody = document.getElementById('manualList');
    if (!tbody) return;
    chrome.storage.local.get('blockedEntries', async ({blockedEntries = []}) => {
        const usage = await getUsageToday();
        tbody.innerHTML = '';
        if (!blockedEntries.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.className = 'small';
            td.textContent = 'Nenhum site adicionado.';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        blockedEntries.forEach(entry => {
            const usedMin = Math.floor((usage[entry.pattern] || 0) / 60000);
            const limitMin = entry.dailyLimitMinutes;
            const tr = document.createElement('tr');
            // Domínio
            const tdDom = document.createElement('td');
            tdDom.textContent = entry.pattern;
            tr.appendChild(tdDom);
            // Limite / Uso
            const tdInfo = document.createElement('td');
            tdInfo.textContent = limitMin ? `Limite: ${limitMin} | Usado: ${usedMin}` : 'Bloqueio imediato';
            tr.appendChild(tdInfo);
            // Editar
            const tdEdit = document.createElement('td');
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '4px';
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '1';
            input.placeholder = 'min';
            input.style.width = '70px';
            if (limitMin) input.value = limitMin;
            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Salvar';
            saveBtn.className = 'saveBtn';
            saveBtn.onclick = () => {
                const raw = input.value.trim();
                let val = raw ? parseInt(raw, 10) : null;
                if (raw && (!val || val <= 0)) val = null;
                chrome.storage.local.get('blockedEntries', ({blockedEntries = []}) => {
                    const idx = blockedEntries.findIndex(e => e.id === entry.id);
                    if (idx >= 0) {
                        blockedEntries[idx].dailyLimitMinutes = val;
                        saveEntries(blockedEntries, renderList);
                    }
                });
            };
            wrap.appendChild(input);
            wrap.appendChild(saveBtn);
            tdEdit.appendChild(wrap);
            tr.appendChild(tdEdit);
            // Ações
            const tdActions = document.createElement('td');
            const rem = document.createElement('button');
            rem.textContent = 'Remover';
            rem.className = 'danger';
            rem.onclick = () => {
                chrome.storage.local.get('blockedEntries', ({blockedEntries = []}) => {
                    const filtered = blockedEntries.filter(e => e.id !== entry.id);
                    saveEntries(filtered, renderList);
                });
            };
            tdActions.appendChild(rem);
            tr.appendChild(tdActions);
            tbody.appendChild(tr);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {


    loadState();
    renderList();

    const addManualForm = document.getElementById('addManualForm');
    addManualForm?.addEventListener('submit', e => {
        e.preventDefault();
        const patternInput = document.getElementById('manualPattern');
        const limitInput = document.getElementById('manualLimit');
        const pattern = patternInput.value.trim();
        if (!pattern) return;
        let limitValRaw = limitInput.value.trim();
        let limitVal = limitValRaw ? parseInt(limitValRaw, 10) : null;
        if (limitValRaw && (!limitVal || limitVal <= 0)) limitVal = null;
        chrome.storage.local.get('blockedEntries', ({blockedEntries = []}) => {
            if (blockedEntries.some(e => e.pattern === pattern)) {
                patternInput.value = '';
                limitInput.value = '';
                return renderList();
            }
            blockedEntries.push({id: crypto.randomUUID(), pattern, dailyLimitMinutes: limitVal});
            saveEntries(blockedEntries, () => {
                patternInput.value = '';
                limitInput.value = '';
                renderList();
            });
        });
    });

    $('adultFilterToggle').addEventListener('change', async (e) => {
        await chrome.storage.local.set({enableAdultFilter: e.target.checked});
    });

    $('saveApiKeyBtn').addEventListener('click', async () => {
        const key = $('apiKeyInput').value.trim();
        await chrome.storage.local.set({safeBrowsingApiKey: key || null});
        updateApiKeyStatus();
    });

    $('clearApiKeyBtn').addEventListener('click', async () => {
        $('apiKeyInput').value = '';
        await chrome.storage.local.remove('safeBrowsingApiKey');
        updateApiKeyStatus();
    });

    $('clearAllAuto').addEventListener('click', async () => {
        if (!confirm('Remover todos os domínios auto bloqueados?')) return;
        await chrome.storage.local.set({autoBlockedPatterns: []});
        renderAuto([]);
    });

    $('resetUsage').addEventListener('click', async () => {
        if (!confirm('Resetar tempo usado hoje?')) return;
        await chrome.storage.local.remove('usageToday');
        alert('Uso diário resetado.');
    });

    // Refresh list/usage periodically
    setInterval(renderList, 60000);

    // Update on external changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.blockedEntries) renderList();
        if (changes.autoBlockedPatterns) {
            renderAuto(changes.autoBlockedPatterns.newValue || []);
        }
    });
});
