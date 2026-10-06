import { describe, expect, it } from "vitest";
import { parseRemoteUrl, pickRemote } from "./remote";

const aliases: Record<string, string> = { work: "github.com", "github-personal": "github.com" };
const resolveHost = (url: { host: string; ssh: boolean }) =>
  url.ssh ? (aliases[url.host] ?? url.host) : url.host;
const target = { repo: "org/repo", host: "github.com" };

function remotes(entries: [string, string, string?][]): string {
  return entries
    .flatMap(([name, fetch, push = fetch]) => [
      `${name}\t${fetch} (fetch)`,
      `${name}\t${push} (push)`,
    ])
    .join("\n");
}

describe("parseRemoteUrl", () => {
  it("reads host and owner/repo from HTTPS, ssh:// and scp-like URLs", () => {
    expect(parseRemoteUrl("https://github.com/Org/Repo.git")).toEqual({
      host: "github.com",
      ssh: false,
      repo: "org/repo",
    });
    expect(parseRemoteUrl("git@github.com:org/repo.git")).toEqual({
      host: "github.com",
      ssh: true,
      repo: "org/repo",
    });
    expect(parseRemoteUrl("work:org/repo")).toEqual({ host: "work", ssh: true, repo: "org/repo" });
    expect(parseRemoteUrl("ssh://git@github.com:22/org/repo/")).toEqual({
      host: "github.com",
      ssh: true,
      repo: "org/repo",
    });
  });
});

describe("pickRemote", () => {
  it("picks the remote that points at the repository, not origin by default", () => {
    const verbose = remotes([
      ["origin", "git@github.com:me/repo.git"],
      ["upstream", "git@github.com:org/repo.git"],
    ]);
    expect(pickRemote(verbose, target, resolveHost)).toBe("upstream");
    expect(pickRemote(verbose, { ...target, repo: "other/repo" }, resolveHost)).toBeNull();
  });

  it("follows SSH aliases to their real host", () => {
    expect(
      pickRemote(remotes([["origin", "github-personal:org/repo.git"]]), target, resolveHost),
    ).toBe("origin");
  });

  it("rejects the same owner/repo on another host", () => {
    const verbose = remotes([
      ["origin", "https://gitlab.com/org/repo.git"],
      ["upstream", "https://github.com/org/repo.git"],
    ]);
    expect(pickRemote(verbose, target, resolveHost)).toBe("upstream");
  });

  it("rejects a remote whose push URL points at another repository", () => {
    const verbose = remotes([
      ["review", "https://github.com/org/repo.git", "https://github.com/other/repo.git"],
    ]);
    expect(pickRemote(verbose, target, resolveHost)).toBeNull();
  });
});
