import { mkdir, rm, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME || "Kinosaur";
const token = process.env.GITHUB_TOKEN || "";
const outDir = new URL("../assets/stats/", import.meta.url);

const themes = {
  light: {
    title: "#24292f",
    text: "#57606a",
    muted: "#6e7781",
    line: "#d0d7de",
    accent: "#0969da",
    good: "#1a7f37",
    bar: "#d8dee4",
  },
  dark: {
    title: "#e6edf3",
    text: "#8b949e",
    muted: "#7d8590",
    line: "#30363d",
    accent: "#58a6ff",
    good: "#3fb950",
    bar: "#30363d",
  },
};

const languageColors = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  JupyterNotebook: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B",
  HTML: "#e34c26",
  CSS: "#663399",
  Shell: "#89e051",
  SQL: "#336791",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  Go: "#00ADD8",
  Rust: "#dea584",
  Vue: "#41b883",
};

function headers() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Kinosaur-profile-readme",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

async function fetchRepos() {
  const repos = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchJson(
      `https://api.github.com/users/${username}/repos?type=owner&sort=pushed&per_page=100&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((repo) => !repo.fork);
}

async function fetchLanguages(repos) {
  const totals = new Map();

  for (const repo of repos) {
    const languages = await fetchJson(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) || 0) + bytes);
    }
  }

  const rawTotalBytes = [...totals.values()].reduce((sum, bytes) => sum + bytes, 0);
  const notebookBytes = totals.get("Jupyter Notebook") || 0;
  const sourceEntries = [...totals.entries()].filter(([name]) => name !== "Jupyter Notebook");
  const sourceTotalBytes = sourceEntries.reduce((sum, [, bytes]) => sum + bytes, 0);

  return {
    notebookShare: rawTotalBytes ? (notebookBytes / rawTotalBytes) * 100 : 0,
    languages: sourceEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, bytes]) => ({
        name,
        bytes,
        percent: sourceTotalBytes ? (bytes / sourceTotalBytes) * 100 : 0,
        color: languageColors[name] || "#8b949e",
      })),
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shortDate(value) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function svgShell(title, colors, body) {
  return `<svg width="420" height="178" viewBox="0 0 420 178" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(title)}</title>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    .title { font-size: 13px; font-weight: 650; fill: ${colors.title}; }
    .label { font-size: 12px; fill: ${colors.muted}; }
    .value { font-size: 14px; font-weight: 650; fill: ${colors.title}; }
    .small { font-size: 11px; fill: ${colors.text}; }
  </style>
  <rect x="0.5" y="0.5" width="419" height="177" rx="6" stroke="${colors.line}" opacity="0.72"/>
${body}
</svg>
`;
}

function metricRow(label, value, y, colors) {
  return `  <text class="label" x="22" y="${y}">${escapeXml(label)}</text>
  <text class="value" x="398" y="${y}" text-anchor="end">${escapeXml(value)}</text>
  <line x1="22" y1="${y + 13}" x2="398" y2="${y + 13}" stroke="${colors.line}" opacity="0.55"/>`;
}

function renderOverview(stats, colors) {
  const body = `  <text class="title" x="22" y="30">repo signal</text>
  <circle cx="395" cy="25" r="3.5" fill="${colors.good}"/>
${metricRow("public repos", stats.repoCount, 60, colors)}
${metricRow("stars received", stats.stars, 95, colors)}
${metricRow("active this year", stats.activeRepos, 130, colors)}
  <text class="small" x="22" y="162">last push: ${escapeXml(stats.lastPush)}</text>
  <text class="small" x="398" y="162" text-anchor="end">updated: ${escapeXml(stats.updated)}</text>`;
  return svgShell(`${username} repository signal`, colors, body);
}

function renderLanguages(languageData, colors) {
  const rows = languageData.languages
    .map((language, index) => {
      const y = 54 + index * 20;
      const width = Math.max(2, Math.round((language.percent / 100) * 170));
      const name = language.name === "Jupyter Notebook" ? "Jupyter" : language.name;
      return `  <text class="small" x="22" y="${y}">${escapeXml(name)}</text>
  <rect x="170" y="${y - 9}" width="170" height="7" rx="3.5" fill="${colors.bar}"/>
  <rect x="170" y="${y - 9}" width="${width}" height="7" rx="3.5" fill="${language.color}"/>
  <text class="small" x="398" y="${y}" text-anchor="end">${language.percent.toFixed(1)}%</text>`;
    })
    .join("\n");

  const body = `  <text class="title" x="22" y="30">language mix</text>
${rows}
  <text class="small" x="22" y="162">source bytes; notebooks are ${languageData.notebookShare.toFixed(1)}% of raw repo bytes</text>`;
  return svgShell(`${username} top languages`, colors, body);
}

async function main() {
  const repos = await fetchRepos();
  const languageData = await fetchLanguages(repos);
  const now = Date.now();
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const latestRepo = repos.reduce((latest, repo) => {
    if (!latest) return repo;
    return new Date(repo.pushed_at) > new Date(latest.pushed_at) ? repo : latest;
  }, null);

  const stats = {
    repoCount: repos.length,
    stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    activeRepos: repos.filter((repo) => new Date(repo.pushed_at).getTime() >= yearAgo).length,
    lastPush: latestRepo ? shortDate(latestRepo.pushed_at) : "n/a",
    updated: shortDate(new Date()),
  };

  await rm(outDir, { force: true, recursive: true });
  await mkdir(new URL("light/", outDir), { recursive: true });
  await mkdir(new URL("dark/", outDir), { recursive: true });

  await writeFile(new URL("light/github-stats.svg", outDir), renderOverview(stats, themes.light));
  await writeFile(new URL("light/top-languages.svg", outDir), renderLanguages(languageData, themes.light));
  await writeFile(new URL("dark/github-stats.svg", outDir), renderOverview(stats, themes.dark));
  await writeFile(new URL("dark/top-languages.svg", outDir), renderLanguages(languageData, themes.dark));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
