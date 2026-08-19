/**
 * @nexora/app-web — CommandPalette (S27 Phase 6, global search).
 *
 * A ⌘K command palette over EXISTING data only: it queries the SAME list
 * endpoints every page already uses (projects, employees, documents,
 * problems, workflows) plus the real grounded knowledge search
 * (`/api/knowledge/search`) — no new search infrastructure, no vector
 * database. List endpoints are filtered client-side (title/name
 * substring); knowledge uses the server's own full-text retrieval. Results
 * only ever come from the caller's current trusted (organization,
 * workspace) scope — never a client-supplied one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { typography } from '@nexora/design-system';

import { api } from '../lib/api.js';
import type {
  BusinessProblemDto,
  DocumentDto,
  EmployeeDto,
  KnowledgeReferenceDto,
  ProjectDto,
  WorkflowInstanceDto,
} from '../lib/types.js';

/** Props of {@link CommandPalette}. */
export interface CommandPaletteProps {
  /** Whether the palette is open. */
  open: boolean;
  /** Closes the palette. */
  onClose: () => void;
  /** The current organization id (trusted scope). */
  organizationId?: string;
  /** The current workspace id (trusted scope). */
  workspaceId?: string;
}

/** A single, uniform search result row. */
interface SearchResult {
  id: string;
  group: string;
  icon: string;
  title: string;
  subtitle?: string;
  href: string;
}

const MAX_PER_GROUP = 5;

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/** The global ⌘K search palette. */
export function CommandPalette({
  open,
  onClose,
  organizationId,
  workspaceId,
}: CommandPaletteProps): JSX.Element | null {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scopeSuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (organizationId !== undefined) params.set('organizationId', organizationId);
    if (workspaceId !== undefined) params.set('workspaceId', workspaceId);
    const suffix = params.toString();
    return suffix.length > 0 ? `?${suffix}` : '';
  }, [organizationId, workspaceId]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // A document-level Escape listener — closes the palette regardless of
  // which element currently has focus (not just the search input).
  useEffect(() => {
    if (!open) return;
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [open, onClose]);

  const search = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0 || organizationId === undefined) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const [projects, employees, documents, problems, workflows, knowledge] = await Promise.all([
          api<{ projects: ProjectDto[] }>(`/projects${scopeSuffix}`).catch(() => ({
            projects: [],
          })),
          api<{ employees: EmployeeDto[] }>(`/employees${scopeSuffix}`).catch(() => ({
            employees: [],
          })),
          workspaceId === undefined
            ? Promise.resolve({ documents: [] as DocumentDto[] })
            : api<{ documents: DocumentDto[] }>(`/documents${scopeSuffix}`).catch(() => ({
                documents: [],
              })),
          workspaceId === undefined
            ? Promise.resolve({ problems: [] as BusinessProblemDto[] })
            : api<{ problems: BusinessProblemDto[] }>(`/problems${scopeSuffix}`).catch(() => ({
                problems: [],
              })),
          api<{ workflows: WorkflowInstanceDto[] }>(`/workflows${scopeSuffix}`).catch(() => ({
            workflows: [],
          })),
          workspaceId === undefined
            ? Promise.resolve({ references: [] as KnowledgeReferenceDto[] })
            : api<{ references: KnowledgeReferenceDto[] }>(
                `/knowledge/search${scopeSuffix}&q=${encodeURIComponent(trimmed)}`,
              ).catch(() => ({ references: [] })),
        ]);

        const grouped: SearchResult[] = [
          ...projects.projects
            .filter((p) => matches(p.name, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((p) => ({
              id: `project_${p.id}`,
              group: 'Projects',
              icon: '▤',
              title: p.name,
              subtitle: p.status,
              href: `/app/projects${scopeSuffix}`,
            })),
          ...employees.employees
            .filter((e) => matches(e.name, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((e) => ({
              id: `employee_${e.id}`,
              group: 'Employees',
              icon: '⚕',
              title: e.name,
              subtitle: e.status,
              href: `/app/employees${scopeSuffix}`,
            })),
          ...documents.documents
            .filter((d) => matches(d.title, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((d) => ({
              id: `document_${d.id}`,
              group: 'Documents',
              icon: '▤',
              title: d.title,
              subtitle: d.status,
              href: `/app/documents${scopeSuffix}`,
            })),
          ...problems.problems
            .filter((p) => matches(p.title, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((p) => ({
              id: `problem_${p.id}`,
              group: 'Problems',
              icon: '⚠',
              title: p.title,
              subtitle: `${p.severity} · ${p.status}`,
              href: `/app/problems${scopeSuffix}`,
            })),
          ...workflows.workflows
            .filter((w) => matches(w.definitionKey, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((w) => ({
              id: `workflow_${w.id}`,
              group: 'Workflows',
              icon: '⧉',
              title: w.definitionKey,
              subtitle: w.status,
              href: `/app/workflows${scopeSuffix}`,
            })),
          ...knowledge.references.slice(0, MAX_PER_GROUP).map((r) => ({
            id: `knowledge_${r.sourceId}`,
            group: 'Knowledge',
            icon: '📚',
            title: r.title,
            subtitle: r.snippet,
            href: `/app/knowledge${scopeSuffix}`,
          })),
        ];
        setResults(grouped);
        setActiveIndex(0);
      } finally {
        setLoading(false);
      }
    },
    [organizationId, workspaceId, scopeSuffix],
  );

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => void search(query), 200);
    return () => clearTimeout(handle);
  }, [query, open, search]);

  const openResult = useCallback(
    (result: SearchResult) => {
      onClose();
      navigate(result.href);
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        const result = results[activeIndex];
        if (result !== undefined) {
          openResult(result);
        }
      }
    },
    [results, activeIndex, onClose, openResult],
  );

  if (!open) {
    return null;
  }

  const groups = Array.from(new Set(results.map((r) => r.group)));

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 15, 20, 0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 100,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Nexora"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '90vw',
          maxHeight: '65vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--nexora-surface)',
          borderRadius: 16,
          border: '1px solid var(--nexora-borderStrong)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--nexora-border)',
          }}
        >
          <span aria-hidden style={{ color: 'var(--nexora-textMuted)' }}>
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, employees, documents, problems, workflows, knowledge…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: typography.sizes.base,
              color: 'var(--nexora-text)',
            }}
          />
          <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Esc
          </span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {query.trim().length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-textMuted)',
              }}
            >
              Type to search across your workspace.
            </div>
          ) : loading ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-textMuted)',
              }}
            >
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-textMuted)',
              }}
            >
              No matches for “{query}”.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group}>
                <div
                  style={{
                    padding: '8px 18px 4px',
                    fontSize: typography.sizes.xs,
                    color: 'var(--nexora-textMuted)',
                    fontWeight: typography.weights.medium,
                  }}
                >
                  {group}
                </div>
                {results
                  .filter((r) => r.group === group)
                  .map((result) => {
                    const index = results.indexOf(result);
                    const active = index === activeIndex;
                    return (
                      <button
                        key={result.id}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => openResult(result)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 18px',
                          border: 'none',
                          background: active ? 'var(--nexora-primarySoft)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
                          {result.icon}
                        </span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: typography.sizes.sm,
                              fontWeight: typography.weights.medium,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {result.title}
                          </div>
                          {result.subtitle !== undefined ? (
                            <div
                              style={{
                                fontSize: typography.sizes.xs,
                                color: 'var(--nexora-textMuted)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.subtitle}
                            </div>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
