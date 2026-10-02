/**
 * @nexora/app-web — shared problem investigation presentation.
 *
 * The read-only "what happened / why it matters / what Nexora recommends"
 * sections of a detected business problem — shared by the Problems console
 * and the Agent page so the two surfaces present the SAME investigation the
 * same way (one rendering, not two divergent ones). Renders only what the
 * server already returns; never fabricates evidence, confidence, or a
 * recommendation.
 */

import type { ReactNode } from 'react';
import { Badge, typography } from '@nexora/design-system';

import { humanizeProblemText, humanizeRecommendationSummary } from '../lib/humanize.js';
import type {
  BusinessProblemDto,
  ProblemRecommendation,
  RootCauseCandidate,
  SolutionCandidate,
} from '../lib/types.js';

/** Maps a problem severity to a badge tone (shared by every problem surface). */
export function severityTone(
  severity: BusinessProblemDto['severity'],
): 'danger' | 'warning' | 'success' {
  if (severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'success';
}

/** Maps a solution applicability to a badge tone (shared by every problem surface). */
export function applicabilityTone(
  applicability: SolutionCandidate['applicability'],
): 'success' | 'primary' | 'warning' {
  if (applicability === 'APPLICABLE') return 'success';
  if (applicability === 'REJECTED') return 'warning';
  return 'primary';
}

/** The severity accent color used for a problem card's left rail. */
export function severityAccent(severity: BusinessProblemDto['severity']): string {
  if (severity === 'high') return 'var(--nexora-danger)';
  if (severity === 'medium') return 'var(--nexora-warning)';
  return 'var(--nexora-success)';
}

/** A small uppercase eyebrow label above a section of investigation content. */
export function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="nexora-section-title">{children}</div>;
}

/** Readable labels for evidence source keys (never a raw bracketed tag). */
const SOURCE_LABELS: Record<string, string> = {
  activity: 'Activity',
  notifications: 'Notification',
  agent_executions: 'Prior execution',
  knowledge: 'Knowledge base',
  documents: 'Document',
  measurements: 'Measurement',
};

/** The "what Nexora recommends" banner: the deterministic recommendation. */
export function RecommendationBanner({
  recommendation,
}: {
  recommendation: ProblemRecommendation;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        borderRadius: 10,
        background: 'var(--nexora-primarySoft)',
        borderLeft: '3px solid var(--nexora-primary)',
        padding: '12px 14px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.semibold,
            color: 'var(--nexora-primary)',
            marginBottom: 3,
          }}
        >
          Nexora recommends
        </div>
        <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-text)' }}>
          {humanizeRecommendationSummary(recommendation.summary)}
        </div>
      </div>
    </div>
  );
}

/** The evidence timeline: grounded facts, newest-looking first, never invented. */
export function EvidenceList({
  evidence,
}: {
  evidence: readonly BusinessProblemDto['evidence'][number][];
}): JSX.Element | null {
  if (evidence.length === 0) return null;
  return (
    <div>
      <SectionLabel>What happened</SectionLabel>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {evidence.map((item) => (
          <div
            key={item.id}
            style={{
              borderLeft: '2px solid var(--nexora-borderStrong)',
              paddingLeft: 12,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.semibold,
                  color: 'var(--nexora-textMuted)',
                }}
              >
                {SOURCE_LABELS[item.source] ?? item.source}
              </span>
              {item.occurredAt !== undefined ? (
                <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {new Date(item.occurredAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {humanizeProblemText(item.fact)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The root-cause candidates: FACT vs INFERENCE, each with its suggested next step. */
export function RootCauseList({
  rootCauses,
}: {
  rootCauses: readonly RootCauseCandidate[];
}): JSX.Element | null {
  if (rootCauses.length === 0) return null;
  return (
    <div>
      <SectionLabel>Why it matters</SectionLabel>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rootCauses.map((cause, index) => (
          <div
            key={`${cause.explanation}-${index}`}
            style={{
              border: '1px solid var(--nexora-border)',
              borderRadius: 10,
              padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={cause.kind === 'FACT' ? 'primary' : 'neutral'}>{cause.kind}</Badge>
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {cause.confidence.toLowerCase()} confidence
              </span>
            </div>
            <div style={{ fontSize: typography.sizes.sm, marginTop: 6 }}>
              {humanizeProblemText(cause.explanation)}
            </div>
            {cause.nextStep.length > 0 ? (
              <div
                style={{
                  fontSize: typography.sizes.xs,
                  color: 'var(--nexora-textSecondary)',
                  marginTop: 6,
                }}
              >
                <span style={{ color: 'var(--nexora-textMuted)' }}>Next: </span>
                {cause.nextStep}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The known-solution candidates: found existing knowledge, never invented. */
export function KnownSolutionsList({
  solutions,
}: {
  solutions: readonly SolutionCandidate[];
}): JSX.Element | null {
  if (solutions.length === 0) return null;
  return (
    <div>
      <SectionLabel>Known solutions</SectionLabel>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {solutions.map((solution) => (
          <div
            key={solution.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              border: '1px solid var(--nexora-border)',
              borderRadius: 10,
              padding: '9px 12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <Badge tone={applicabilityTone(solution.applicability)}>
                  {solution.applicability}
                </Badge>
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {solution.title}
                </span>
              </div>
              {solution.reference !== undefined ? (
                <span
                  title={solution.reference.id}
                  style={{
                    fontSize: typography.sizes.xs,
                    color: 'var(--nexora-textMuted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 220,
                    flexShrink: 1,
                  }}
                >
                  {solution.reference.title}
                </span>
              ) : null}
            </div>
            {solution.applicability === 'REJECTED' && solution.rejectionReason !== undefined ? (
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {solution.rejectionReason}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The full investigation body — a story, not a database dump: what happened
 * → why it matters → known solutions → what Nexora recommends. The
 * recommendation reads as a conclusion the evidence leads to, not a banner
 * announced before any of that evidence is shown.
 */
export function ProblemInvestigation({ problem }: { problem: BusinessProblemDto }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <EvidenceList evidence={problem.evidence} />
      <RootCauseList rootCauses={problem.rootCauses} />
      <KnownSolutionsList solutions={problem.solutions} />
      {problem.recommendation !== undefined ? (
        <RecommendationBanner recommendation={problem.recommendation} />
      ) : null}
    </div>
  );
}
