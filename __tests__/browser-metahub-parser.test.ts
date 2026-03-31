import { describe, expect, it } from 'vitest';
import { parseBrowserMetaHubMetadata } from '../services/parsers/browserMetaHubParser';
import { parseImageMetadata } from '../services/parsers/metadataParserFactory';

const browserPayload = {
  schema: 'imagemetahub.browser/1.0',
  metadata: {
    prompt: 'cinematic portrait of a fox astronaut',
    model: 'GPT-4o',
    provider: 'ChatGPT',
    width: 1024,
    height: 1536,
    captured_at: '2026-03-31T11:34:13.000Z',
    source_url: 'https://chatgpt.com/c/test-conversation',
    image_url: 'https://cdn.example.com/generated.png',
  },
  source: {
    provider: 'ChatGPT',
    url: 'https://chatgpt.com/c/test-conversation',
    hostname: 'chatgpt.com',
    title: 'ChatGPT',
    conversation_id: 'test-conversation',
  },
  image: {
    url: 'https://cdn.example.com/generated.png',
    width: 1024,
    height: 1536,
  },
  prompt: {
    text: 'cinematic portrait of a fox astronaut',
    strategy: 'chatgpt.previous_user_message',
  },
};

describe('Browser MetaHub parser', () => {
  it('parses browser schema payloads directly', () => {
    const result = parseBrowserMetaHubMetadata(browserPayload);

    expect(result).not.toBeNull();
    expect(result?.prompt).toBe('cinematic portrait of a fox astronaut');
    expect(result?.model).toBe('GPT-4o');
    expect(result?.generator).toBe('ChatGPT');
    expect(result?.width).toBe(1024);
    expect(result?.height).toBe(1536);
  });

  it('keeps browser payloads out of the ComfyUI parser path when wrapped in imagemetahub_data', async () => {
    const result = await parseImageMetadata({
      imagemetahub_data: browserPayload,
    } as any);

    expect(result).not.toBeNull();
    expect(result?.generator).toBe('ChatGPT');
    expect(result?.prompt).toBe('cinematic portrait of a fox astronaut');
    expect(result?.steps).toBe(0);
    expect(result?.model).toBe('GPT-4o');
  });
});
