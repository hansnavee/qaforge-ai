import { describe, expect, it } from 'vitest';
import {
  caseFingerprint,
  classifyAgainstExisting,
  normalizeCaseText,
} from './case-fingerprint.js';

describe('caseFingerprint', () => {
  it('normalizes scenario wording', () => {
    expect(
      caseFingerprint({
        scenario: 'Valid User Can Log-In!',
        module: 'Login',
        designTechnique: 'HAPPY_PATH',
        requirementKey: 'REQ-001',
      }),
    ).toBe(
      caseFingerprint({
        scenario: 'valid user can log in',
        module: 'login',
        designTechnique: 'happy_path',
        requirementKey: 'req 001',
      }),
    );
  });

  it('classifies matching existing as updateCandidate', () => {
    const hit = classifyAgainstExisting({
      candidate: {
        scenario: 'Valid login',
        module: 'Login',
        designTechnique: 'HAPPY_PATH',
        requirementKey: 'REQ-001',
      },
      existing: [
        {
          id: 'a1',
          scenario: 'Valid login',
          module: 'Login',
          designTechnique: 'HAPPY_PATH',
          requirementKey: 'REQ-001',
        },
      ],
    });
    expect(hit.disposition).toBe('updateCandidate');
    expect(hit.matchId).toBe('a1');
  });

  it('treats different techniques as new', () => {
    const hit = classifyAgainstExisting({
      candidate: {
        scenario: 'Valid login',
        module: 'Login',
        designTechnique: 'NEGATIVE',
        requirementKey: 'REQ-001',
      },
      existing: [
        {
          id: 'a1',
          scenario: 'Valid login',
          module: 'Login',
          designTechnique: 'HAPPY_PATH',
          requirementKey: 'REQ-001',
        },
      ],
    });
    expect(hit.disposition).toBe('new');
  });

  it('normalizeCaseText strips punctuation', () => {
    expect(normalizeCaseText(`Don't "click" here!!!`)).toBe('dont click here');
  });
});
