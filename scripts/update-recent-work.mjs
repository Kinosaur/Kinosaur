import { readFile, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME || "Kinosaur";
const token = process.env.GITHUB_TOKEN;
const readmeUrl = new URL("../README.md", import.meta.url);
const startMarker = "<!-- recent-work:start -->";
const endMarker = "<!-- recent-work:end -->";
const maxEntries = 3;
const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const profileRepo = (username + "/" + username).toLowerCase();
const profileRefresh = /^(?:Update profile stats cards|Update snake animation|Refresh profile activity)\b/i;

async function* search(path, query, sort) {
  const url = new URL(path, "https://api.github.com");
  url.search = new URLSearchParams({ q: query, sort, order: "desc", per_page: "30" });
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token && { Authorization: "Bearer " + token }),
  };

  // GitHub Search exposes at most 1,000 results for a query.
  for (let page = 1; page <= 34; page += 1) {
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error("GitHub search " + path + " returned HTTP " + response.status);
    }
    const data = await response.json();
    if (data.incomplete_results !== false || !Array.isArray(data.items)) {
      throw new Error("GitHub search " + path + " returned incomplete results");
    }
    yield* data.items;
    if (!response.headers.get("link")?.includes('rel="next"')) break;
  }
}

async function recentIssues(type) {
  const query = "author:" + username + " is:public is:" + type + " created:>=" + since;
  const entries = [];
  for await (const item of search("/search/issues", query, "created")) {
    entries.push({
      type: type === "pr" ? "PR" : "Issue",
      title: item.title,
      repo: new URL(item.repository_url).pathname.slice("/repos/".length),
      url: item.html_url,
      date: item.created_at,
      number: item.number,
    });
    if (entries.length === maxEntries) break;
  }
  return entries;
}

async function recentCommits(pullRequests) {
  const query = "author:" + username + " is:public author-date:>=" + since;
  const entries = [];
  const seenRepos = new Set();
  for await (const item of search("/search/commits", query, "author-date")) {
    const title = item.commit.message.split(/\r?\n/, 1)[0].trim();
    const repo = item.repository.full_name;
    const repoKey = repo.toLowerCase();
    if (!title || item.repository.private || seenRepos.has(repoKey)) continue;
    if (item.author?.type === "Bot" || (repoKey === profileRepo && profileRefresh.test(title))) continue;

    const pullNumber = title.match(/\(#(\d+)\)$/)?.[1];
    if (pullRequests.some((pr) => pr.repo.toLowerCase() === repoKey && pr.number === Number(pullNumber))) {
      continue;
    }

    entries.push({ type: "Commit", title, repo, url: item.html_url, date: item.commit.author.date });
    seenRepos.add(repoKey);
    if (entries.length === maxEntries) break;
  }
  return entries;
}

function renderEntry({ type, title, repo, url }) {
  const characters = Array.from(title.replace(/\s+/g, " ").trim());
  const shortened = characters.length > 100 ? characters.slice(0, 99).join("") + "…" : characters.join("");
  // Keep titles from GitHub inside the Markdown link as plain text.
  const label = shortened.replace(/[!&<>[\]\\`*_~]/g, (char) => `&#${char.charCodeAt(0)};`);
  return `- ${type} · [${label}](<${url}>) · \`${repo}\``;
}

async function main() {
  const readme = await readFile(readmeUrl, "utf8");
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (
    start === -1 ||
    end < start + startMarker.length ||
    start !== readme.lastIndexOf(startMarker) ||
    end !== readme.lastIndexOf(endMarker)
  ) {
    throw new Error("Expected one Recent work block in README.md");
  }

  const [pullRequests, issues] = await Promise.all([recentIssues("pr"), recentIssues("issue")]);
  const commits = await recentCommits(pullRequests);
  const entries = [...pullRequests, ...issues, ...commits]
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, maxEntries);
  const content = entries.length
    ? "\n\n## Recent work\n\n" + entries.map(renderEntry).join("\n") + "\n\n"
    : "\n";
  const updated = readme.slice(0, start + startMarker.length) + content + readme.slice(end);
  if (updated !== readme) await writeFile(readmeUrl, updated);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
