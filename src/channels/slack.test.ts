import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock @slack/bolt before importing the adapter
const slackMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown | Promise<unknown>;
  type EventHandler = (event: string, handler: Handler) => void;

  let messageHandler: Handler | null = null;
  let eventHandlers: Record<string, Handler> = {};

  const mockClient = {
    users: {
      info: vi.fn(),
    },
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: 'sent-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    reactions: {
      add: vi.fn().mockResolvedValue({}),
    },
  };

  class MockApp {
    client = mockClient;

    message(handler: Handler) {
      messageHandler = handler;
    }

    event(eventName: string, handler: Handler) {
      eventHandlers[eventName] = handler;
    }

    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  }

  return {
    App: MockApp,
    getMessageHandler: () => messageHandler,
    getEventHandler: (name: string) => eventHandlers[name],
    mockClient,
    reset: () => {
      messageHandler = null;
      eventHandlers = {};
      mockClient.users.info.mockReset();
      mockClient.chat.postMessage.mockReset().mockResolvedValue({ ts: 'sent-1' });
      mockClient.chat.update.mockReset().mockResolvedValue({});
      mockClient.reactions.add.mockReset().mockResolvedValue({});
    },
  };
});

vi.mock('@slack/bolt', () => ({
  App: slackMock.App,
}));

const { SlackAdapter } = await import('./slack.js');

function makeConfig(overrides: Partial<import('./slack.js').SlackConfig> = {}): import('./slack.js').SlackConfig {
  return {
    botToken: 'xoxb-test',
    appToken: 'xapp-test',
    ...overrides,
  };
}

describe('SlackAdapter user profile resolution', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    slackMock.reset();
  });

  it('resolves userName from Slack user profile via display_name in message handler', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    // Mock users.info to return a display_name
    slackMock.mockClient.users.info.mockResolvedValue({
      ok: true,
      user: {
        profile: { display_name: 'Alice' },
        real_name: 'Alice Smith',
        name: 'alice',
      },
    });

    const handler = slackMock.getMessageHandler();
    expect(handler).toBeTruthy();

    await handler!({
      message: {
        user: 'U12345',
        text: 'hello',
        channel: 'D99999',
        ts: '1234567890.123456',
      },
      say: vi.fn(),
      client: slackMock.mockClient,
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    const msg = onMessage.mock.calls[0][0];
    expect(msg.userName).toBe('Alice');
    expect(msg.userHandle).toBe('U12345');
    expect(msg.userId).toBe('U12345');
  });

  it('falls back to real_name when display_name is empty', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    slackMock.mockClient.users.info.mockResolvedValue({
      ok: true,
      user: {
        profile: { display_name: '' },
        real_name: 'Bob Jones',
        name: 'bob',
      },
    });

    const handler = slackMock.getMessageHandler();
    await handler!({
      message: {
        user: 'U67890',
        text: 'hi',
        channel: 'D99998',
        ts: '1234567890.123457',
      },
      say: vi.fn(),
      client: slackMock.mockClient,
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].userName).toBe('Bob Jones');
  });

  it('falls back to userId when users.info fails', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    slackMock.mockClient.users.info.mockRejectedValue(new Error('API error'));

    const handler = slackMock.getMessageHandler();
    await handler!({
      message: {
        user: 'UFAILED',
        text: 'test',
        channel: 'D99997',
        ts: '1234567890.123458',
      },
      say: vi.fn(),
      client: slackMock.mockClient,
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].userName).toBe('UFAILED');
  });

  it('caches user profile lookups across messages', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    slackMock.mockClient.users.info.mockResolvedValue({
      ok: true,
      user: {
        profile: { display_name: 'Charlie' },
        real_name: 'Charlie Brown',
        name: 'charlie',
      },
    });

    const handler = slackMock.getMessageHandler();

    // Send two messages from the same user
    await handler!({
      message: { user: 'UCACHED', text: 'msg1', channel: 'D99996', ts: '1234567890.000001' },
      say: vi.fn(),
      client: slackMock.mockClient,
    });
    await handler!({
      message: { user: 'UCACHED', text: 'msg2', channel: 'D99996', ts: '1234567890.000002' },
      say: vi.fn(),
      client: slackMock.mockClient,
    });

    expect(onMessage).toHaveBeenCalledTimes(2);
    // Both messages should have the display name
    expect(onMessage.mock.calls[0][0].userName).toBe('Charlie');
    expect(onMessage.mock.calls[1][0].userName).toBe('Charlie');
    // But users.info should only be called once (cached)
    expect(slackMock.mockClient.users.info).toHaveBeenCalledTimes(1);
    expect(slackMock.mockClient.users.info).toHaveBeenCalledWith({ user: 'UCACHED' });
  });

  it('resolves userName in app_mention handler', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    slackMock.mockClient.users.info.mockResolvedValue({
      ok: true,
      user: {
        profile: { display_name: 'Diana' },
        real_name: 'Diana Prince',
        name: 'diana',
      },
    });

    const mentionHandler = slackMock.getEventHandler('app_mention');
    expect(mentionHandler).toBeTruthy();

    await mentionHandler!({
      event: {
        user: 'UMENTION',
        text: '<@BOTID> hello bot',
        channel: 'C11111',
        ts: '1234567890.123460',
      },
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    const msg = onMessage.mock.calls[0][0];
    expect(msg.userName).toBe('Diana');
    expect(msg.userHandle).toBe('UMENTION');
  });

  it('resolves userName in reaction_added handler', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    slackMock.mockClient.users.info.mockResolvedValue({
      ok: true,
      user: {
        profile: { display_name: 'Eve' },
        real_name: 'Eve Adams',
        name: 'eve',
      },
    });

    const reactionHandler = slackMock.getEventHandler('reaction_added');
    expect(reactionHandler).toBeTruthy();

    await reactionHandler!({
      event: {
        user: 'UREACTION',
        reaction: 'thumbsup',
        item: { channel: 'C22222', ts: '1234567890.123461' },
        event_ts: '1234567890.123462',
      },
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    const msg = onMessage.mock.calls[0][0];
    expect(msg.userName).toBe('Eve');
    expect(msg.userHandle).toBe('UREACTION');
  });

  it('falls back to name when both display_name and real_name are empty', async () => {
    const adapter = new SlackAdapter(makeConfig());
    const onMessage = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage = onMessage;

    await adapter.start();

    slackMock.mockClient.users.info.mockResolvedValue({
      ok: true,
      user: {
        profile: { display_name: '' },
        real_name: '',
        name: 'fallback_user',
      },
    });

    const handler = slackMock.getMessageHandler();
    await handler!({
      message: { user: 'UNONAME', text: 'test', channel: 'D99995', ts: '1234567890.123463' },
      say: vi.fn(),
      client: slackMock.mockClient,
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].userName).toBe('fallback_user');
  });
});
