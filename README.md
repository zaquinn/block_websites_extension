# Block Extension (Chrome Manifest V3)

Extensão Chrome (MV3) para bloquear domínios, limitar tempo diário de uso e filtrar conteúdo adulto/inseguro (
heurística + Google Safe Browsing opcional). Um agente de IA escreveu a maior parte do código então não espere nada
glamuroso 😉.

## Funcionalidades Principais

- **Bloqueio manual de sites**: Adicione padrões (ex: `facebook.com`). Sem limite = bloqueio imediato.
- **Limite diário por site**: Defina minutos de uso permitidos; ao exceder, o site é bloqueado até o próximo dia.
- **Filtro adulto / inseguro** (opcional):
    - Heurística local por palavras‑chave em host/path.
    - Consulta opcional à *Google Safe Browsing API* para detectar malware/phishing (requer chave de API própria).
- **Bloqueio automático**: Domínios detectados pelo filtro são adicionados à lista de auto bloqueio (removíveis nas
  opções).
- **Página de bloqueio personalizada**: Exibe motivo (manual, tempo, auto) e padrão bloqueado.
- **Persistência local**: Tudo armazenado em `chrome.storage.local`.
- **Rastreamento de tempo**: Eventos de navegação + "heartbeat" (content script) a cada 30s.
- **Interface dupla**: Popup para operações rápidas; página de opções para gestão avançada (inclui mesma lista manual +
  lista auto + API key + reset de uso).

## Instalação (Modo Desenvolvedor)

1. Clone ou baixe este repositório.
2. Acesse `chrome://extensions/`.
3. Ative "Modo do desenvolvedor".
4. Clique em "Carregar sem compactação" e selecione a pasta do projeto.

## Estrutura de Arquivos

```
background.js      // Service worker: regras, limites, filtro, uso
content.js         // Heartbeat de tempo de uso
popup.html/js      // UI rápida (adicionar / editar limites / remover)
options.html/js    // Configurações avançadas e mesma gestão de sites
blocked.html       // Página de redirecionamento quando bloqueado
manifest.json      // Configuração MV3
README.md          // Este arquivo
.gitignore         // Ignora artefatos não versionáveis
```

## Armazenamento (chrome.storage.local)

Chaves utilizadas:

- `blockedEntries`: `[ { id, pattern, dailyLimitMinutes|null } ]`
- `autoBlockedPatterns`: `[ string ]`
- `enableAdultFilter`: `boolean`
- `safeBrowsingApiKey`: `string|null`
- `usageToday`: `{ date: 'YYYY-MM-DD', usage: { [pattern]: ms } }`
- `runtimeState`: `{ activeTabId, activePattern, activeStart }` (auxiliar)

## Safe Browsing (Opcional)

1. Obtenha uma chave em: https://developers.google.com/safe-browsing
2. Ative o serviço na Google Cloud Console.
3. Insira a chave em Opções > Filtro Adulto/Inseguro.
4. A chave fica armazenada localmente (não enviada ao repositório se seguir o `.gitignore`).

> Nota: A API não classifica "conteúdo adulto" diretamente; ela retorna ameaças (malware / phishing / unwanted
> software). A heurística de termos cobre o aspecto adulto.

## Lógica de Bloqueio

Ordem prática:

1. Navegação inicia (`webNavigation.onBeforeNavigate`).
2. Se filtro adulto ativo, avalia heurística + (opcional) Safe Browsing.
3. Se detectar risco/adulto, domínio entra em `autoBlockedPatterns` e regra DNR é atualizada.
4. Regras DNR (manual sem limite, tempo excedido, auto) redirecionam para `blocked.html`.
5. Tempo é acumulado por eventos de foco/ativação + heartbeat periódico.

## Limitações / Considerações

- Heurística simples (palavras‑chave) pode gerar falso positivo ou não cobrir todos os casos.
- Safe Browsing não substitui controle de conteúdo adulto; apenas reforça segurança.
- Não há ofuscação: usuários avançados podem inspecionar o código e remover bloqueios.
- `chrome.storage.local` não sincroniza entre dispositivos.

## Possíveis Melhorias Futuras

- Sincronização opcional (usar `chrome.storage.sync` com quotas).
- Exportar / importar configurações e uso.
- Pausar bloqueios temporariamente (timer de suspensão).
- Lista de exceções (subpaths permitidos).
- Melhor heurística (listas externas atualizadas ou classificação local).

## Desenvolvimento

Não há dependências externas obrigatórias. Para empacotar:

1. Ajuste versão em `manifest.json`.
2. Use "Empacotar extensão" em `chrome://extensions/` (gera `.crx` + `.pem`).
3. Distribua somente os arquivos necessários (sem chave de API).

## Licença

MIT. Veja a aba MIT License.

---
Contribuições e sugestões são bem-vindas.

