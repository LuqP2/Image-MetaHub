# Image MetaHub translations

Use a stable module-prefixed key in `en.json` and add reviewed Spanish and Brazilian Portuguese translations to `es.json` and `pt-BR.json`. Use whole ICU messages for labels with variables or plural forms. Pass filenames, prompts, node names, and other user or application data as arguments.

For an initial module migration, add its source paths to `coverage.json` and include all three catalogs in the PR. For each reviewed translation, update its locale and key in `reviewed.json` with the SHA-256 of the exact English message. Run `node scripts/check-i18n.mjs origin/main` to check a branch before pushing.

The **Translation drafts** workflow runs after changes to the English catalog reach `main`. Maintainers configure Actions variables `TRANSLATION_API_URL` and `TRANSLATION_MODEL` and the secret `TRANSLATION_API_KEY`. The URL points to a chat-completions-compatible POST endpoint. The job can also be rerun from `main` after setting credentials or fixing a service failure.

Download the workflow artifact to review drafts. Apply reviewed text to the appropriate catalog and use the draft hash in `reviewed.json` after confirming it still matches the current English message. Submit the catalog changes for review in a PR. The app uses the current English message when the translation or its approval is missing, the approval hash belongs to an earlier English revision, or the ICU arguments are incompatible.
