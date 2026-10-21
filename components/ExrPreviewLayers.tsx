import React, { useId, useState } from 'react';

type Region = { x: number; y: number; width: number; height: number };

// Both images composite directly against the checkerboard: the loaded detail
// cuts a hole in the overview instead of applying source alpha a second time.
type PreviewLayersProps = {
  overviewUrl: string; detailUrl?: string; region?: Region | null;
  width: number; height: number; name: string;
};
export function ExrPreviewLayers(props: PreviewLayersProps) {
  // A URL loaded by a previous element does not establish readiness for a
  // newly mounted detail image, even when the native cache returns that URL.
  return <ExrPreviewComposition key={JSON.stringify([props.overviewUrl, props.detailUrl, props.region])} {...props} />;
}
function ExrPreviewComposition({ overviewUrl, detailUrl, region, width, height, name }: PreviewLayersProps) {
  const clipId = `exr-overview-${useId().replace(/:/g, '')}`;
  const [loadedDetail, setLoadedDetail] = useState('');
  const ready = Boolean(detailUrl && region && loadedDetail === detailUrl);
  const hole = ready && region ? `M${region.x} ${region.y}h${region.width}v${region.height}h${-region.width}Z` : '';
  return <svg role="img" aria-label={name} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    <defs><clipPath id={clipId}><path clipRule="evenodd" d={`M0 0H${width}V${height}H0Z ${hole}`} /></clipPath></defs>
    <image href={overviewUrl} width={width} height={height} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
    {detailUrl && region && <image href={detailUrl} x={region.x} y={region.y} width={region.width} height={region.height} preserveAspectRatio="none" visibility={ready ? 'visible' : 'hidden'} onLoad={() => setLoadedDetail(detailUrl)} />}
  </svg>;
}
