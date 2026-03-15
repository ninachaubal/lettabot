import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from './system-prompt.js';

// ---------------------------------------------------------------------------
// Memory section – multi-user awareness (Phase 7)
// ---------------------------------------------------------------------------
describe('SYSTEM_PROMPT Memory section', () => {
  // Extract the full Memory section (from "# Memory" heading to the next top-level heading).
  // Use a regex to match the exact top-level heading (start of line, single #, space, "Memory").
  const memoryMatch = SYSTEM_PROMPT.match(/^# Memory\n([\s\S]*?)(?=\n# [A-Z])/m);
  const memorySection = memoryMatch?.[1] ?? '';

  it('contains a Memory heading', () => {
    expect(SYSTEM_PROMPT).toContain('# Memory');
  });

  it('explains the agent serves multiple users', () => {
    expect(memorySection).toMatch(/multiple users/i);
  });

  it('describes per-user memory block naming convention human/<channel>_<userId>', () => {
    expect(memorySection).toContain('human/');
    // Should include an example like human/slack_U0123
    expect(memorySection).toMatch(/human\/\w+_\w+/);
  });

  it('explains User ID metadata maps to the memory block label', () => {
    expect(memorySection).toMatch(/[Uu]ser\s*ID/);
    expect(memorySection).toMatch(/metadata/i);
  });

  it('instructs to use core_memory_replace on the matching user block', () => {
    expect(memorySection).toContain('core_memory_replace');
  });

  it('explains new user blocks are created automatically with placeholder content', () => {
    expect(memorySection).toMatch(/automatically/i);
    expect(memorySection).toMatch(/placeholder/i);
  });

  it('mentions persona blocks for agent identity that are shared (not per-user)', () => {
    expect(memorySection).toContain('persona/');
    expect(memorySection).toMatch(/shared/i);
  });

  it('still mentions external memory', () => {
    expect(memorySection).toMatch(/external memory/i);
  });

  // Verify we did NOT remove other sections
  it('preserves the Skills section', () => {
    expect(SYSTEM_PROMPT).toContain('# Skills');
  });

  it('preserves the Communication System section', () => {
    expect(SYSTEM_PROMPT).toContain('# Communication System');
  });

  it('preserves the Security section', () => {
    expect(SYSTEM_PROMPT).toContain('# Security');
  });

  // Verify the old single-user wording is gone
  it('does NOT contain old single-user memory wording', () => {
    expect(memorySection).not.toContain('They are the foundation which makes you *you*');
  });
});
