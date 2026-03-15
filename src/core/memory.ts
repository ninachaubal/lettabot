/**
 * Memory loader - reads .mdx files from src/memories/ and returns
 * CreateBlock objects for the Letta Code SDK.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

import { createLogger } from '../logger.js';

const log = createLogger('Memory');
const __dirname = dirname(fileURLToPath(import.meta.url));
// Try dist/memories first, fall back to src/memories
const MEMORIES_DIR = existsSync(join(__dirname, '..', 'memories'))
  ? join(__dirname, '..', 'memories')
  : join(__dirname, '..', '..', 'src', 'memories');

export interface MemoryBlock {
  label: string;
  value: string;
  description?: string;
  limit?: number;
}

/**
 * Load all .mdx files from the memories directory and parse them into
 * memory blocks for the SDK's `memory` option.
 *
 * @param agentName - Name to substitute for {{AGENT_NAME}} in block values
 */
export function loadMemoryBlocks(agentName = 'LettaBot'): MemoryBlock[] {
  if (!existsSync(MEMORIES_DIR)) {
    log.warn(`No memories directory found at ${MEMORIES_DIR}`);
    return [];
  }
  
  const files = readdirSync(MEMORIES_DIR).filter((f: string) => f.endsWith('.mdx'));
  const blocks: MemoryBlock[] = [];

  for (const file of files) {
    const raw = readFileSync(join(MEMORIES_DIR, file), 'utf-8');
    const { data, content } = matter(raw);

    const label = data.label || file.replace('.mdx', '');
    const block: MemoryBlock = {
      label,
      value: content.trim().replaceAll('{{AGENT_NAME}}', agentName),
    };

    if (data.description) block.description = data.description;
    if (data.limit) block.limit = Number(data.limit);

    blocks.push(block);
  }

  return blocks.filter((b) => !b.label.startsWith('human/'));
}

/**
 * Template data returned by loadUserBlockTemplate().
 */
export interface UserBlockTemplate {
  value: string;
  description: string;
  limit: number;
}

/**
 * Read the human.mdx template and return a ready-to-use block value
 * with {{AGENT_NAME}} already substituted.
 *
 * @param agentName - Name to substitute for {{AGENT_NAME}} in block value
 */
export function loadUserBlockTemplate(agentName = 'LettaBot'): UserBlockTemplate {
  const filePath = join(MEMORIES_DIR, 'human.mdx');
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  return {
    value: content.trim().replaceAll('{{AGENT_NAME}}', agentName),
    description: data.description ?? '',
    limit: Number(data.limit) || 5000,
  };
}

/**
 * Build the per-user block label used to store a user's memory block
 * on the Letta agent.
 *
 * @param channel - Channel identifier (e.g. "slack", "telegram")
 * @param userId  - Channel-specific user ID (e.g. "U0123")
 * @returns Label string like "human/slack_U0123"
 */
export function buildUserBlockLabel(channel: string, userId: string): string {
  return `human/${channel}_${userId}`;
}
