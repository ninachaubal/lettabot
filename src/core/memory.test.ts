import { describe, it, expect } from 'vitest';
import { buildUserBlockLabel, loadUserBlockTemplate } from './memory.js';

describe('buildUserBlockLabel', () => {
  it('formats channel and userId into a label', () => {
    expect(buildUserBlockLabel('telegram', 'U123')).toBe('human/telegram_U123');
  });

  it('handles slack channel with complex userId', () => {
    expect(buildUserBlockLabel('slack', 'U0ABC99')).toBe('human/slack_U0ABC99');
  });

  it('handles discord channel', () => {
    expect(buildUserBlockLabel('discord', '12345678')).toBe('human/discord_12345678');
  });
});

describe('loadUserBlockTemplate', () => {
  it('returns a UserBlockTemplate with value, description, and limit', () => {
    const template = loadUserBlockTemplate('TestBot');
    expect(template).toHaveProperty('value');
    expect(template).toHaveProperty('description');
    expect(template).toHaveProperty('limit');
    expect(typeof template.value).toBe('string');
    expect(typeof template.description).toBe('string');
    expect(typeof template.limit).toBe('number');
  });

  it('substitutes agent name in template value', () => {
    // The template itself does not contain {{AGENT_NAME}} after loading,
    // but we verify the substitution works by checking the value doesn't
    // still contain the placeholder.
    const template = loadUserBlockTemplate('MyAgent');
    expect(template.value).not.toContain('{{AGENT_NAME}}');
  });

  it('returns a non-empty value from human.mdx', () => {
    const template = loadUserBlockTemplate();
    expect(template.value.length).toBeGreaterThan(0);
  });

  it('returns a numeric limit', () => {
    const template = loadUserBlockTemplate();
    expect(template.limit).toBeGreaterThan(0);
  });
});
