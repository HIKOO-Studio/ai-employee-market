import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSelfApproval, readReviewDecisions } from './reviews.mjs';

const command = {
  id: 1, user: { login: 'Admin' }, state: 'COMMENTED', body: '/market-approve',
  commit_id: 'head', lastEditedAt: null, editor: null,
};

test('only an explicit review by the PR author on the current commit confirms it', () => {
  assert.equal(hasSelfApproval([command], 'head', 'ADMIN'), true);
  assert.equal(hasSelfApproval([command], 'head', 'other'), false);
  assert.equal(hasSelfApproval([command], 'new-head', 'admin'), false);
  assert.equal(hasSelfApproval([command], '', 'admin'), false);
  assert.equal(hasSelfApproval([command], 'head', ''), false);
  for (const review of [
    { state: 'PENDING' }, { state: 'APPROVED' }, { state: 'DISMISSED' },
    { body: 'example: /market-approve' }, { body: '> /market-approve' },
    { body: '/market-approve\nother' }, { body: '/MARKET-APPROVE' },
    { commit_id: null }, { user: null }, { lastEditedAt: undefined },
  ]) {
    assert.equal(hasSelfApproval([{ ...command, ...review }], 'head', 'admin'), false);
  }
});

test('decisions handle subsequent revoke, renewed confirmation, edits and dismissal', () => {
  const revoke = { ...command, id: 2, body: '/market-revoke' };
  const confirm = { ...command, id: 3 };
  const note = { ...command, id: 4, body: 'another review note' };
  assert.equal(hasSelfApproval([revoke, command], 'head', 'admin'), false);
  assert.equal(hasSelfApproval([confirm, revoke, note, command], 'head', 'admin'), true);
  assert.equal(hasSelfApproval([command, { ...confirm, state: 'DISMISSED' }], 'head', 'admin'), false);

  const lateDraft = { ...command, submittedAt: '2026-11-23T09:00:00Z' };
  const earlierRevoke = { ...revoke, submittedAt: '2026-11-23T08:00:00Z' };
  assert.equal(hasSelfApproval([lateDraft, earlierRevoke], 'head', 'admin'), true);

  const edited = { ...command, lastEditedAt: '2026-11-23T08:00:00Z' };
  assert.equal(hasSelfApproval([{ ...edited, editor: { login: 'aDmIn' } }], 'head', 'admin'), true);
  assert.equal(hasSelfApproval([{ ...edited, editor: { login: 'other' } }], 'head', 'admin'), false);
  assert.equal(hasSelfApproval([edited], 'head', 'admin'), false);
  assert.equal(hasSelfApproval([{ ...edited, body: 'removed', editor: { login: 'admin' } }], 'head', 'admin'), false);
});

test('trusted review reader uses every page and separates native approvals from self confirmation', async () => {
  const cursors = [];
  const independent = { ...command, id: 2, user: { login: 'Peer' }, state: 'APPROVED' };
  const github = {
    async graphql(query, vars) {
      cursors.push(vars.after);
      const review = vars.after ? independent : command;
      return { repository: { pullRequest: { reviews: {
        nodes: [{ ...review, commit: { oid: 'head' } }],
        pageInfo: { hasNextPage: !vars.after, endCursor: 'next' },
      } } } };
    },
  };
  const result = await readReviewDecisions(github, { owner: 'studio', repo: 'market' }, 1, 'head', 'admin');
  assert.deepEqual(cursors, [null, 'next']);
  assert.deepEqual(result, { approvers: 'peer', selfApproved: true });
});
