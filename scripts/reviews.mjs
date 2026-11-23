export function currentApprovers(reviews, head) {
  const latest = new Map();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (!review.user?.login || !['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)) continue;
    latest.set(review.user.login.toLowerCase(), review);
  }
  return [...latest.entries()].filter(([, review]) => review.state === 'APPROVED' && review.commit_id === head).map(([login]) => login).sort();
}
