// content.js - Envia 'heartbeat' periódico para o background registrar tempo de uso
// Executa em todas as páginas (http/https). O background identifica se a URL
// corresponde a um padrão monitorado e contabiliza o tempo.

(function () {
    if (!/^https?:/i.test(location.href)) return;

    function ping() {
        try {
            chrome.runtime.sendMessage({type: 'heartbeat'});
        } catch (e) {
        }
    }

    // Primeiro ping rápido
    ping();
    // Intervalo (30s para granularidade razoável sem muito overhead)
    const interval = setInterval(ping, 30000);
    // Quando a aba volta a ficar visível, força novo ping para precisão
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) ping();
    });
    // Segurança: limpa no unload
    window.addEventListener('beforeunload', () => clearInterval(interval));
})();

