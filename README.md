# Paseo plugins

Two plugins for [Paseo](https://paseo.sh). Each one adds a panel to the right sidebar of a workspace (Explorer). They work with every agent provider, because they run in the Paseo daemon and app, not in the agent.

| Plugin    | Panel    | Use it for                                                                                                            |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `factory` | PR stack | Your open pull requests: merge order, stacks, CI, review and merge state, and fixes for stale or conflicting branches |
| `lab`     | Cluster  | Your Slurm jobs on a remote cluster: queue with dependencies, progress, finished jobs and logs                        |

## factory: PR stack

- Lists your open PRs (`gh pr list --author @me`) for the workspace's repository.
- Groups them:
  - **Stack.** PRs built on another PR's branch, in merge order, with a rail. Stacks come from the PR base and from git ancestry, so a branch built on another branch is found even when its PR targets `main`.
  - **Wrong base.** The base branch has no open PR. The panel shows a `gh pr edit` command to copy.
  - **Independent.** Sorted so the PRs that need action come first.
- Shows one status line for each PR, most urgent first: conflicts, CI failing (with check names), changes requested, needs update, CI running, review required, ready to merge.
- Tap a PR to see failing and running checks (each opens its run) and the actions:
  - **Update branch** runs `gh pr update-branch`.
  - **Resolve conflicts** creates a worktree on the PR branch and starts a Claude Opus 5.5 agent. The agent merges the base, resolves the conflicts, runs the checks and pushes. It never rebases, force-pushes or merges the PR.
- **Auto-resolve conflicts** is a switch for each project. When it is on, the daemon checks every 5 minutes and starts a resolver for each new conflict:
  - one attempt per head commit
  - at most 2 resolvers per repository at the same time
  - PRs from forks are skipped

## lab: Cluster

- Connects to a Slurm host over SSH (`squeue --me --json`, `sacct`) and refreshes every 30 seconds.
- **Queue.** Running and waiting jobs as dependency trees (`afterok` and other `after*` dependencies).
  - Running jobs show elapsed time against the time limit, a progress bar, and the last log line.
  - Waiting jobs show the reason in plain words, for example `After #1517` or `Over CPU quota`.
- **Finished in the last 24 h.** The result, run time, exit code or signal, and age.
- Tap a job to see the last 60 lines of its log. The log refreshes every 15 seconds.
- Logs of finished jobs are found from the log path of a job the panel saw, or from the optional **Log path pattern** setting. The setting uses the sbatch `--output` syntax, for example `~/logs/%x-%j.log`.

## Requirements

- Paseo 0.9.1 or later.
- `factory`: `gh` must be logged in with access to the repository. `git` must be installed.
- `lab`: the SSH host must be in `~/.ssh/config` and must log in without a password prompt (key-based login).

## Install

```bash
paseo plugin add rk68/paseo-plugins:factory
paseo plugin add rk68/paseo-plugins:lab
```

Installed plugins only run when `"pluginsEnabled": true` is set in `~/.paseo/config.json`. After you change that value, run `paseo reload`. The daemon does not restart.

To get new versions, run `paseo plugin update --all`. Paseo keeps plugin settings across updates and reloads.

Open a panel from the Command Center (Cmd+K): "Open PR stack" or "Open cluster jobs". You can also right-click the tab row of the Explorer sidebar.

**Security.** Plugins run without a sandbox. `factory` runs `gh` and `git` in your repositories and can start agents that push to your PR branches. `lab` runs `ssh` to the host you configure.

## Develop

```bash
git clone git@github.com:rk68/paseo-plugins.git
cd paseo-plugins
npm install && npm run setup
paseo plugin install "$PWD/factory"
paseo plugin install "$PWD/lab"
```

A directory install runs the files in your clone. After you edit a plugin, run `paseo plugin reload factory` (or `lab`). Paseo does not watch plugin files.

Run all checks before you push:

```bash
npm run format
npm run check   # format check, lint, typecheck, tests
```

Each plugin follows the Paseo layout: `index.server.ts` and `server/` run in the daemon, `index.client.tsx` and `client/` run in the app, and `shared/` holds the RPC contracts and pure logic. The plugin reference is in the [Paseo docs](https://paseo.sh/docs/plugins).

## License

MIT
