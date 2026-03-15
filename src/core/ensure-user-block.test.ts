/**
 * Tests for the ensureUserMemoryBlock integration in LettaBot.
 *
 * These tests verify:
 * 1. Per-user memory blocks are created for new users on first message
 * 2. Known users skip the API check (in-memory cache)
 * 3. Existing blocks on the agent are detected and cached
 * 4. Missing agentId skips block creation gracefully
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use vi.hoisted to create mock functions that can be referenced in vi.mock factories
const {
  mockAgentHasBlock,
  mockCreateAndAttachBlock,
  mockLoadUserBlockTemplate,
  mockBuildUserBlockLabel,
} = vi.hoisted(() => ({
  mockAgentHasBlock: vi.fn(),
  mockCreateAndAttachBlock: vi.fn(),
  mockLoadUserBlockTemplate: vi.fn(),
  mockBuildUserBlockLabel: vi.fn(),
}));

vi.mock('../tools/letta-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools/letta-api.js')>();
  return {
    ...actual,
    agentHasBlock: mockAgentHasBlock,
    createAndAttachBlock: mockCreateAndAttachBlock,
  };
});

vi.mock('./memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./memory.js')>();
  return {
    ...actual,
    loadUserBlockTemplate: mockLoadUserBlockTemplate,
    buildUserBlockLabel: mockBuildUserBlockLabel,
  };
});

import { LettaBot } from './bot.js';

describe('ensureUserMemoryBlock', () => {
  let dataDir: string;
  let workingDir: string;
  const originalDataDir = process.env.DATA_DIR;
  const originalBaseUrl = process.env.LETTA_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    dataDir = mkdtempSync(join(tmpdir(), 'lettabot-data-'));
    workingDir = mkdtempSync(join(tmpdir(), 'lettabot-work-'));
    process.env.DATA_DIR = dataDir;
    delete process.env.LETTA_BASE_URL;

    // Default mock returns
    mockBuildUserBlockLabel.mockImplementation((channel: string, userId: string) => `human/${channel}_${userId}`);
    mockLoadUserBlockTemplate.mockReturnValue({
      value: 'Template value for test',
      description: 'User memory block',
      limit: 5000,
    });
    mockAgentHasBlock.mockResolvedValue(false);
    mockCreateAndAttachBlock.mockResolvedValue('block-new-123');
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.LETTA_BASE_URL;
    } else {
      process.env.LETTA_BASE_URL = originalBaseUrl;
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workingDir, { recursive: true, force: true });
  });

  function createBot(agentId: string | null = 'agent-test-1'): LettaBot {
    if (agentId) {
      writeFileSync(
        join(dataDir, 'lettabot-agent.json'),
        JSON.stringify({
          version: 2,
          agents: {
            LettaBot: {
              agentId,
              conversationId: null,
              conversations: {},
            },
          },
        }),
      );
    }
    return new LettaBot({
      agentName: 'LettaBot',
      workingDir,
      conversationMode: 'shared',
    } as any);
  }

  it('creates a new block for a user not seen before', async () => {
    const bot = createBot('agent-test-1');

    // Access private method for testing
    const ensureBlock = (bot as any).ensureUserMemoryBlock.bind(bot);
    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'hi' });

    expect(mockBuildUserBlockLabel).toHaveBeenCalledWith('telegram', 'U100');
    expect(mockAgentHasBlock).toHaveBeenCalledWith('agent-test-1', 'human/telegram_U100');
    expect(mockCreateAndAttachBlock).toHaveBeenCalledWith(
      'agent-test-1',
      'human/telegram_U100',
      'Template value for test',
      'User memory block',
      5000,
    );
  });

  it('skips API call on second message from same user (cache hit)', async () => {
    const bot = createBot('agent-test-1');
    const ensureBlock = (bot as any).ensureUserMemoryBlock.bind(bot);

    // First call: creates block
    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'hi' });
    expect(mockAgentHasBlock).toHaveBeenCalledTimes(1);
    expect(mockCreateAndAttachBlock).toHaveBeenCalledTimes(1);

    // Second call: should hit cache, no API calls
    vi.clearAllMocks();
    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'hello again' });
    expect(mockAgentHasBlock).not.toHaveBeenCalled();
    expect(mockCreateAndAttachBlock).not.toHaveBeenCalled();
  });

  it('caches label when block already exists on agent', async () => {
    mockAgentHasBlock.mockResolvedValue(true);
    const bot = createBot('agent-test-1');
    const ensureBlock = (bot as any).ensureUserMemoryBlock.bind(bot);

    await ensureBlock({ channel: 'slack', userId: 'U200', text: 'hi' });

    // Should check but not create
    expect(mockAgentHasBlock).toHaveBeenCalledWith('agent-test-1', 'human/slack_U200');
    expect(mockCreateAndAttachBlock).not.toHaveBeenCalled();

    // Second call: cached, no API at all
    vi.clearAllMocks();
    await ensureBlock({ channel: 'slack', userId: 'U200', text: 'again' });
    expect(mockAgentHasBlock).not.toHaveBeenCalled();
    expect(mockCreateAndAttachBlock).not.toHaveBeenCalled();
  });

  it('skips gracefully when no agentId is available', async () => {
    const bot = createBot(null);
    const ensureBlock = (bot as any).ensureUserMemoryBlock.bind(bot);

    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'hi' });

    expect(mockAgentHasBlock).not.toHaveBeenCalled();
    expect(mockCreateAndAttachBlock).not.toHaveBeenCalled();
  });

  it('treats different channels as different users', async () => {
    const bot = createBot('agent-test-1');
    const ensureBlock = (bot as any).ensureUserMemoryBlock.bind(bot);

    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'hi' });
    await ensureBlock({ channel: 'slack', userId: 'U100', text: 'hi' });

    // Both should create separate blocks
    expect(mockCreateAndAttachBlock).toHaveBeenCalledTimes(2);
    expect(mockCreateAndAttachBlock).toHaveBeenCalledWith(
      'agent-test-1', 'human/telegram_U100', expect.any(String), expect.any(String), expect.any(Number),
    );
    expect(mockCreateAndAttachBlock).toHaveBeenCalledWith(
      'agent-test-1', 'human/slack_U100', expect.any(String), expect.any(String), expect.any(Number),
    );
  });

  it('does not add to cache when createAndAttachBlock returns null', async () => {
    mockCreateAndAttachBlock.mockResolvedValue(null);
    const bot = createBot('agent-test-1');
    const ensureBlock = (bot as any).ensureUserMemoryBlock.bind(bot);

    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'hi' });

    // Should have tried to create
    expect(mockCreateAndAttachBlock).toHaveBeenCalledTimes(1);

    // Second call: NOT cached (creation failed), so should check again
    vi.clearAllMocks();
    mockAgentHasBlock.mockResolvedValue(false);
    mockCreateAndAttachBlock.mockResolvedValue(null);
    await ensureBlock({ channel: 'telegram', userId: 'U100', text: 'retry' });
    expect(mockAgentHasBlock).toHaveBeenCalledTimes(1);
    expect(mockCreateAndAttachBlock).toHaveBeenCalledTimes(1);
  });
});
