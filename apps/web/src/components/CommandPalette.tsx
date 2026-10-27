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

import { NavIcon, type IconName } from './NavIcon.js';
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
  icon: IconName;
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
            .map((p): SearchResult => ({
              id: `project_${p.id}`,
              group: 'Projects',
              icon: 'projects',
              title: p.name,
              subtitle: p.status,
              href: `/app/projects${scopeSuffix}`,
            })),
          ...employees.employees
            .filter((e) => matches(e.name, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((e): SearchResult => ({
              id: `employee_${e.id}`,
              group: 'Employees',
              icon: 'employees',
              title: e.name,
              subtitle: e.status,
              href: `/app/employees${scopeSuffix}`,
            })),
          ...documents.documents
            .filter((d) => matches(d.title, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((d): SearchResult => ({
              id: `document_${d.id}`,
              group: 'Documents',
              icon: 'documents',
              title: d.title,
              subtitle: d.status,
              href: `/app/documents${scopeSuffix}`,
            })),
          ...problems.problems
            .filter((p) => matches(p.title, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((p): SearchResult => ({
              id: `problem_${p.id}`,
              group: 'Problems',
              icon: 'problems',
              title: p.title,
              subtitle: `${p.severity} · ${p.status}`,
              href: `/app/problems${scopeSuffix}`,
            })),
          ...workflows.workflows
            .filter((w) => matches(w.definitionKey, trimmed))
            .slice(0, MAX_PER_GROUP)
            .map((w): SearchResult => ({
              id: `workflow_${w.id}`,
              group: 'Workflows',
              icon: 'workflows',
              title: w.definitionKey,
              subtitle: w.status,
              href: `/app/workflows${scopeSuffix}`,
            })),
          ...knowledge.references.slice(0, MAX_PER_GROUP).map((r): SearchResult => ({
            id: `knowledge_${r.sourceId}`,
            group: 'Knowledge',
            icon: 'knowledge',
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
        background: 'var(--nexora-overlay)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '13vh',
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
          maxWidth: '92vw',
          maxHeight: '62vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--nexora-surface)',
          borderRadius: 14,
          border: '1px solid var(--nexora-border)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.14), 0 8px 16px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '13px 16px',
            borderBottom: '1px solid var(--nexora-border)',
          }}
        >
          <span aria-hidden style={{ color: 'var(--nexora-textMuted)', display: 'inline-flex' }}>
            <NavIcon name="search" size={16} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, people, documents, problems…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: typography.sizes.md,
              color: 'var(--nexora-text)',
            }}
          />
          <kbd
            style={{
              fontSize: '11px',
              color: 'var(--nexora-textMuted)',
              border: '1px solid var(--nexora-border)',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            Esc
          </kbd>
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
              <div key={group} style={{ padding: '4px 8px' }}>
                <div
                  style={{
                    padding: '8px 10px 4px',
                    fontSize: '11px',
                    color: 'var(--nexora-textMuted)',
                    fontWeight: typography.weights.semibold,
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
                          gap: 11,
                          width: '100%',
                          textAlign: 'left',
                          padding: '9px 10px',
                          border: 'none',
                          borderRadius: 8,
                          background: active ? 'var(--nexora-surfaceMuted)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-flex',
                            color: active ? 'var(--nexora-text)' : 'var(--nexora-textMuted)',
                          }}
                        >
                          <NavIcon name={result.icon} size={15} />
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
