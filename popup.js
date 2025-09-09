// popup.js - Gerencia a lista de bloqueio e limites

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

document.addEventListener('DOMContentLoaded', () => {
    const siteInput = document.getElementById('siteInput');
    const limitInput = document.getElementById('limitInput');
    const addForm = document.getElementById('addForm');
    const blockedList = document.getElementById('blockedList');
    const openOptions = document.getElementById('openOptions');

    openOptions?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

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
            chrome.runtime.sendMessage({type: 'refreshRules'}); // optional future hook
            cb && cb();
        });
    }

    function renderList() {
        chrome.storage.local.get('blockedEntries', async ({blockedEntries = []}) => {
            const usage = await getUsageToday();
            blockedList.innerHTML = '';
            if (!blockedEntries.length) {
                const empty = document.createElement('li');
                empty.textContent = 'Nenhum site adicionado.';
                blockedList.appendChild(empty);
                return;
            }
            blockedEntries.forEach((entry) => {
                const li = document.createElement('li');
                const row1 = document.createElement('div');
                row1.className = 'row';
                const left = document.createElement('div');
                left.innerHTML = `<span class="pattern">${entry.pattern}</span>`;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remover';
                removeBtn.className = 'removeBtn';
                removeBtn.onclick = () => removeEntry(entry.id);
                row1.appendChild(left);
                row1.appendChild(removeBtn);
                li.appendChild(row1);

                const row2 = document.createElement('div');
                row2.className = 'row';
                const usedMin = Math.floor((usage[entry.pattern] || 0) / 60000);
                const limitMin = entry.dailyLimitMinutes;
                const info = document.createElement('div');
                info.className = 'small';
                info.textContent = limitMin ? `Limite: ${limitMin} min | Usado: ${usedMin} min` : 'Bloqueio imediato (sem limite)';
                row2.appendChild(info);

                const editWrap = document.createElement('div');
                editWrap.className = 'limitEdit';
                const limitField = document.createElement('input');
                limitField.type = 'number';
                limitField.min = '1';
                limitField.placeholder = 'Limite';
                if (limitMin) limitField.value = limitMin;
                const saveBtn = document.createElement('button');
                saveBtn.textContent = 'Salvar';
                saveBtn.className = 'saveBtn';
                saveBtn.onclick = () => {
                    const raw = limitField.value.trim();
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
                editWrap.appendChild(limitField);
                editWrap.appendChild(saveBtn);
                row2.appendChild(editWrap);
                li.appendChild(row2);
                blockedList.appendChild(li);
            });
        });
    }

    addForm.onsubmit = (e) => {
        e.preventDefault();
        const pattern = siteInput.value.trim();
        if (!pattern) return;
        let limit = limitInput.value.trim();
        let limitVal = limit ? parseInt(limit, 10) : null;
        if (limit && (!limitVal || limitVal <= 0)) limitVal = null;
        chrome.storage.local.get('blockedEntries', ({blockedEntries = []}) => {
            if (blockedEntries.some(e => e.pattern === pattern)) {
                siteInput.value = '';
                limitInput.value = '';
                return renderList();
            }
            blockedEntries.push({id: crypto.randomUUID(), pattern, dailyLimitMinutes: limitVal});
            saveEntries(blockedEntries, () => {
                siteInput.value = '';
                limitInput.value = '';
                renderList();
            });
        });
    };

    function removeEntry(id) {
        chrome.storage.local.get('blockedEntries', ({blockedEntries = []}) => {
            const filtered = blockedEntries.filter(e => e.id !== id);
            saveEntries(filtered, renderList);
        });
    }

    renderList();
    // Refresh usage periodically while popup open
    setInterval(renderList, 60000);
});
