/**
 * @nexora/app-api — evidence extraction (Prompt 6).
 *
 * Turns the output of a tool that actually RAN into typed, provenance-carrying
 * evidence candidates: what object it came from (source type + exact id), its
 * version when it has one, a fingerprint of the structured facts, and a
 * DESCRIPTIVE trust class. Nothing here reads anything authoritative and
 * nothing produced here is ever consulted by an authorization, policy or
 * approval decision.
 *
 * Fencing: an item that names a workspace other than the run's trusted
 * workspace is DROPPED (counted, never recorded) — even if a retrieval path
 * regressed, evidence from another workspace can never be recorded as
 * evidence of this run or shown as its provenance.
 */

import type { EvidenceSourceType, EvidenceTrust } from '@nexora/module-lineage';
import { fingerprintOf } from '@nexora/module-lineage';
import type { ExecutionEvent } from '@nexora/ai-runtime/execution';

/** One piece of evidence found in a tool result. */
export interface EvidenceCandidate {
  sourceType: EvidenceSourceType;
  sourceId: string;
  title?: string;
  sourceVersion?: number | string;
  sourceUpdatedAt?: string;
  trust: EvidenceTrust;
  /** sha256 of the canonical structured facts (never the raw content). */
  fingerprint: string;
  connector?: string;
}

/** The extraction result. */
export interface ExtractedEvidence {
  items: readonly EvidenceCandidate[];
  /** Items dropped because they named a workspace other than the run's. */
  droppedOutOfScope: number;
}

const MAX_ITEMS = 20;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : [];
}

/** Extracts evidence from a successful execution's output. */
export function extractEvidence(event: ExecutionEvent): ExtractedEvidence {
  const output = record(event.output);
  if (event.status !== 'succeeded' || output === undefined) {
    return { items: [], droppedOutOfScope: 0 };
  }
  const items: EvidenceCandidate[] = [];
  let dropped = 0;

  const fenced = (workspaceId: unknown): boolean => {
    if (typeof workspaceId === 'string' && workspaceId !== event.workspaceId) {
      dropped += 1;
      return false;
    }
    return true;
  };

  switch (event.toolId) {
    case 'knowledge.search':
    case 'documents.search': {
      // Fence FIRST (foreign items are counted and dropped even when they
      // carry no usable id), THEN cap: foreign items never use up slots.
      const refs = list(output['references'] ?? output['documents']).filter((ref) =>
        fenced(ref['workspaceId']),
      );
      for (const ref of refs.slice(0, MAX_ITEMS)) {
        const sourceId = str(ref['sourceId']) ?? str(ref['documentId']) ?? str(ref['id']);
        if (sourceId === undefined) {
          continue;
        }
        const kind = str(ref['kind']);
        const sourceType: EvidenceSourceType =
          kind === 'article' ? 'KNOWLEDGE_ARTICLE' : 'DOCUMENT';
        const version = typeof ref['version'] === 'number' ? ref['version'] : undefined;
        items.push({
          sourceType,
          sourceId,
          ...(str(ref['title']) === undefined ? {} : { title: str(ref['title']) as string }),
          ...(version === undefined ? {} : { sourceVersion: version }),
          trust: 'KNOWLEDGE_CONTENT',
          // The snippet is fingerprinted, never stored: integrity without a raw copy.
          fingerprint: fingerprintOf({
            sourceType,
            sourceId,
            version,
            title: ref['title'],
            snippet: ref['snippet'],
          }),
        });
      }
      break;
    }
    case 'projects.find_project':
    case 'hr.find_employee': {
      const sourceType: EvidenceSourceType =
        event.toolId === 'projects.find_project' ? 'PROJECT' : 'EMPLOYEE';
      for (const entity of list(output['projects'] ?? output['employees']).slice(0, MAX_ITEMS)) {
        const sourceId = str(entity['id']);
        if (sourceId === undefined) {
          continue;
        }
        items.push({
          sourceType,
          sourceId,
          ...(str(entity['name']) === undefined ? {} : { title: str(entity['name']) as string }),
          ...(str(entity['updatedAt']) === undefined
            ? {}
            : { sourceUpdatedAt: str(entity['updatedAt']) as string }),
          ...(typeof entity['version'] === 'number' ? { sourceVersion: entity['version'] } : {}),
          trust: 'PERSISTED_BUSINESS_RECORD',
          fingerprint: fingerprintOf({ sourceType, entity }),
        });
      }
      break;
    }
    default: {
      if (event.toolId.startsWith('github.') || event.toolId.startsWith('slack.')) {
        const connector = event.toolId.split('.')[0] as string;
        const collections = ['repositories', 'issues', 'channels', 'messages'] as const;
        for (const name of collections) {
          for (const entry of list(output[name]).slice(0, MAX_ITEMS)) {
            const identity =
              str(entry['htmlUrl']) ??
              str(entry['fullName']) ??
              str(entry['full_name']) ??
              str(entry['id']) ??
              str(entry['ts']) ??
              (typeof entry['number'] === 'number' ? String(entry['number']) : undefined) ??
              fingerprintOf(entry).slice(0, 16);
            items.push({
              sourceType: 'EXTERNAL_CONNECTOR',
              sourceId: `${connector}:${name}:${identity}`,
              ...((str(entry['title']) ?? str(entry['name'])) === undefined
                ? {}
                : { title: (str(entry['title']) ?? str(entry['name'])) as string }),
              // External content is data: descriptive trust only, no authority.
              trust: 'EXTERNAL_CONTENT',
              fingerprint: fingerprintOf({ connector, name, entry }),
              connector,
            });
          }
        }
      }
    }
  }
  return { items, droppedOutOfScope: dropped };
}

/** The business object a mutating tool result names (type + id), when it names one. */
export function affectedResourceOf(output: unknown): { type: string; id: string } | undefined {
  const root = record(output);
  if (root === undefined) {
    return undefined;
  }
  for (const key of [
    'expense',
    'event',
    'project',
    'employee',
    'workspace',
    'budget',
    'assignment',
  ]) {
    const id = str(record(root[key])?.['id']);
    if (id !== undefined) {
      return { type: key, id };
    }
  }
  return undefined;
}
