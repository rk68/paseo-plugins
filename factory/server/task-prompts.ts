import type { TaskKind } from "../shared/actions";

export interface TaskTarget {
  repo: string;
  number: number;
  title: string;
  url: string;
  head: string;
  headOid: string;
  base: string;
  /** The git remote that points at `repo`; not always `origin`. */
  remote: string;
  failingChecks: { name: string; url: string | null }[];
}

/** Quotes a shell word: branch names may hold characters such as `;` that git accepts. */
export function shellWord(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function remoteRef(target: TaskTarget, branch: string): string {
  return shellWord(`${target.remote}/${branch}`);
}

const TASK_TITLE: Record<TaskKind, string> = {
  conflicts: "Resolve conflicts",
  ci: "Fix CI",
  comments: "Address comments",
};

export function taskTitle(kind: TaskKind, number: number): string {
  return `[Factory] ${TASK_TITLE[kind]} in #${number}`;
}

function context(target: TaskTarget, problem: string): string {
  return `## Context
- Repository: ${target.repo}. Pull request: ${target.url} ("${target.title}").
- ${problem}
- This worktree was created for this task from \`${target.head}\`. Its local branch name can be different from \`${target.head}\`.`;
}

function syncSteps(target: TaskTarget): string {
  return `1. Run \`git fetch ${shellWord(target.remote)}\`.
2. Bring the local branch to the remote branch: \`git merge --ff-only ${remoteRef(target, target.head)}\`. If this fails, stop and report that the local and remote branches diverged.`;
}

function finishSteps(target: TaskTarget, first: number, message: string): string {
  return `${first}. Run the fast checks that apply to the changed files, as the repository documents them (format, lint, tests).
${first + 1}. Commit ${message}.
${first + 2}. Push: \`git push ${shellWord(target.remote)} ${shellWord(`HEAD:refs/heads/${target.head}`)}\`.`;
}

const CONSTRAINTS = `## Constraints
- Do not rebase. Do not force-push. Do not change the base of the PR. Do not merge the PR.
- If a change needs a product decision, stop and explain the options. Do not guess.`;

function conflictsPrompt(target: TaskTarget): string {
  return `## Task
Resolve the merge conflicts in pull request #${target.number} so that it can merge into \`${target.base}\`.

${context(target, `GitHub reports that \`${target.head}\` conflicts with \`${target.base}\`.`)}

## Steps
${syncSteps(target)}
3. Merge the base branch: \`git merge ${remoteRef(target, target.base)}\`.
4. Resolve every conflict. Keep the intent of both sides. Read the PR (\`gh pr view ${target.number} --repo ${target.repo}\`) and the commits on both sides before you choose a resolution.
${finishSteps(target, 5, "the merge with the default merge message")}
8. Report each conflicting file and how you resolved it.

${CONSTRAINTS}`;
}

function ciPrompt(target: TaskTarget): string {
  const checks = target.failingChecks.length
    ? target.failingChecks.map((c) => `- ${c.name}${c.url ? `: ${c.url}` : ""}`).join("\n")
    : "- Run `gh pr checks` to list them.";
  return `## Task
Make the failing CI checks pass on pull request #${target.number}.

${context(target, "These checks fail on the current head commit:")}
${checks}

## Steps
${syncSteps(target)}
3. Read the failure output. For GitHub Actions, run \`gh pr checks ${target.number} --repo ${target.repo}\`, then \`gh run view <run-id> --repo ${target.repo} --log-failed\`. For other checks, open the details URL.
4. Find the root cause and fix the code. If the failure does not come from the code in this PR (a flaky test, an infrastructure fault, or a check that needs PR metadata such as a ticket link), do not change code. Report the cause instead.
5. Run the failing check locally if the repository supports it.
${finishSteps(target, 6, "with a Conventional Commits message, for example `fix(ci): ...`")}
9. Report each failing check, its cause and your fix.

${CONSTRAINTS}
- Do not skip, disable or weaken a test or a check to make it pass.`;
}

function commentsPrompt(target: TaskTarget): string {
  const [owner, name] = target.repo.split("/");
  return `## Task
Address the unresolved review comments on pull request #${target.number}.

${context(target, "The PR has unresolved review threads, or a reviewer requested changes.")}

## Steps
${syncSteps(target)}
3. List the unresolved threads with their IDs:
   \`gh api graphql -f query='{ repository(owner:"${owner}", name:"${name}") { pullRequest(number:${target.number}) { reviewThreads(first:100) { nodes { id isResolved isOutdated path line comments(first:20) { nodes { author { login } body } } } } } } }'\`
   Also read \`gh pr view ${target.number} --repo ${target.repo} --comments\` for review summaries.
4. For each unresolved thread, decide if the comment is correct.
   - If it is correct, change the code.
   - If it is not correct, do not change the code. Reply with the reason: \`gh api graphql -f query='mutation($id:ID!,$body:String!){ addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id, body:$body}) { comment { id } } }' -f id=<thread-id> -f body='<reason>'\`.
${finishSteps(target, 5, "with a Conventional Commits message")}
8. Resolve each thread that you fixed or answered: \`gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}) { thread { id } } }' -f id=<thread-id>\`.
9. Report each thread and what you did.

${CONSTRAINTS}`;
}

const PROMPTS: Record<TaskKind, (target: TaskTarget) => string> = {
  conflicts: conflictsPrompt,
  ci: ciPrompt,
  comments: commentsPrompt,
};

/** A briefing the agent can act on with zero context, as the paseo-handoff skill requires. */
export function taskPrompt(kind: TaskKind, target: TaskTarget, extra: string): string {
  const prompt = PROMPTS[kind](target);
  return extra.trim()
    ? `${prompt}\n\n## Extra instructions from the user\n${extra.trim()}`
    : prompt;
}
