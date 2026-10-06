# Model manager packaged smoke test

Manual acceptance only. Do not run against personal libraries without explicit selection/authorization. No model download or replacement is part of this feature.

## Synthetic local flow

1. Run `node scripts/createModelManagerSmokeFixtures.mjs`. It creates two identical synthetic safetensors headers and a tiny PNG in `.tmp/model-manager-smoke`, without reading other files or overwriting existing fixtures.
2. Open a packaged build. In Models, use **Add folder** to select the generated `models` directory. Leave Civitai identification and notifications off. Confirm both cards appear and the base-model/trigger filters work before clicking each card. No Civitai request should occur.
3. Add the generated `images` directory to the image library. On a model, use **Choose cover from library**. Confirm the model association filter starts enabled and can be disabled to browse all indexed images. Select the synthetic PNG as a cover and add it as a library example. Check preview origin, captions, unlinking, restoring the default cover and opening a linked library image in the existing viewer.
4. Double-click the card image/title to open Inspector. Edit notes there and favorite the model in Models; confirm the star fills. Confirm both windows reflect each edit. Exercise previous/next, Follow selection and Always on Top.
5. Compute SHA-256 in Inspector. The identical model files should collapse to one item exposing two locations. Notes, chosen cover and examples must survive promotion to hash identity.
6. Restart the packaged app and confirm saved preferences. In a disposable test profile only, clear the app caches and restart. The source, version bindings, notes, cover, linked examples and monitoring preferences should be restored from `model-manager-user-data/preferences.json`. Indexed-library links may show unavailable until the image library is loaded again.
7. Check the light theme and a narrow window manually. Both side panels should be collapsible. Check empty results, unavailable examples and header errors without blocking catalog navigation.

## Public Civitai flow

1. Without downloading a model, manually link a synthetic file to `https://civitai.com/models/1102?modelVersionId=1087`. This is a deliberately manual test association, not hash verification. A model-only link and a link whose version belongs to another model must be rejected.
2. Check updates individually and in a filtered batch. Confirm individual messages name the checked file, batch results open Updates when new versions exist, cards show compact novelty counts, and details show remote publication dates, family labels, descriptions and direct links. Public releases may change; assertions about novelty must follow dates returned by the service.
3. Mark a publication seen; ignore and restore another. Restart and recheck: those decisions must persist. Enable monitoring for a folder or individual item; leave Models and return after a due check. Confirm a single in-app notice, no system notification and no repeated notification for versions already surfaced by a manual check.
4. Use **Load Civitai cover** on demand and confirm it persists after restart without refetching. A chosen library cover must retain priority. Load Civitai examples explicitly in Inspector. Confirm images belong to the linked version, captions persist and **Show more** exposes remaining examples after the first 12. Merely checking updates must not fetch the gallery.
5. Stop a remote job. Simulate offline access and confirm the previous successful result remains visible with its date and the failure message. Do not label a failed consultation as updated.

## Automated checks

`node node_modules/vitest/vitest.mjs run __tests__/modelManager.tracking.test.ts __tests__/modelManager.service.test.ts __tests__/modelManager.cacheReset.test.ts __tests__/modelInspector.test.ts __tests__/modelLibrary.catalog.test.ts __tests__/smartCollections.storage.test.ts`

The tests use synthetic records and mocked network responses. They do not prove packaged cover loading and persistence, visual layout, or real Civitai availability.
