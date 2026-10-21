# EXR / OpenColorIO

Desktop EXR support is an optional component, available to Free and Pro users.
Open **Settings → General → Optional components → EXR / OpenColorIO → Install EXR support** to download the
verified component for your platform. No system Python, OCIO, or OpenImageIO
installation is required. Subsequent processing is local and works offline.

Until the component is installed and enabled, EXRs can be cataloged and organized
but have no decoded preview. The app never downloads the runtime automatically.
Settings offers Enable/Disable and Remove component. Removing the component
preserves originals, annotations, and color profiles. A library cache reset
also preserves the installed component and its profiles.

## Color and channel inspection

Choose a global OCIO configuration and input/display/view defaults, or override
them for an indexed folder under the component's expandable **Color settings**.
Nested folders inherit the closest configured parent.
Built-in ACES 1.3 and ACES 2.0 configurations are versioned. Custom `config.ocio`
files use their local LUT dependencies; missing or invalid dependencies report
an error. Changes to these files invalidate affected previews.

Automatic input selection uses recognized EXR declarations, explicit OCIO file
rules, and recognized chromaticities. When the input is unknown, the viewer uses
Linear sRGB and labels it as assumed. Override it when your renders use another
space. EXR does not imply ACEScg.

The viewer offers parts, grouped render passes, individual channels, input space,
display/view, and non-destructive exposure in stops. Changes made in the viewer
are temporary. Thumbnails use the saved folder/global profile and zero exposure.
Output is an SDR sRGB preview, not physical HDR monitor output. A display whose
encoding cannot be presented correctly as sRGB is rejected explicitly.

Color passes receive OCIO processing. Scalar channels use a grayscale range;
normals map −1…1 to 0…1; integer IDs use stable pseudocolors without float32
rounding; alpha uses 0…1. These diagnostic views bypass OCIO and exposure.
Nonfinite values appear magenta. Change the interpretation manually when a
channel's name does not reveal its meaning. Cryptomatte channels can be inspected
as data but are not decoded into object selections.

Zoom requests visible regions rather than decoding every full-resolution pass
into the renderer. Source data/display windows and pixel aspect ratio are honored.
The same preview service serves the library, sidebar, inline/detached viewer and
comparison. Originals are never used as browser image sources.

## Limits

This version does not support deep EXR, compositing, image editing, metadata
rewriting into EXR, EXR conversion/export, sequence playback, or EXR CLIP indexing.
Original-file copy/move and normal library annotations remain available.
Large or damaged files may fail with a recoverable error rather than exceeding
the preview memory budget. A changed render file can be retried.

## Native build and release

`native/exr` builds a standalone helper against a fixed vcpkg baseline.
The `EXR runtime` workflow builds Windows x64, Linux x64, macOS x64 and macOS arm64,
runs native self-tests and numerical integration tests using synthetic fixtures,
and packages the helper and dependency notices. Python is used by CI tests only.

Each runtime asset is independently gzip-compressed and has pinned compressed
and installed sizes and SHA-256 digests. The main process owns the trust policy.
No shell, arbitrary executable URL, or archive extraction is exposed to a
renderer. Installation verifies all assets and a native self-test before activation.

Use a manual workflow dispatch with `platform=all`, `publish=false` to prepare
the four packages and `exrRuntimePolicy.generated.mjs`. Review the generated
policy, measurements, and artifacts, then copy the policy to `electron/`.
Publish the verified assets under `exr-runtime-v1.0.0` with `--latest=false`;
do not publish the optional component as the main app's latest release.
The installed app needs the matching policy before its Install button is available.

`scripts/smokeExrInstall.mjs <verified-assets> <synthetic.exr>` validates real
installation, native inspection/preview, disable/re-enable, offline reuse,
removal and original preservation in an isolated temporary profile. It does not
access the real app profile or provide visual acceptance.
Add `--public` to test the published URLs. Network access is blocked after the
installation within this test to verify offline processing.

Runtime 1.0.0 download / installed sizes are: Windows x64 4.89 / 11.93 MiB,
Linux x64 10.55 / 29.76 MiB, macOS x64 6.71 / 20.55 MiB, and macOS arm64
6.33 / 18.97 MiB. Native binaries are excluded from the main app installer.
The exact installer size increase from the integration code has not been measured.

Manual packaged acceptance remains required for layout, controls, appearance
against a reference viewer with the same OCIO config, window behavior, and
installation through Settings on each supported platform.
