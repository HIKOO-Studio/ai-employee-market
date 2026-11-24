export function currentApprovers(reviews, head) {
  const latest = new Map();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (!review.user?.login || !['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)) continue;
    latest.set(review.user.login.toLowerCase(), review);
  }
  return [...latest.entries()].filter(([, review]) => review.state === 'APPROVED' && review.commit_id === head).map(([login]) => login).sort();
}

export function hasSelfApproval(reviews, head, author) {
  if (!head || !author) return false;
  const login = author.toLowerCase();
  // A draft review may be submitted after a review with a higher id.
  const latestFirst = [...reviews].sort((a, b) =>
    (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '') || b.id - a.id
  );
  for (const review of latestFirst) {
    if (review.user?.login?.toLowerCase() !== login || review.commit_id !== head) continue;
    if (review.state === 'DISMISSED' || review.state === 'CHANGES_REQUESTED') return false;
    if (review.state !== 'COMMENTED') continue;

    // An edited review may count only when the author made its latest edit.
    if (review.lastEditedAt !== null && review.editor?.login?.toLowerCase() !== login) return false;
    const command = review.body?.trim();
    if (command === '/market-approve') return true;
    if (command === '/market-revoke') return false;
  }
  return false;
}

export async function readReviewDecisions(github, repository, number, head, author) {
  const query = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviews(first: 100, after: $after) {
          nodes { id: fullDatabaseId user: author { login } editor { login } lastEditedAt submittedAt state body commit { oid } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`;
  const reviews = [];
  let after = null;
  do {
    const data = await github.graphql(query, { ...repository, number, after });
    const { nodes, pageInfo } = data.repository.pullRequest.reviews;
    for (const review of nodes) reviews.push({ ...review, commit_id: review.commit?.oid });
    if (!pageInfo.hasNextPage) break;
    if (!pageInfo.endCursor || pageInfo.endCursor === after) throw new Error('Incomplete review pagination');
    after = pageInfo.endCursor;
  } while (after);

  return {
    approvers: currentApprovers(reviews, head).join(','),
    selfApproved: hasSelfApproval(reviews, head, author),
  };
}
