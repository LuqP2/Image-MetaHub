# Documentação Técnica - Image MetaHub

Este documento fornece uma análise técnica detalhada da arquitetura, fluxo de dados e componentes principais do aplicativo Image MetaHub. O objetivo é orientar a integração de novas funcionalidades, como um sistema de cache baseado em SQLite, por um assistente de IA.

## 1. ESTRUTURA DO PROJETO

O repositório segue uma estrutura de projeto "flat" para aplicações React, onde as pastas principais de código-fonte (`components`, `hooks`, `services`, `store`) estão localizadas na raiz, ao lado dos arquivos de configuração do Electron, Vite e TypeScript.

### Árvore de Diretórios Principal

```
/
├── components/         # Componentes React reutilizáveis da UI
├── hooks/              # Hooks React customizados para lógica de estado e efeitos
├── public/             # Arquivos estáticos servidos pelo Vite
├── services/           # Módulos para lógica de negócios (parsers, cache, etc.)
├── store/              # Stores globais do Zustand para gerenciamento de estado
├── utils/              # Funções utilitárias genéricas
├── App.tsx             # Componente raiz da aplicação React
├── main.tsx            # Ponto de entrada da aplicação React (renderiza o App)
├── electron.mjs        # Ponto de entrada e processo principal do Electron
├── preload.js          # Script de preload do Electron para a bridge entre main e renderer
├── types.ts            # Definições de tipos TypeScript globais
├── package.json        # Dependências e scripts do projeto
└── vite.config.ts      # Configuração do servidor de desenvolvimento e build Vite
```

### Propósito das Pastas

-   **`components/`**: Contém todos os componentes da interface do usuário (UI) da aplicação, construídos em React. Cada arquivo `.tsx` representa um componente, desde elementos simples como botões até views complexas como a grade de imagens (`ImageGrid.tsx`) e o modal de visualização (`ImageModal.tsx`).
-   **`hooks/`**: Abriga os hooks customizados do React. Eles encapsulam lógica complexa e reutilizável, como o carregamento de imagens (`useImageLoader.ts`), gerenciamento de atalhos de teclado (`useHotkeys.ts`) e seleção de imagens (`useImageSelection.ts`).
-   **`services/`**: Concentra a lógica de negócios desacoplada da UI. Inclui o gerenciamento de cache (`cacheManager.ts`), a indexação de arquivos (`fileIndexer.ts`), as operações de arquivo (`fileOperations.ts`) e os parsers de metadados para diferentes formatos de IA.
-   **`store/`**: Define os stores do Zustand, que são responsáveis pelo gerenciamento de estado global.
    -   `useImageStore.ts`: Gerencia o estado relacionado às imagens (lista de imagens, filtros, seleção).
    -   `useSettingsStore.ts`: Gerencia as configurações do usuário (tema, atalhos, caminho do cache).
-   **`utils/`**: Contém funções auxiliares puras e genéricas que podem ser utilizadas em qualquer parte da aplicação, como manipulação de strings ou cálculos.

### Convenções de Nomenclatura e Organização

-   **Componentes**: Usam `PascalCase` (ex: `ImageGrid.tsx`).
-   **Hooks**: Usam `camelCase` com o prefixo `use` (ex: `useImageLoader.ts`).
-   **Serviços e Stores**: Usam `camelCase` (ex: `cacheManager.ts`, `useImageStore.ts`).
-   **Tipos**: Interfaces e tipos customizados são definidos em `types.ts` e usam `PascalCase` (ex: `IndexedImage`, `BaseMetadata`).
-   **Organização**: A estrutura favorece a co-localização de arquivos por função (componentes, hooks, serviços) em vez de por feature. A comunicação entre as camadas é feita de forma clara: componentes usam hooks, que por sua vez podem chamar serviços e interagir com os stores.

## 2. ARQUITETURA E FLUXO DE DADOS

A aplicação utiliza uma arquitetura reativa moderna, com o Electron gerenciando o processo principal (backend) e o React/Vite controlando a interface do usuário (frontend). A comunicação entre eles é feita por meio de um script de `preload.js`, que expõe funcionalidades do Node.js de forma segura para o processo de renderização.

### Gerenciamento de Estado (Zustand)

O estado global da aplicação é gerenciado pelo **Zustand**, uma biblioteca de gerenciamento de estado minimalista. Existem dois stores principais:

1.  **`useImageStore.ts`**:
    -   **Responsabilidade**: Gerenciar todo o estado relacionado às imagens, incluindo a lista completa (`images`), a lista filtrada e visível (`filteredImages`), os diretórios carregados, o estado de carregamento/indexação (`isLoading`, `progress`), filtros de busca e seleção de imagens.
    -   **Fluxo**: Ações neste store são chamadas principalmente pelo `useImageLoader.ts` para adicionar imagens e atualizar o estado de progresso. Os componentes da UI (como `ImageGrid` e `SearchBar`) leem os dados deste store para renderizar a interface e chamam ações para atualizar filtros ou seleções.

2.  **`useSettingsStore.ts`**:
    -   **Responsabilidade**: Gerenciar as configurações persistentes do usuário, como o modo de visualização, tamanho das imagens, atalhos de teclado (`keymap`), tema e caminho do cache.
    -   **Persistência**: Utiliza o middleware `persist` do Zustand. De forma inteligente, ele detecta se está rodando no Electron ou no navegador:
        -   **Electron**: Usa um `StateStorage` customizado que se comunica com o processo principal via IPC (`window.electronAPI.getSettings`, `window.electronAPI.saveSettings`) para salvar as configurações em um arquivo `settings.json` no diretório de dados do usuário.
        -   **Navegador**: Usa o `localStorage` como fallback.

### Fluxo de Carregamento de Imagens

O fluxo de carregamento é o processo central da aplicação e é orquestrado pelo hook `useImageLoader.ts`.

1.  **Seleção de Pasta (`handleSelectFolder`)**:
    -   O usuário clica em um botão na UI, que chama esta função.
    -   No **Electron**, `window.electronAPI.showDirectoryDialog()` é invocado, abrindo um diálogo nativo para seleção de pastas.
    -   No **Navegador**, `window.showDirectoryPicker()` é usado.
    -   O diretório selecionado é adicionado ao `useImageStore`.

2.  **Início do Carregamento (`loadDirectory`)**:
    -   O estado da aplicação é atualizado para `isLoading: true`.
    -   O `cacheManager.validateCacheAndGetDiff` é chamado. Ele compara os arquivos no disco com os metadados no cache (IndexedDB) e retorna três listas: imagens não modificadas (carregadas do cache), arquivos novos/modificados (precisam ser processados) e arquivos deletados.
    -   Imagens do cache são imediatamente adicionadas ao `useImageStore` para uma exibição rápida.
    -   IDs de arquivos deletados são removidos do store.

3.  **Indexação de Arquivos (`processFiles`)**:
    -   Os arquivos novos e modificados são enviados para a função `processFiles` em `services/fileIndexer.ts`.
    -   **No Electron**, esta função delega o trabalho pesado para o processo principal via IPC para evitar o bloqueio da UI. O processo principal lê os arquivos, extrai os metadados, gera miniaturas e retorna os dados em lotes (`onIndexingBatchResult`).
    -   **No Navegador**, o processamento é feito em um Web Worker para não congelar a UI.
    -   O progresso é reportado via `setProgress` e as imagens processadas são adicionadas ao store em lotes.

4.  **Finalização e Cache (`finalizeDirectoryLoad`)**:
    -   Quando a indexação termina, o estado `isLoading` é definido como `false`.
    -   Os metadados das novas imagens são salvos no `cacheManager`.
    -   Uma mensagem de sucesso é exibida ao usuário.

### Sistema de Cache (Legado)

O sistema de cache atual (`services/cacheManager.ts`) utiliza **IndexedDB** para armazenar os metadados extraídos das imagens (`IndexedImage`).

-   **Inicialização**: O `cacheManager.init()` abre a conexão com o banco de dados IndexedDB.
-   **Chave de Cache**: Cada diretório possui um "cache ID" único, geralmente baseado no caminho do diretório e se a busca recursiva está ativa.
-   **Operações**:
    -   `getCachedData`: Lê todos os registros de metadados para um determinado cache ID.
    -   `cacheData`: Salva um array de objetos `IndexedImage` no cache.
    -   `validateCacheAndGetDiff`: É a função mais importante. Ela orquestra a "sincronização" entre o estado do disco e o cache, minimizando o reprocessamento de imagens que não foram alteradas.

### Integração Electron

A comunicação entre o processo de renderização (React) e o processo principal (Node.js) é a espinha dorsal da versão Electron.

-   **`electron.mjs` (Main Process)**:
    -   Cria a janela principal do navegador (`BrowserWindow`).
    -   Registra os handlers IPC (`ipcMain.handle`) que executam tarefas privilegiadas, como acesso ao sistema de arquivos (`listDirectoryFiles`, `readFile`), salvar/carregar configurações e mostrar diálogos nativos.
    -   Gerencia o ciclo de vida da aplicação e as atualizações automáticas.

-   **`preload.js`**:
    -   Atua como uma ponte segura entre os dois processos.
    -   Usa `contextBridge.exposeInMainWorld` para expor uma API global `window.electronAPI` para o renderer.
    -   Esta API contém funções que invocam os handlers IPC no processo principal (ex: `window.electronAPI.showDirectoryDialog()`) e registram listeners para eventos enviados do main para o renderer (ex: `window.electronAPI.onIndexingProgress(...)`).

## 3. ARQUIVOS-CHAVE E SUAS RESPONSABILIDADES

A seguir, uma análise detalhada dos arquivos mais importantes para entender o fluxo de dados e a lógica da aplicação.

---

### `App.tsx`

-   **Propósito**: É o componente React raiz que monta toda a interface do usuário. Ele atua como o principal "orquestrador" da aplicação no lado do frontend.
-   **Responsabilidades Principais**:
    -   **Estrutura da UI**: Renderiza os componentes principais como `Sidebar`, `Header`, `ImageGrid`/`ImageTable` e modais (`ImageModal`, `SettingsModal`).
    -   **Conexão com Stores**: Conecta-se aos stores Zustand (`useImageStore`, `useSettingsStore`) para obter o estado global (lista de imagens, configurações, etc.) e passá-lo como props para os componentes filhos.
    -   **Inicialização**: Dispara a lógica de inicialização, como carregar os diretórios previamente abertos (`handleLoadFromStorage`) e inicializar o `cacheManager`.
    -   **Gerenciamento de Efeitos Globais**: Usa `useEffect` para registrar listeners de eventos globais, como atalhos de teclado (via `useHotkeys`), eventos de menu do Electron e alterações de tema do sistema operacional.
-   **Dependências Chave**:
    -   `store/useImageStore`: Para obter e exibir dados de imagens e estado de carregamento.
    -   `store/useSettingsStore`: Para obter e aplicar as configurações do usuário (ex: tema, modo de visualização).
    -   `hooks/useImageLoader`: Para obter as funções que iniciam o carregamento de diretórios (`handleSelectFolder`).
    -   `hooks/useImageSelection`: Para lógica de seleção de imagens.
    -   `components/*`: Para construir a UI.

---

### `hooks/useImageLoader.ts`

-   **Propósito**: Encapsula toda a lógica complexa de seleção, carregamento, indexação e cache de diretórios de imagens.
-   **Exports Principais**:
    -   `useImageLoader()`: Um hook que retorna um objeto com funções para interagir com o sistema de carregamento.
        -   `handleSelectFolder`: Abre o diálogo de seleção de pasta e inicia o processo de carregamento.
        -   `handleLoadFromStorage`: Carrega os diretórios salvos no `localStorage` na inicialização (somente Electron).
        -   `loadDirectory`: A função principal que orquestra a validação de cache, processamento de novos arquivos e salvamento no cache.
-   **Fluxo de Trabalho Interno (`loadDirectory`)**:
    1.  Chama `cacheManager.validateCacheAndGetDiff` para comparar arquivos no disco com o cache.
    2.  Adiciona imediatamente as imagens válidas do cache ao `useImageStore`.
    3.  Remove imagens deletadas do `useImageStore`.
    4.  Envia os arquivos novos/modificados para `services/fileIndexer.ts` para processamento de metadados.
    5.  No Electron, a indexação é delegada ao processo principal para não bloquear a UI. O hook escuta por eventos de progresso e de lotes de resultados.
    6.  Ao final, chama `finalizeDirectoryLoad` para salvar os novos metadados no `cacheManager`.
-   **Dependências Chave**:
    -   `store/useImageStore`: Para atualizar o estado de carregamento, progresso e adicionar as imagens processadas.
    -   `services/fileIndexer`: Para iniciar o processo de extração de metadados.
    -   `services/cacheManager`: Para ler e escrever no cache.

---

### `store/useImageStore.ts`

-   **Propósito**: Store Zustand para gerenciar todo o estado volátil relacionado às imagens e à UI.
-   **Estado Gerenciado**:
    -   `images`: Array com todas as imagens carregadas de todos os diretórios.
    -   `filteredImages`: Array derivado de `images` após a aplicação de filtros e ordenação. É o que a UI renderiza.
    -   `directories`: Lista de diretórios que o usuário carregou.
    -   `isLoading`, `progress`, `indexingState`: Controlam a exibição de indicadores de carregamento e status da indexação.
    -   `searchQuery`, `selectedModels`, `advancedFilters`, etc.: Estado para todos os filtros aplicados.
    -   `selectedImage`, `selectedImages`: Gerenciam a seleção de uma ou múltiplas imagens.
-   **Ações Principais**:
    -   `addDirectory`, `removeDirectory`: Gerenciam a lista de pastas.
    -   `setImages`, `addImages`, `removeImage`: Modificam a lista de imagens.
    -   `filterAndSortImages`: Lógica central que recalcula `filteredImages` com base no estado atual dos filtros e ordenação. É chamada sempre que um filtro é alterado.
-   **Onde é usado**: É o store mais utilizado da aplicação. `App.tsx` e quase todos os componentes leem dados dele. `useImageLoader` escreve intensivamente neste store durante a indexação.

---

### `store/useSettingsStore.ts`

-   **Propósito**: Store Zustand para gerenciar as configurações persistentes do usuário.
-   **Estado Gerenciado**:
    -   `viewMode`: 'grid' ou 'list'.
    -   `imageSize`: O tamanho dos thumbnails na grade.
    -   `cachePath`: O caminho customizado para o banco de dados de cache (usado para inicializar o `cacheManager`).
    -   `theme`: 'light', 'dark' ou 'system'.
    -   `keymap`: Objeto que armazena os atalhos de teclado customizados.
-   **Persistência**:
    -   Utiliza o middleware `persist` do Zustand.
    -   No Electron, usa um adaptador customizado (`electronStorage`) que lê/escreve as configurações em um arquivo `settings.json` através do processo principal (IPC).
    -   No navegador, usa `localStorage`.
-   **Onde é usado**: Em `App.tsx` para aplicar o tema e o modo de visualização, e no `SettingsModal.tsx` para permitir que o usuário modifique as configurações.

---

### `services/cacheManager.ts`

-   **Propósito**: Fornece uma abstração para interagir com o banco de dados de cache, que é o IndexedDB.
-   **Exports Principais**:
    -   `cacheManager`: Uma instância singleton da classe `CacheManager`.
-   **Responsabilidades**:
    -   **Inicialização (`init`)**: Abre (ou cria) o banco de dados IndexedDB. Pode aceitar um caminho base para criar bancos de dados separados por projeto no futuro.
    -   **Leitura (`getCachedData`)**: Recupera metadados de imagens para um diretório específico.
    -   **Escrita (`cacheData`)**: Salva os metadados das imagens processadas. Internamente, ele divide os dados em "chunks" (pedaços) para não exceder os limites de transação do IndexedDB com grandes coleções.
    -   **Sincronização (`validateCacheAndGetDiff`)**: Compara uma lista de arquivos do sistema de arquivos com os dados cacheados. Retorna uma estrutura (`CacheDiff`) que informa ao `useImageLoader` quais arquivos precisam ser processados, quais foram deletados e quais podem ser usados diretamente do cache.
-   **Dependências**: Nenhuma dependência externa de biblioteca, usa apenas APIs do navegador (IndexedDB).
-   **Onde é usado**: Exclusivamente pelo `useImageLoader.ts` para orquestrar o fluxo de carregamento e cache.

---

### `components/SettingsModal.tsx` (Arquivo não lido, inferido)

-   **Propósito**: Componente de UI que renderiza o modal de configurações.
-   **Responsabilidades**:
    -   Fornecer controles (inputs, toggles, seletores) para o usuário modificar as configurações.
    -   Ler o estado atual do `useSettingsStore` para preencher os valores dos controles.
    -   Chamar as ações do `useSettingsStore` (ex: `setTheme`, `setImageSize`) quando o usuário interage com os controles para atualizar o estado global e persistir as mudanças.

## 4. PONTOS DE INTEGRAÇÃO PARA O NOVO CACHE

Para substituir o `cacheManager` (IndexedDB) pelo novo `sqliteCacheManager`, as seguintes áreas do código precisarão de modificações. A estratégia é substituir as chamadas ao `cacheManager` existente pelas novas funções do `sqliteCacheManager`.

1.  **Inicialização do Cache**:
    -   **Arquivo**: `App.tsx`
    -   **Local**: Dentro do `useEffect` que chama `initializeCache`.
    -   **Mudança Necessária**: Substituir a chamada `cacheManager.init(path || undefined)` pela chamada de inicialização do novo cache manager. O novo manager provavelmente precisará ser inicializado no processo principal do Electron e a UI apenas confirmará que ele está pronto.
    -   **Código de Exemplo (Atual)**:
        ```typescript
        useEffect(() => {
          const initializeCache = async () => {
            // ...
            await cacheManager.init(path || undefined);
            // ...
          };
          initializeCache().catch(console.error);
        }, []);
        ```

2.  **Carregamento e Validação do Cache do Diretório**:
    -   **Arquivo**: `hooks/useImageLoader.ts`
    -   **Local**: Dentro da função `loadDirectory`.
    -   **Mudança Necessária**: A lógica central de `validateCacheAndGetDiff` precisará ser substituída. Em vez de chamar `cacheManager.validateCacheAndGetDiff`, o `useImageLoader` deverá chamar uma nova função no `sqliteCacheManager` que execute a mesma lógica de comparação (arquivos no disco vs. registros no banco de dados SQLite) e retorne uma estrutura de dados similar (`CacheDiff`).
    -   **Código de Exemplo (Atual)**:
        ```typescript
        const loadDirectory = useCallback(async (directory: Directory, isUpdate: boolean) => {
          // ...
          const diff = await cacheManager.validateCacheAndGetDiff(directory.path, directory.name, allCurrentFiles, shouldScanSubfolders);
          // ...
        }, []);
        ```

3.  **Salvamento de Novos Metadados no Cache**:
    -   **Arquivo**: `hooks/useImageLoader.ts`
    -   **Local**: Dentro da função `finalizeDirectoryLoad`.
    -   **Mudança Necessária**: A chamada `cacheManager.cacheData(...)` deve ser substituída pela função equivalente no `sqliteCacheManager` para salvar os metadados das imagens recém-processadas.
    -   **Código de Exemplo (Atual)**:
        ```typescript
        const finalizeDirectoryLoad = useCallback(async (directory: Directory) => {
          // ...
          await cacheManager.cacheData(directory.path, directory.name, finalDirectoryImages, shouldScanSubfolders);
          // ...
        }, []);
        ```

4.  **Remoção de Imagens do Cache**:
    -   **Arquivo**: `hooks/useImageSelection.ts` (ou a lógica movida para o `useImageStore`)
    -   **Local**: Na função que lida com a exclusão de imagens (`handleDeleteSelectedImages`). A lógica de cache para remoção de imagens está atualmente em `services/cacheManager.ts` (`removeImages`).
    -   **Mudança Necessária**: Quando uma imagem é deletada pelo usuário, uma chamada deve ser feita ao `sqliteCacheManager` para remover o registro correspondente do banco de dados.
    -   **Código de Exemplo (Local Lógico)**:
        ```typescript
        // Em algum lugar na lógica de handleDeleteSelectedImages
        const handleDeleteSelectedImages = async () => {
          // ... (lógica de remoção de arquivo)
          await sqliteCacheManager.removeImages(selectedImageIds); // Nova chamada
          // ... (lógica de atualização do store)
        }
        ```

5.  **Configuração do Caminho do Cache (Opcional, mas recomendado)**:
    -   **Arquivo**: `store/useSettingsStore.ts`
    -   **Local**: Na definição do estado `cachePath`.
    -   **Mudança Necessária**: Atualmente, o `cachePath` é usado para dar um nome único ao banco IndexedDB. Com o SQLite, o caminho será um caminho real do sistema de arquivos. O `SettingsModal` precisará provavelmente usar um diálogo do Electron para selecionar uma pasta para o arquivo do banco de dados, e esse caminho será salvo aqui. O processo principal do Electron lerá essa configuração para saber onde abrir o arquivo do banco de dados SQLite.

## 5. DEPENDÊNCIAS CRÍTICAS

A aplicação é construída sobre um ecossistema moderno de JavaScript, combinando um framework de UI, gerenciamento de estado, e ferramentas de build e desktop.

### Bibliotecas Principais

-   **`electron`**: Framework principal para construir a aplicação desktop multiplataforma. Ele provê o runtime que combina o Node.js (para o backend/processo principal) e o Chromium (para o frontend/processo de renderização).
-   **`react`**: Biblioteca para construir a interface do usuário. Todos os componentes da UI são escritos em React.
-   **`vite`**: Ferramenta de build e servidor de desenvolvimento. É responsável por compilar o código TypeScript/React e servir a aplicação em um ambiente de desenvolvimento rápido (com Hot Module Replacement).
-   **`zustand`**: Biblioteca de gerenciamento de estado. É usada para criar os stores (`useImageStore`, `useSettingsStore`) que mantêm o estado global da aplicação de forma centralizada e reativa.
-   **`electron-builder`**: Ferramenta para empacotar e construir a aplicação Electron para distribuição (gerando instaladores para Windows, macOS e Linux).
-   **`exifr`**: Biblioteca para extrair metadados (EXIF, IPTC, XMP) de arquivos de imagem. É a base para os parsers de metadados.
-   **`tailwindcss`**: Framework de CSS utility-first usado para estilizar todos os componentes da aplicação.

### Tipos TypeScript Customizados (`types.ts`)

O arquivo `types.ts` é a fonte da verdade para as estruturas de dados usadas em toda a aplicação.

-   **`IndexedImage`**: A interface mais importante. Representa um único arquivo de imagem após ter sido processado. Contém:
    -   `id`: Um identificador único (geralmente o caminho relativo).
    -   `name`: O nome do arquivo.
    -   `handle`: O `FileSystemFileHandle` para acesso direto ao arquivo (principalmente no navegador).
    -   `metadata`: O objeto de metadados brutos extraídos da imagem.
    -   `metadataString`: Uma versão em string dos metadados, otimizada para busca textual.
    -   `lastModified`: Timestamp da última modificação do arquivo, usado para validação de cache.
    -   Campos normalizados como `models`, `loras`, `scheduler` para acesso rápido nos filtros.
    -   `directoryId`: Referência ao diretório pai.

-   **`Directory`**: Representa uma pasta que o usuário adicionou à aplicação. Contém o `id`, `name`, `path` e o `handle` do diretório.

-   **`BaseMetadata`**: Uma interface normalizada para os metadados extraídos de diferentes geradores de imagem (InvokeAI, A1111, ComfyUI, etc.). Os parsers específicos de cada gerador são responsáveis por mapear os metadados brutos para esta estrutura unificada, garantindo que a UI possa exibir as informações de forma consistente.

-   **`ElectronAPI`**: Define a "forma" do objeto `window.electronAPI` que é exposto pelo `preload.js`. Isso fornece segurança de tipos para todas as chamadas IPC (comunicação entre renderer e main process), permitindo que o TypeScript e o IntelliSense funcionem corretamente.
