import { describe, expect, it } from "vitest";
import { pickRemote, repoFromUrl } from "./remote";

describe("remotes", () => {
  it("reads owner/repo from HTTPS, SSH and SSH-alias URLs", () => {
    expect(repoFromUrl("https://github.com/Org/Repo.git")).toBe("org/repo");
    expect(repoFromUrl("git@github.com:org/repo.git")).toBe("org/repo");
    expect(repoFromUrl("work:org/repo")).toBe("org/repo");
    expect(repoFromUrl("ssh://git@github.com/org/repo/")).toBe("org/repo");
  });

  it("picks the remote that points at the repository, not origin by default", () => {
    const remotes = [
      "origin\tgit@github.com:me/repo.git (fetch)",
      "origin\tgit@github.com:me/repo.git (push)",
      "upstream\tgit@github.com:org/repo.git (fetch)",
      "upstream\tgit@github.com:org/repo.git (push)",
    ].join("\n");
    expect(pickRemote(remotes, "org/repo")).toBe("upstream");
    expect(pickRemote(remotes, "me/repo")).toBe("origin");
    expect(pickRemote(remotes, "other/repo")).toBeNull();
  });
});
