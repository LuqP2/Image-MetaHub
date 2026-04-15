# Release Automation Guide

Este guia explica como usar os scripts de automação para lançar novas versões do Image MetaHub.

## Scripts Disponíveis

### 1. `npm run update-version <version>`
**Atualiza a versão em TODOS os arquivos do projeto**

```bash
npm run update-version 0.11.2
```

Este script atualiza automaticamente:
- ✅ `package.json` - campo version
- ✅ `ARCHITECTURE.md` - seção Current Version
- ✅ `components/Header.tsx` - título do cabeçalho
- ✅ `components/FolderSelector.tsx` - tela de boas-vindas (3 ocorrências)
- ✅ `index.html` - título da página
- ✅ `electron.mjs` - título da janela e mock update (2 ocorrências)
- ✅ `cli.ts` - versão da CLI
- ✅ `components/ChangelogModal.tsx` - referência de versão
- ✅ `public/CHANGELOG.md` - sincroniza com CHANGELOG.md

**Total: 10 arquivos atualizados automaticamente!**

### 2. `npm run auto-release <version>`
**Workflow completamente automatizado - RECOMENDADO**

```bash
npm run auto-release 0.11.2
```

Executa o pipeline completo:
1. 🧪 Roda `npm run build` (testes + compilação)
2. 📝 Atualiza versão em todos os arquivos (via `update-version.js`)
3. 📋 Gera release notes (via `generate-release.js`)
4. 💾 Cria commit com todas as mudanças
5. 🏷️ Cria tag `v0.11.2`
6. 🚀 Faz push do branch e tag para o GitHub
7. ⏳ Aguarda GitHub Actions iniciar

**GitHub Actions automaticamente:**
- Builda instaladores para Windows, macOS e Linux
- Cria release draft no GitHub
- Faz upload de todos os binários
- Publica a release

### 3. `npm run release-workflow <version>`
**Automatizado, sem build (mais rápido)**

```bash
npm run release-workflow 0.11.2
```

Similar ao `auto-release`, mas **pula o build**. Use quando você já testou tudo e quer economizar tempo.

Executa:
1. 📝 Atualiza versão em todos os arquivos
2. 📋 Gera release notes
3. 💾 Commit + tag + push
4. 🌐 Abre página de releases do GitHub para revisão manual

## Workflow Recomendado

### Para releases de produção (estável):

```bash
# 1. Certifique-se de que CHANGELOG.md está atualizado
# 2. Execute o release automatizado
npm run auto-release 0.11.2

# 3. Aguarde ~10-15 minutos para o GitHub Actions completar
# 4. Verifique a release em: https://github.com/LuqP2/image-metahub/releases
```

### Para releases de teste (RC/beta):

```bash
# Use sufixo -rc ou -beta
npm run auto-release 0.11.2-rc
```

### Para apenas atualizar versão (sem release):

```bash
# Apenas atualiza os arquivos, sem commit/tag
npm run update-version 0.11.2

# Depois você pode revisar e commitar manualmente
git diff
git add .
git commit -m "chore: bump version to v0.11.2"
```

## Formato de Versão

Usa Semantic Versioning (SemVer):
- **MAJOR.MINOR.PATCH** (ex: `1.0.0`)
- **MAJOR.MINOR.PATCH-PRERELEASE** (ex: `0.11.2-rc`, `1.0.0-beta.1`)

Exemplos válidos:
- ✅ `0.11.2`
- ✅ `1.0.0`
- ✅ `0.11.2-rc`
- ✅ `1.0.0-beta.1`
- ❌ `v0.11.2` (não inclua o "v")
- ❌ `0.11` (falta o PATCH)

## Checklist Pré-Release

Antes de rodar `npm run auto-release`:

- [ ] Atualizei o `CHANGELOG.md` com as mudanças da versão?
- [ ] Testei a build localmente (`npm run build`)?
- [ ] Testei o app em modo dev (`npm run dev:app`)?
- [ ] Revisei todas as mudanças no código?
- [ ] Os testes estão passando (`npm test`)?

## Troubleshooting

### "Build failed! Aborting release."
- Execute `npm run build` manualmente para ver o erro detalhado
- Corrija os erros de build antes de tentar novamente

### "git tag already exists"
- Você já criou uma tag para esta versão
- Delete a tag: `git tag -d v0.11.2`
- E no GitHub: `git push origin :refs/tags/v0.11.2`
- Depois tente novamente

### "Version already exists in CHANGELOG.md"
- O script `generate-release.js` não encontrou a seção da versão no CHANGELOG
- Certifique-se que o CHANGELOG tem uma seção: `## [0.11.2] - YYYY-MM-DD`

### GitHub Actions não iniciou
- Verifique em: https://github.com/LuqP2/image-metahub/actions
- Pode levar alguns segundos/minutos para iniciar
- Certifique-se que o push da tag foi bem-sucedido

## Arquivos de Configuração

- **`update-version.js`** - Script que atualiza versão em todos os arquivos
- **`auto-release.js`** - Pipeline completo automatizado
- **`release-workflow.js`** - Workflow semi-automatizado (sem build)
- **`generate-release.js`** - Gera release notes a partir do CHANGELOG
- **`.github/workflows/publish.yml`** - GitHub Actions para builds

## Logs e Debug

Para ver exatamente o que cada script faz, os logs mostram:
- ✅ Arquivos atualizados com sucesso
- ⚠️ Avisos de arquivos que não mudaram
- ❌ Erros com detalhes
- 📊 Resumo final com contagem de arquivos atualizados

## Exemplo Completo

```bash
# 1. Criar branch de release (opcional)
git checkout -b release/v0.11.2

# 2. Atualizar CHANGELOG.md
# Adicionar seção:
# ## [0.11.2] - 2025-01-09
# ### Fixed
# - Bug X corrigido
# - Bug Y corrigido

# 3. Rodar release automatizado
npm run auto-release 0.11.2

# 4. Aguardar GitHub Actions (~10-15 min)
# 5. Verificar release publicada
# 6. Testar instaladores baixando da release

# Pronto! 🎉
```

## Notas Importantes

- ⚠️ **Sempre teste localmente antes de fazer release!**
- 📝 **Mantenha o CHANGELOG.md atualizado** - é a fonte das release notes
- 🔒 **Nunca force push tags** - podem quebrar o auto-updater
- 🎯 **Use versões consistentes** - não pule números de versão
- 📦 **Verifique os binários** - baixe e teste os instaladores da release

## Suporte

- Issues: https://github.com/LuqP2/image-metahub/issues
- Documentação: README.md, ARCHITECTURE.md, AGENTS.md
