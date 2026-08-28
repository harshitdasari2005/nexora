import { describe, expect, it } from 'vitest';

import {
  humanizeIdentifier,
  humanizeIdentifiersInText,
  humanizeProblemText,
  humanizeProblemTitle,
  humanizeRecommendationSummary,
} from '../src/lib/humanize.js';

describe('humanizeIdentifier', () => {
  it('humanizes a dotted capability id using its last segment', () => {
    expect(humanizeIdentifier('hr.hire_and_assign_employee')).toBe('Hire And Assign Employee');
    expect(humanizeIdentifier('notifications.mark_all_read')).toBe('Mark All Read');
    expect(humanizeIdentifier('projects.find_project')).toBe('Find Project');
  });

  it('humanizes a bare snake_case id with no dot', () => {
    expect(humanizeIdentifier('create_workspace')).toBe('Create Workspace');
  });
});

describe('humanizeIdentifiersInText', () => {
  it('replaces every dotted identifier embedded in free text', () => {
    expect(humanizeIdentifiersInText('hr.hire_and_assign_employee failed 3 time(s).')).toBe(
      'Hire And Assign Employee failed 3 time(s).',
    );
  });

  it('leaves hyphenated (non-dotted) identifiers untouched', () => {
    expect(humanizeIdentifiersInText('employee-onboarding failed 6 times.')).toBe(
      'employee-onboarding failed 6 times.',
    );
  });

  it('leaves plain sentences untouched', () => {
    expect(humanizeIdentifiersInText('20 active project(s) need attention.')).toBe(
      '20 active project(s) need attention.',
    );
  });
});

describe('humanizeProblemTitle', () => {
  it('humanizes the identifier and normalizes the trailing phrase', () => {
    expect(humanizeProblemTitle('hr.hire_and_assign_employee requires attention')).toBe(
      'Hire And Assign Employee needs attention',
    );
  });

  it('passes through a title with no embedded identifier', () => {
    expect(humanizeProblemTitle('20 active project(s) need attention')).toBe(
      '20 active project(s) need attention',
    );
  });
});

describe('humanizeProblemText', () => {
  it('humanizes an identifier inside the detection engine failure sentence', () => {
    expect(
      humanizeProblemText(
        'hr.hire_and_assign_employee failed 3 time(s) (75% unrecoverable error rate).',
      ),
    ).toBe('Hire And Assign Employee failed 3 time(s) (75% unrecoverable error rate).');
  });
});

describe('humanizeRecommendationSummary', () => {
  it('drops the raw reference id, keeps the quoted human label', () => {
    expect(
      humanizeRecommendationSummary(
        'Known solution found: knowledge article art_dddee544-74bd-411d-bb47-0a2f9d18417f ' +
          '("Project attention playbook"). Applicability assessed — this existing remediation concerns the affected entity.',
      ),
    ).toBe(
      'Known solution found: "Project attention playbook". Applicability assessed — this existing remediation concerns the affected entity.',
    );
  });

  it('drops the raw reference id with no trailing sentence', () => {
    expect(
      humanizeRecommendationSummary(
        'Known solution found: knowledge article art_1 ("AUTH-017 Authentication correction").',
      ),
    ).toBe('Known solution found: "AUTH-017 Authentication correction".');
  });

  it('passes through the honest "no known solution" copy unchanged', () => {
    const text = 'No known solution found. Review the evidence and the root-cause candidates.';
    expect(humanizeRecommendationSummary(text)).toBe(text);
  });
});
