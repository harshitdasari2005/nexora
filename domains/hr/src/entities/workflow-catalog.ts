/**
 * @nexora/domain-hr — the office workflow catalog.
 *
 * Every department runs the same shape of work — someone asks, the right
 * people decide, someone does it, it is recorded — and differs only in what is
 * asked for and who holds each seat. This catalog is that difference, written
 * as data: for each workflow, the form the requester fills in and the stages
 * the request travels through.
 *
 * A stage names a SEAT, not a person. Who holds a seat is decided by the
 * platform's role catalog (the API maps each seat to a capability), so the
 * catalog never names users and never grants anything by itself.
 */

/** Who a stage belongs to. */
export const WORKFLOW_SEATS = [
  /** A manager of the team the request was raised from. */
  'manager',
  /** The chief executive. */
  'executive',
  'hr',
  'finance',
  'it',
  'engineering',
  'marketing',
  'sales',
  'support',
  'legal',
  /** The person who raised the request (confirming, acknowledging). */
  'requester',
] as const;
export type WorkflowSeat = (typeof WORKFLOW_SEATS)[number];

/** What happens at a stage: a yes/no decision, or a piece of work to be done. */
export type WorkflowStageKind = 'decide' | 'do';

/** One stage of a workflow. */
export interface WorkflowStageDefinition {
  /** Unique within the workflow; stored in the request's history. */
  key: string;
  /** What the stage is, as people say it ("Finance approves the budget"). */
  label: string;
  kind: WorkflowStageKind;
  seat: WorkflowSeat;
  /** A `do` stage whose outcome must be written down (results, the fix, the reply). */
  noteRequired?: boolean;
  /** What the note is, when one is asked for ("What was the result?"). */
  noteLabel?: string;
}

/** The kinds of value a form field holds. */
export type WorkflowFieldType = 'text' | 'longtext' | 'date' | 'money' | 'number' | 'choice';

/** One field of a workflow's form. */
export interface WorkflowFieldDefinition {
  key: string;
  label: string;
  type: WorkflowFieldType;
  required: boolean;
  /** The allowed values of a `choice` field. */
  options?: readonly string[];
  placeholder?: string;
}

/** The departments of the office, in the order they are shown. */
export const WORKFLOW_DEPARTMENTS = [
  'Leadership',
  'People',
  'Engineering',
  'Marketing',
  'Sales',
  'Customer support',
  'Finance',
  'IT and security',
  'Legal and admin',
] as const;
export type WorkflowDepartment = (typeof WORKFLOW_DEPARTMENTS)[number];

/** One workflow: what is asked for, and the chain it travels. */
export interface WorkflowDefinition {
  /** Stable id (stored on every request of this kind). */
  key: string;
  department: WorkflowDepartment;
  /** What the workflow is called ("Leave", "Marketing campaign"). */
  name: string;
  /** One sentence on what it is for. */
  description: string;
  fields: readonly WorkflowFieldDefinition[];
  stages: readonly WorkflowStageDefinition[];
  /** The fields that name a request in a list, in order. */
  summaryFields: readonly string[];
  /** What the "why" box asks for. */
  reasonLabel: string;
}

const text = (
  key: string,
  label: string,
  placeholder?: string,
  required = true,
): WorkflowFieldDefinition => ({
  key,
  label,
  type: 'text',
  required,
  ...(placeholder === undefined ? {} : { placeholder }),
});
const long = (key: string, label: string, required = true): WorkflowFieldDefinition => ({
  key,
  label,
  type: 'longtext',
  required,
});
const date = (key: string, label: string, required = true): WorkflowFieldDefinition => ({
  key,
  label,
  type: 'date',
  required,
});
const money = (key: string, label: string, required = true): WorkflowFieldDefinition => ({
  key,
  label,
  type: 'money',
  required,
});
const choice = (
  key: string,
  label: string,
  options: readonly string[],
): WorkflowFieldDefinition => ({ key, label, type: 'choice', required: true, options });
const number = (key: string, label: string): WorkflowFieldDefinition => ({
  key,
  label,
  type: 'number',
  required: true,
});

const decide = (key: string, label: string, seat: WorkflowSeat): WorkflowStageDefinition => ({
  key,
  label,
  kind: 'decide',
  seat,
});
const work = (
  key: string,
  label: string,
  seat: WorkflowSeat,
  noteLabel?: string,
): WorkflowStageDefinition => ({
  key,
  label,
  kind: 'do',
  seat,
  ...(noteLabel === undefined ? {} : { noteRequired: true, noteLabel }),
});

const SEVERITY = ['low', 'medium', 'high', 'critical'] as const;

/** Every workflow of the office. */
export const WORKFLOW_CATALOG: readonly WorkflowDefinition[] = [
  // --- Leadership ------------------------------------------------------------
  {
    key: 'project_proposal',
    department: 'Leadership',
    name: 'Project proposal',
    description:
      'Propose a new product or project from the customer’s point of view, before any work starts.',
    fields: [
      text('name', 'Project name', 'Instant loan approval'),
      text('customer', 'Who is it for', 'Small-business owners'),
      long('problem', 'What problem does it solve for them'),
      long('announcement', 'How would you announce it on launch day'),
      money('cost', 'Estimated cost'),
    ],
    stages: [
      decide('executive', 'CEO decides', 'executive'),
      decide('finance', 'Finance approves the cost', 'finance'),
    ],
    summaryFields: ['name'],
    reasonLabel: 'Why now',
  },
  {
    key: 'decision',
    department: 'Leadership',
    name: 'Decision needed',
    description: 'Ask the CEO for a decision, in writing, and keep the answer on record.',
    fields: [
      text('question', 'What needs deciding', 'Should we support UPI AutoPay this quarter?'),
      long('options', 'The options, and what you recommend'),
      choice('reversible', 'Can it be undone later', ['easily', 'with effort', 'no']),
    ],
    stages: [decide('executive', 'CEO decides', 'executive')],
    summaryFields: ['question'],
    reasonLabel: 'Background',
  },

  // --- People ----------------------------------------------------------------
  {
    key: 'leave',
    department: 'People',
    name: 'Leave',
    description: 'Ask for time off.',
    fields: [
      choice('kind', 'Kind of leave', ['vacation', 'sick', 'personal']),
      date('startDate', 'First day'),
      date('endDate', 'Last day'),
    ],
    stages: [
      decide('manager', 'Manager approves', 'manager'),
      decide('hr', 'HR approves and records it', 'hr'),
    ],
    summaryFields: ['startDate', 'endDate', 'kind'],
    reasonLabel: 'Why',
  },
  {
    key: 'performance_review',
    department: 'People',
    name: 'Performance review',
    description: 'Your self review, your manager’s review, and HR’s final rating.',
    fields: [
      text('period', 'Review period', 'July to September 2026'),
      long('achievements', 'What you achieved'),
      long('improve', 'What you want to get better at'),
    ],
    stages: [
      work('manager', 'Manager writes their review', 'manager', 'Your review of their work'),
      work('hr', 'HR records the rating', 'hr', 'Final rating and next steps'),
      work('acknowledge', 'Employee reads and acknowledges', 'requester'),
    ],
    summaryFields: ['period'],
    reasonLabel: 'Anything else to add',
  },
  {
    key: 'resignation',
    department: 'People',
    name: 'Resignation',
    description: 'Leave the company: notice, handover, access removed, final pay.',
    fields: [date('lastDay', 'Last working day'), long('handover', 'What needs handing over')],
    stages: [
      decide('manager', 'Manager accepts', 'manager'),
      decide('hr', 'HR accepts and starts the exit', 'hr'),
      work('it', 'IT removes access and collects equipment', 'it'),
      work('finance', 'Finance settles the final pay', 'finance'),
    ],
    summaryFields: ['lastDay'],
    reasonLabel: 'Reason for leaving',
  },
  {
    key: 'complaint',
    department: 'People',
    name: 'Concern or complaint',
    description: 'Raise a concern privately with HR. Your manager does not see it.',
    fields: [text('subject', 'What is it about')],
    stages: [work('hr', 'HR looks into it and replies', 'hr', 'What HR found and decided')],
    summaryFields: ['subject'],
    reasonLabel: 'What happened',
  },

  // --- Engineering -----------------------------------------------------------
  {
    key: 'bug',
    department: 'Engineering',
    name: 'Bug report',
    description: 'Report something that is broken. Engineering triages and fixes it.',
    fields: [
      text('title', 'What is broken', 'Login fails with a valid OTP'),
      choice('severity', 'How bad is it', SEVERITY),
      long('steps', 'How to see it happen'),
    ],
    stages: [
      decide('triage', 'Engineering confirms it is a bug', 'engineering'),
      work('fix', 'Engineering fixes it', 'engineering', 'What was changed'),
      work('verify', 'Reporter confirms it is fixed', 'requester'),
    ],
    summaryFields: ['title', 'severity'],
    reasonLabel: 'Who is affected',
  },
  {
    key: 'release',
    department: 'Engineering',
    name: 'Release approval',
    description: 'Ask to release a change to customers.',
    fields: [
      text('version', 'What is being released', 'Mobile app 4.2'),
      long('changes', 'What changed'),
      long('rollback', 'How to undo it if it goes wrong'),
    ],
    stages: [
      decide('manager', 'Manager approves', 'manager'),
      decide('engineering', 'Engineering lead approves', 'engineering'),
      work('ship', 'Released and watched', 'engineering', 'How the release went'),
    ],
    summaryFields: ['version'],
    reasonLabel: 'Why release now',
  },
  {
    key: 'incident',
    department: 'Engineering',
    name: 'Incident',
    description:
      'Something is broken for customers right now. Fix it, then write down why it happened.',
    fields: [
      text('title', 'What is happening', 'Payments are failing'),
      choice('severity', 'How bad is it', SEVERITY),
    ],
    stages: [
      work('fix', 'Engineering restores service', 'engineering', 'What was done to restore it'),
      work(
        'review',
        'Engineering writes the incident review',
        'engineering',
        'Root cause and follow-up actions',
      ),
      decide('executive', 'CEO accepts the review', 'executive'),
    ],
    summaryFields: ['title', 'severity'],
    reasonLabel: 'What customers are seeing',
  },

  // --- Marketing -------------------------------------------------------------
  {
    key: 'campaign',
    department: 'Marketing',
    name: 'Marketing campaign',
    description:
      'Plan a campaign, get the budget and legal sign-off, launch it, record the results.',
    fields: [
      text('name', 'Campaign name', 'Diwali savings offer'),
      text('audience', 'Who it is for', 'Salaried customers aged 25 to 40'),
      text('goal', 'What it should achieve', '2,000 new accounts'),
      money('budget', 'Budget'),
      date('launchDate', 'Launch date'),
    ],
    stages: [
      decide('marketing', 'Marketing head approves the plan', 'marketing'),
      decide('finance', 'Finance approves the budget', 'finance'),
      decide('legal', 'Legal reviews the claims', 'legal'),
      work('launch', 'Marketing launches it', 'marketing', 'What went out, and where'),
      work('results', 'Marketing records the results', 'marketing', 'Results against the goal'),
    ],
    summaryFields: ['name', 'budget'],
    reasonLabel: 'The idea in a few lines',
  },
  {
    key: 'content',
    department: 'Marketing',
    name: 'Content to publish',
    description: 'A blog post, email or social post, reviewed before it goes out.',
    fields: [
      text('title', 'Title', 'Five ways to save on EMIs'),
      choice('channel', 'Where it goes', ['blog', 'email', 'social', 'press']),
      long('draft', 'The draft'),
    ],
    stages: [
      decide('marketing', 'Marketing head reviews', 'marketing'),
      work('publish', 'Published', 'marketing'),
    ],
    summaryFields: ['title', 'channel'],
    reasonLabel: 'Who it is for and why',
  },

  // --- Sales -----------------------------------------------------------------
  {
    key: 'discount',
    department: 'Sales',
    name: 'Discount approval',
    description: 'Ask to offer a customer a discount or special terms.',
    fields: [
      text('customer', 'Customer', 'Sunrise Retail Pvt Ltd'),
      money('dealValue', 'Deal value'),
      number('discountPercent', 'Discount (%)'),
    ],
    stages: [
      decide('sales', 'Sales head approves', 'sales'),
      decide('finance', 'Finance approves', 'finance'),
    ],
    summaryFields: ['customer', 'discountPercent'],
    reasonLabel: 'Why this customer needs it',
  },
  {
    key: 'contract',
    department: 'Sales',
    name: 'Customer contract',
    description: 'Get a contract reviewed by Legal and signed.',
    fields: [
      text('customer', 'Customer', 'Sunrise Retail Pvt Ltd'),
      money('value', 'Contract value'),
      long('terms', 'Anything unusual in the terms', false),
    ],
    stages: [
      decide('sales', 'Sales head approves', 'sales'),
      decide('legal', 'Legal reviews', 'legal'),
      decide('executive', 'CEO signs', 'executive'),
    ],
    summaryFields: ['customer', 'value'],
    reasonLabel: 'About the deal',
  },

  // --- Customer support ------------------------------------------------------
  {
    key: 'ticket',
    department: 'Customer support',
    name: 'Customer problem',
    description: 'A customer reported a problem. Resolve it and tell them.',
    fields: [
      text('customer', 'Customer', 'Rekha Sharma'),
      text('subject', 'The problem', 'Charged twice for one payment'),
      choice('urgency', 'How urgent', ['low', 'normal', 'urgent']),
    ],
    stages: [
      work('resolve', 'Support resolves it', 'support', 'What was done'),
      work('reply', 'Support replies to the customer', 'support', 'The reply sent to the customer'),
    ],
    summaryFields: ['subject', 'customer'],
    reasonLabel: 'What the customer said',
  },
  {
    key: 'escalation',
    department: 'Customer support',
    name: 'Escalation to engineering',
    description:
      'A customer problem support cannot solve: engineering fixes it, support tells the customer.',
    fields: [
      text('customer', 'Customer', 'Rekha Sharma'),
      text('subject', 'The problem', 'Statement download returns an error'),
      choice('severity', 'How bad is it', SEVERITY),
    ],
    stages: [
      decide('support', 'Support lead confirms it needs engineering', 'support'),
      work('fix', 'Engineering fixes it', 'engineering', 'What was changed'),
      work('reply', 'Support tells the customer', 'support', 'The reply sent to the customer'),
    ],
    summaryFields: ['subject', 'severity'],
    reasonLabel: 'What was tried already',
  },
  {
    key: 'refund',
    department: 'Customer support',
    name: 'Refund',
    description: 'Give a customer their money back.',
    fields: [text('customer', 'Customer', 'Rekha Sharma'), money('amount', 'Amount to refund')],
    stages: [
      decide('support', 'Support lead approves', 'support'),
      work('pay', 'Finance pays it', 'finance'),
    ],
    summaryFields: ['customer', 'amount'],
    reasonLabel: 'Why the refund is due',
  },

  // --- Finance ---------------------------------------------------------------
  {
    key: 'purchase',
    department: 'Finance',
    name: 'Purchase',
    description: 'Ask the company to buy something.',
    fields: [
      text('item', 'What should be bought', 'Two Android test phones'),
      money('amountMinorUnits', 'Cost'),
    ],
    stages: [
      decide('manager', 'Manager approves', 'manager'),
      decide('finance', 'Finance approves', 'finance'),
    ],
    summaryFields: ['item', 'amountMinorUnits'],
    reasonLabel: 'Why it is needed',
  },
  {
    key: 'expense_claim',
    department: 'Finance',
    name: 'Expense claim',
    description: 'Get back money you spent for work.',
    fields: [
      text('what', 'What you paid for', 'Client lunch'),
      money('amount', 'Amount'),
      date('spentOn', 'When'),
    ],
    stages: [
      decide('manager', 'Manager approves', 'manager'),
      work('finance', 'Finance reimburses it', 'finance'),
    ],
    summaryFields: ['what', 'amount'],
    reasonLabel: 'What it was for',
  },
  {
    key: 'budget_request',
    department: 'Finance',
    name: 'Budget request',
    description: 'Ask for money for your team for a period.',
    fields: [
      text('purpose', 'What the budget is for', 'Q4 device testing'),
      money('amount', 'Amount'),
      text('period', 'For which period', 'October to December 2026'),
    ],
    stages: [
      decide('finance', 'Finance reviews', 'finance'),
      decide('executive', 'CEO approves', 'executive'),
    ],
    summaryFields: ['purpose', 'amount'],
    reasonLabel: 'What it will achieve',
  },
  {
    key: 'travel',
    department: 'Finance',
    name: 'Travel',
    description: 'Ask to travel for work.',
    fields: [
      text('destination', 'Where to', 'Mumbai'),
      date('from', 'From'),
      date('to', 'To'),
      money('estimate', 'Estimated cost'),
    ],
    stages: [
      decide('manager', 'Manager approves', 'manager'),
      decide('finance', 'Finance approves the cost', 'finance'),
    ],
    summaryFields: ['destination', 'from'],
    reasonLabel: 'Purpose of the trip',
  },

  // --- IT and security -------------------------------------------------------
  {
    key: 'access',
    department: 'IT and security',
    name: 'IT access',
    description: 'Ask for access to a system.',
    fields: [text('what', 'What do you need', 'Read access to the production logs')],
    stages: [decide('manager', 'Manager approves', 'manager'), decide('it', 'IT grants it', 'it')],
    summaryFields: ['what'],
    reasonLabel: 'Why you need it',
  },
  {
    key: 'equipment',
    department: 'IT and security',
    name: 'Equipment',
    description: 'Ask for a laptop, monitor or other equipment.',
    fields: [text('item', 'What you need', 'A second monitor')],
    stages: [
      decide('manager', 'Manager approves', 'manager'),
      work('it', 'IT issues it', 'it'),
      work('received', 'You confirm you received it', 'requester'),
    ],
    summaryFields: ['item'],
    reasonLabel: 'Why you need it',
  },
  {
    key: 'security_incident',
    department: 'IT and security',
    name: 'Security incident',
    description: 'Report something that could put company or customer data at risk.',
    fields: [
      text('title', 'What happened', 'Laptop lost on the metro'),
      choice('severity', 'How bad is it', SEVERITY),
    ],
    stages: [
      work('contain', 'IT contains it', 'it', 'What was done to contain it'),
      decide('executive', 'CEO is informed and accepts the response', 'executive'),
    ],
    summaryFields: ['title', 'severity'],
    reasonLabel: 'Details',
  },

  // --- Legal and admin -------------------------------------------------------
  {
    key: 'legal_review',
    department: 'Legal and admin',
    name: 'Legal review',
    description: 'Ask Legal to review a document before it is signed or published.',
    fields: [
      text('document', 'What should be reviewed', 'Vendor agreement with CloudNine'),
      date('neededBy', 'Needed by', false),
    ],
    stages: [work('legal', 'Legal reviews it', 'legal', 'Legal’s opinion and any changes needed')],
    summaryFields: ['document'],
    reasonLabel: 'What you are worried about',
  },
  {
    key: 'policy',
    department: 'Legal and admin',
    name: 'Company policy',
    description: 'Propose a new company policy or a change to one.',
    fields: [
      text('title', 'Policy', 'Work-from-home policy'),
      long('text', 'What the policy says'),
    ],
    stages: [
      decide('legal', 'Legal reviews', 'legal'),
      decide('hr', 'HR reviews', 'hr'),
      decide('executive', 'CEO approves', 'executive'),
    ],
    summaryFields: ['title'],
    reasonLabel: 'Why it is needed',
  },
];

const BY_KEY = new Map(WORKFLOW_CATALOG.map((definition) => [definition.key, definition]));

/** The definition of a workflow, or `undefined` when there is none by that key. */
export function findWorkflow(key: string): WorkflowDefinition | undefined {
  return BY_KEY.get(key);
}

/** The stage of a workflow by its key. */
export function findWorkflowStage(
  definition: WorkflowDefinition,
  stageKey: string,
): WorkflowStageDefinition | undefined {
  return definition.stages.find((stage) => stage.key === stageKey);
}
