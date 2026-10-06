import { gh } from "./gh";

const QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes { ... on PullRequest { number reviewThreads(first: 100) { nodes { isResolved isOutdated } } } }
  }
}`;

interface SearchResult {
  data: {
    search: {
      nodes: {
        number?: number;
        reviewThreads?: { nodes: { isResolved: boolean; isOutdated: boolean }[] };
      }[];
    };
  };
}

/** Unresolved, current review threads on your open PRs, by PR number. */
export async function unresolvedThreads(
  directory: string,
  repo: string,
): Promise<Map<number, number>> {
  const output = await gh(directory, [
    "api",
    "graphql",
    "-f",
    `q=repo:${repo} is:pr is:open author:@me`,
    "-f",
    `query=${QUERY}`,
  ]);
  const { data } = JSON.parse(output) as SearchResult;
  const counts = new Map<number, number>();
  for (const node of data.search.nodes) {
    if (node.number === undefined) continue;
    const open = (node.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved && !t.isOutdated);
    counts.set(node.number, open.length);
  }
  return counts;
}
