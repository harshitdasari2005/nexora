/**
 * The shared base world of the Nexora enterprise scenario dataset v1.
 *
 * Two tenants:
 * - **Aurora Fintech** — the organization every scenario acts in. Six people
 *   whose business roles are RESOLVED by the platform from membership tier ×
 *   workspace type (never assigned directly): CEO, CFO, a second finance
 *   approver, HR, an engineering manager, and a developer.
 * - **Borealis Logistics** — a separate tenant that exists only so isolation
 *   scenarios have real foreign data to (fail to) reach.
 *
 * Every value here is fictional application data for demonstration and
 * evaluation — not customer data and not model-training data.
 */

import { WorldBuilder } from '../factories.js';
import type { ScenarioWorld } from '../scenario.js';

/** The fixed instant every fixture timestamp derives from. */
export const REFERENCE_TIME = '2026-09-01T09:00:00.000Z';

/** The base world id (also its deterministic-id namespace). */
export const BASE_WORLD_ID = 'nexora-enterprise-v1';

/** Builds the v1 base world. */
export function buildBaseWorld(): ScenarioWorld {
  return (
    new WorldBuilder(BASE_WORLD_ID, REFERENCE_TIME)
      // --- Aurora Fintech ------------------------------------------------------
      .organization('aurora', {
        slug: 'aurora-fintech',
        name: 'Aurora Fintech',
        auditor: { user: 'meera', workspace: 'aurora-exec' },
      })
      .workspace('aurora-exec', {
        organization: 'aurora',
        slug: 'executive-office',
        name: 'Executive Office',
        type: 'executive',
      })
      .workspace('aurora-eng', {
        organization: 'aurora',
        slug: 'engineering',
        name: 'Engineering',
        type: 'engineering',
      })
      .workspace('aurora-fin', {
        organization: 'aurora',
        slug: 'finance',
        name: 'Finance',
        type: 'finance',
      })
      .workspace('aurora-people', {
        organization: 'aurora',
        slug: 'people',
        name: 'People',
        type: 'hr',
      })
      .user('meera', {
        email: 'meera.iyer@aurora-fintech.example',
        displayName: 'Meera Iyer',
        title: 'Chief Executive Officer',
      })
      .user('rahul', {
        email: 'rahul.menon@aurora-fintech.example',
        displayName: 'Rahul Menon',
        title: 'Chief Financial Officer',
      })
      .user('divya', {
        email: 'divya.pillai@aurora-fintech.example',
        displayName: 'Divya Pillai',
        title: 'Finance Controller',
      })
      .user('ananya', {
        email: 'ananya.rao@aurora-fintech.example',
        displayName: 'Ananya Rao',
        title: 'Head of People',
      })
      .user('vikram', {
        email: 'vikram.singh@aurora-fintech.example',
        displayName: 'Vikram Singh',
        title: 'Engineering Manager',
      })
      .user('arjun', {
        email: 'arjun.nair@aurora-fintech.example',
        displayName: 'Arjun Nair',
        title: 'Software Engineer',
      })
      .organizationMember('meera', 'aurora', 'owner')
      .organizationMember('rahul', 'aurora', 'member')
      .organizationMember('divya', 'aurora', 'member')
      .organizationMember('ananya', 'aurora', 'member')
      .organizationMember('vikram', 'aurora', 'member')
      .organizationMember('arjun', 'aurora', 'member')
      // Business roles resolve from tier × workspace type
      // (apps/api/src/business-context/business-role-resolver.ts).
      .workspaceMember('meera', 'aurora-exec', 'owner', 'executive.ceo')
      .workspaceMember('meera', 'aurora-eng', 'owner', 'executive.ceo')
      .workspaceMember('rahul', 'aurora-fin', 'admin', 'finance.cfo')
      .workspaceMember('divya', 'aurora-fin', 'member', 'finance.cfo')
      .workspaceMember('ananya', 'aurora-people', 'admin', 'people.hr')
      .workspaceMember('vikram', 'aurora-eng', 'admin', 'delivery.manager')
      .workspaceMember('arjun', 'aurora-eng', 'member', 'technology.developer')
      .project('mobile-banking', {
        organization: 'aurora',
        name: 'Mobile Banking Platform',
        description: 'Retail mobile banking app rebuild',
        status: 'active',
      })
      .project('atlas', {
        organization: 'aurora',
        name: 'Atlas Data Migration',
        description: 'Core ledger migration to the new data platform',
        status: 'active',
      })
      .project('onboarding-revamp', {
        organization: 'aurora',
        name: 'Customer Onboarding Revamp',
        description: 'Digital KYC onboarding redesign',
        status: 'active',
      })
      .employee('priya', { organization: 'aurora', name: 'Priya Sharma', status: 'active' })
      .employee('karthik', { organization: 'aurora', name: 'Karthik Rao', status: 'active' })
      .employee('neha', { organization: 'aurora', name: 'Neha Kapoor', status: 'active' })
      .article('risk-review', {
        organization: 'aurora',
        workspace: 'aurora-eng',
        author: 'meera',
        title: 'Portfolio risk review Q3',
        // Kept under the retrieval snippet bound (240 chars) so every fact
        // lands in the snippet the response is grounded on.
        body:
          'Mobile Banking Platform is at risk: the vendor integration slipped and the ' +
          '30 June go-live is uncertain. Atlas Data Migration is blocked pending security ' +
          'sign-off. Customer Onboarding Revamp is on track.',
        status: 'published',
        indexed: true,
      })
      .article('expense-policy', {
        organization: 'aurora',
        workspace: 'aurora-fin',
        author: 'rahul',
        title: 'Travel and expense policy',
        body:
          'Any single expense above INR 50,000 requires CFO approval. Receipts must be ' +
          'filed within 15 days of travel. Business-class travel is not reimbursed.',
        status: 'published',
        indexed: true,
      })
      .document('comp-bands', {
        organization: 'aurora',
        workspace: 'aurora-people',
        uploader: 'ananya',
        title: 'Executive compensation bands 2026',
        text:
          'Confidential: executive compensation bands for 2026 range from INR 60 lakh ' +
          'to INR 120 lakh per year.',
      })
      .budget('marketing-q3', {
        organization: 'aurora',
        workspace: 'aurora-fin',
        createdBy: 'rahul',
        name: 'Marketing Q3 Budget',
        allocatedMinorUnits: 10_000_000,
        currency: 'INR',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-09-30T00:00:00.000Z',
        status: 'active',
      })
      .expense('q3-campaign', {
        organization: 'aurora',
        workspace: 'aurora-fin',
        budget: 'marketing-q3',
        submittedBy: 'rahul',
        decidedBy: 'divya',
        description: 'Q3 digital campaign',
        amountMinorUnits: 9_500_000,
        currency: 'INR',
        status: 'approved',
      })
      // --- Borealis Logistics (the foreign tenant) ----------------------------
      .organization('borealis', {
        slug: 'borealis-logistics',
        name: 'Borealis Logistics',
        auditor: { user: 'lena', workspace: 'borealis-hq' },
      })
      .workspace('borealis-hq', {
        organization: 'borealis',
        slug: 'headquarters',
        name: 'Borealis HQ',
        type: 'executive',
      })
      .workspace('borealis-ops', {
        organization: 'borealis',
        slug: 'fleet-operations',
        name: 'Fleet Operations',
        type: 'engineering',
      })
      .user('lena', {
        email: 'lena.fischer@borealis-logistics.example',
        displayName: 'Lena Fischer',
        title: 'Chief Executive Officer',
      })
      .organizationMember('lena', 'borealis', 'owner')
      .workspaceMember('lena', 'borealis-hq', 'owner', 'executive.ceo')
      .workspaceMember('lena', 'borealis-ops', 'owner', 'executive.ceo')
      .project('fleet-telematics', {
        organization: 'borealis',
        name: 'Fleet Telematics Rollout',
        status: 'active',
      })
      .document('acquisition-memo', {
        organization: 'borealis',
        workspace: 'borealis-hq',
        uploader: 'lena',
        title: 'Acquisition memo Nordic Freight',
        text: 'Borealis Logistics plans to acquire Nordic Freight in Q4 for EUR 40 million.',
      })
      .build()
  );
}
