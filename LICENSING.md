# Image MetaHub licensing

**Effective October 10, 2026:** The current Image MetaHub repository version offers the source code that is exclusively copyright-owned by the project maintainer under the **PolyForm Perimeter License 1.0.1** ([full text](LICENSE), [official license](https://polyformproject.org/licenses/perimeter/1.0.1)).

PolyForm Perimeter is a **source-available**, not an OSI-approved open-source, license. It permits use, modification, and redistribution within its terms but does **not** permit using the covered code to offer a competing product, even without charge.

This license change applies only to rights the maintainer can grant. It does not relicense third-party contributions or components, and does not revoke permissions granted under earlier licenses.

## Files remaining under MPL 2.0

The following files were changed in [AVIF pull request #480](https://github.com/LuqP2/Image-MetaHub/pull/480), contributed by [austintraver](https://github.com/austintraver). Pending separate permission or independent replacement of the contributed material, **these complete files remain licensed under the Mozilla Public License 2.0**. See [LICENSE-MPL-2.0](LICENSE-MPL-2.0) for its full text.

- `ARCHITECTURE.md`
- `CHANGELOG.md`
- `README.md`
- `__tests__/avifMetadata.test.ts`
- `__tests__/fixtures/avif/comfy-xmp.avif`
- `__tests__/fixtures/avif/comfy-xmp.xmp`
- `__tests__/imageMetaHubAvifExtension.test.ts`
- `__tests__/mediaTypes.test.ts`
- `__tests__/metadataEngine.avif.test.ts`
- `components/BatchExportModal.tsx`
- `components/ImageModal.tsx`
- `components/ImagePreviewSidebar.tsx`
- `electron.mjs`
- `hooks/useImageLoader.ts`
- `services/cacheManager.ts`
- `services/fileIndexer.ts`
- `services/metadataEngine.ts`
- `services/parsers/metadataParserFactory.ts`
- `services/thumbnailManager.ts`
- `utils/avifMetadata.mjs`
- `utils/avifMetadata.mjs.d.ts`
- `utils/imageMetaHubAvifExtension.mjs`
- `utils/imageMetaHubAvifExtension.mjs.d.ts`
- `utils/mediaTypes.js`

This list deliberately includes files modified by the contributor, not only the newly created AVIF modules. Existing MPL 2.0 rights to these files are preserved. No PolyForm-only restriction is asserted over the contributor's MPL-covered material.

## Separately licensed package

The `packages/metadata-engine/` package retains its existing **Apache License 2.0**, including [its package license](packages/metadata-engine/LICENSE) and package metadata. It is not relicensed by this notice.

Other third-party dependencies and materials retain their own applicable licenses and notices.

## Earlier versions

Earlier releases, commits, and source code that were distributed under **MPL 2.0** remain available under the terms originally granted. Those grants are not retroactively revoked. The same applies to earlier distributions of the separately licensed Apache 2.0 package.

## Separate permissions

The maintainer may separately grant commercial or other licenses for portions of the project whose copyright the maintainer controls. Such separate licenses do not change the license of third-party contributions.
