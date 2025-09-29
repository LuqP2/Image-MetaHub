# Image Utilities

Este arquivo contém funções utilitárias para operações com imagens no Image MetaHub.

## Funções Disponíveis

### `copyImageToClipboard(image: IndexedImage): Promise<OperationResult>`

Copia uma imagem para a área de transferência usando a Clipboard API.

**Parâmetros:**
- `image`: Objeto `IndexedImage` contendo o handle do arquivo

**Retorno:**
- `Promise<OperationResult>`: Resultado da operação com `success` e `error` (se houver)

**Exemplo:**
```typescript
import { copyImageToClipboard } from '../utils/imageUtils';

const result = await copyImageToClipboard(image);
if (result.success) {
  console.log('Imagem copiada com sucesso!');
} else {
  console.error('Erro ao copiar imagem:', result.error);
}
```

### `showInExplorer(image: IndexedImage): Promise<OperationResult>`

Mostra o arquivo de imagem no explorador de arquivos do sistema.

**Parâmetros:**
- `image`: Objeto `IndexedImage` contendo o caminho do arquivo

**Retorno:**
- `Promise<OperationResult>`: Resultado da operação

**Comportamento:**
- **Electron**: Usa `shell.showItemInFolder()` para abrir o explorador
- **Web**: Mostra um alert com o caminho do arquivo

### `copyFilePathToClipboard(image: IndexedImage): Promise<OperationResult>`

Copia o caminho completo do arquivo para a área de transferência.

**Parâmetros:**
- `image`: Objeto `IndexedImage` contendo o caminho do arquivo

**Retorno:**
- `Promise<OperationResult>`: Resultado da operação

## Interface `OperationResult`

```typescript
interface OperationResult {
  success: boolean;
  error?: string;
}
```

## Tratamento de Erros

Todas as funções incluem tratamento de erros adequado:
- Log de erros no console
- Retorno consistente com `success: false` e mensagem de erro
- Tratamento específico para ambientes Electron vs Web

## Dependências

- `IndexedImage` type do `../types`
- `navigator.clipboard` API (Clipboard API)
- `window.electronAPI` (opcional, para Electron)