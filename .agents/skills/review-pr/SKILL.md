---
name: review-pr
description: Review and land a pull request. Rebase its branch onto the current target, review and fix it, update the existing PR, and repeat until GitHub CI passes and the PR can merge cleanly. Use for PR reviews, follow-up fixes, and requests to merge when ready.
---

# Review and land a pull request

For a request to review or land a PR, own the workflow through the verified merge. Honor a narrower request, such as findings only or a request to stop before merging.

1. **Identify the PR and its revisions.** Confirm the repository, PR number, head repository and branch, head commit, and target branch. Read the description, review threads, and repository instructions. Fetch both refs. Use an isolated worktree when the current checkout has edits or is needed for other work.
2. **Rebase onto the current target.** Rebase the PR branch onto the freshly fetched target, usually `main`. Resolve conflicts by checking the intent of both sides. Inspect the resulting patch for dropped changes or unintended additions. Record the fetched remote head before rewriting the branch.
3. **Review and fix.** Review the rebased diff against the target, including callers and tests for affected paths. Reproduce actionable findings when practical. Fix regressions and review feedback within the PR's scope, add focused coverage where existing tests miss a regression, and run the repository's applicable local checks. Review the full resulting diff again.
4. **Update the existing PR.** Push to its head branch. Use a normal push for a fast-forward. If the rebase rewrote published commits, use an explicit lease against the fetched head, for example `git push --force-with-lease="refs/heads/${pr_branch}:${fetched_head}" pr-remote HEAD:"refs/heads/${pr_branch}"`, where `pr-remote` is the verified remote for the PR branch. If the lease fails, fetch and inspect the new head, incorporate the concurrent changes, and review again. Update the description when the behavior or verification materially changed.
5. **Follow CI and feedback to completion.** Watch the checks associated with the current PR head and its integration with the target. Read failing job logs and address failures caused by the PR. Retry transient failures when the evidence supports it. Recheck review threads and mergeability after updates. If the head or target advances, fetch, rebase as needed, review the new diff, and wait for checks on the updated revision. Repeat until CI is green and GitHub reports the PR can merge under repository rules.
6. **Merge and verify.** Immediately before merging, confirm the head and target match the reviewed revisions, CI is green for that head, and the open PR is ready to merge. Use the repository's merge method and supply the expected head SHA when the provider supports it. Verify that GitHub marks the PR merged and that the merge commit is on the target. If working on a clean local target checkout, fast-forward it to the remote target.

If repository rules require another person's approval or permissions prevent progress, complete the independent work and report what remains and who can unblock it. In the final update, link the PR and summarize the fixes, checks, and merge commit or current blocker.
