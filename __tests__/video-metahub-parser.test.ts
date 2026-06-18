import { describe, expect, it } from 'vitest';
import { parseImageMetadata } from '../services/parsers/metadataParserFactory';
import { parseVideoMetaHubMetadata } from '../services/parsers/videoMetaHubParser';

describe('Video MetaHub parser', () => {
  it('accepts structurally valid partial video payloads without prompt/model', () => {
    const result = parseVideoMetaHubMetadata({
      generator: 'ComfyUI',
      media_type: 'video',
      width: 640,
      height: 480,
      video: {
        width: 640,
        height: 480,
        frame_rate: 24,
        frame_count: 48,
      },
      metadata_status: 'partial',
      metadata_sources: {
        prompt: 'default',
      },
      imh_attribution: {
        schema_version: 1,
        token: 'imhcrt_br_creator_video_v1_random',
        source: 'metahub_save_node',
        node_version: '1.0.9',
      },
    });

    expect(result).toMatchObject({
      prompt: '',
      model: '',
      width: 640,
      height: 480,
      media_type: 'video',
      _metadata_status: 'partial',
      imh_attribution: {
        token: 'imhcrt_br_creator_video_v1_random',
      },
    });
  });

  it('rejects arbitrary JSON comments instead of treating them as video metadata', () => {
    const result = parseVideoMetaHubMetadata({
      comment: JSON.stringify({
        prompt: {
          '1': {
            class_type: 'KSampler',
            inputs: {},
          },
        },
      }),
    });

    expect(result).toBeNull();
  });

  it('does not normalize invalid videometahub_data into blank video metadata', async () => {
    const result = await parseImageMetadata({
      videometahub_data: {
        prompt: {
          '1': {
            class_type: 'KSampler',
            inputs: {},
          },
        },
      },
    } as any);

    expect(result).toBeNull();
  });
});
