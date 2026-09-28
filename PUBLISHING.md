# Putting the ocean report online (GitHub Pages, refreshed automatically)

Result: a link Vicky can open on any phone or computer. A free GitHub job rebuilds the report about every 30
minutes. Nothing runs on your computer once this is set up.

You need: a GitHub account and the GitHub Desktop app (both already set up on the iMac).

## One-time setup

**1. Put the folder somewhere permanent.** Unzip `kauai-ocean-report` into Documents (not Downloads).

**2. Make it a repository.** In GitHub Desktop: File > Add Local Repository, choose the `kauai-ocean-report` folder.
It will say the folder is not a Git repository; click "create a repository", leave the defaults (Git Ignore: None,
License: None, since the folder already has a `.gitignore`), and click Create Repository.

**3. Commit.** In the Changes list, type a summary such as "First version" and click "Commit to main".

**4. Publish to GitHub.** Click "Publish repository". **Uncheck "Keep this code private"** (free GitHub Pages
requires a public repository; the code and test files contain nothing secret). Click Publish Repository.

**5. Add your contact email as a secret.** On github.com, open the repository, then
Settings > Secrets and variables > Actions > New repository secret.
- Name: `NWS_USER_AGENT`
- Secret: `KauaiBeachGuide (your-real-email@example.com)`

NWS asks users of its data service to identify themselves. Because the repository is public, a secret keeps your
email out of public view.

**6. Turn on Pages.** Settings > Pages > Build and deployment > Source: choose **GitHub Actions**.

**7. Run it the first time.** Open the Actions tab, click "Publish ocean report" in the left list, then
"Run workflow" (green button) > Run workflow. It takes about a minute. (The first automatic run, started when you
published, probably failed because Pages was not on yet; that is expected.)

**8. Get the link.** When the run shows a green check, the address is
`https://YOUR-GITHUB-USERNAME.github.io/kauai-ocean-report/` (also shown under Settings > Pages).
Send that link to Vicky.

## What happens after that
- The job runs about every 30 minutes and republishes the report. You can also press "Run workflow" any time.
- If NWS cannot be reached, the site keeps showing the last good report, clearly marked. If nothing at all could
  be refreshed, GitHub emails you about the failed run.
- The page shows when the report was built and turns to a red warning if the file is more than 2 hours old,
  so a stopped refresh is never silent.
- The page has a **Copy summary** button. Vicky can tap it, paste the text into a message, and add what she
  actually sees at the beach. That is the fastest way to compare the report with reality.
- As far as I know, GitHub pauses scheduled jobs in a repository with no activity for 60 days. If that happens,
  open the Actions tab and click "Enable workflow".
- The page carries a "noindex" tag so search engines are asked to skip it. It is unlisted, not secret: anyone
  with the link can open it.

## Later: use kauaibeachguide.com
In the repository, Settings > Pages > Custom domain. GitHub shows the DNS records Vicky's domain registrar needs.
Then add a repository variable named `PAGES_URL` (Settings > Secrets and variables > Actions > Variables)
set to the new address, so the refresh job can find the last published report. The repository can also be moved to
an account in Vicky's name (Settings > General > Transfer) once everything works.

## Optional: a second copy on keysow.com
Copy `index.html` from the published site to a hidden folder on keysow.com (cPanel File Manager), and edit the
`<body>` tag so `data-json-url` holds the full address of the JSON, for example
`data-json-url="https://YOUR-GITHUB-USERNAME.github.io/kauai-ocean-report/ocean-report.json"`.
This depends on GitHub Pages allowing another website to read that file. I believe it does, but test it before
relying on it. If it fails, the GitHub link on its own is fine.

## If something goes wrong
- Actions tab shows a red X: click the run, click the failed step, and read the message. The first step tells you
  if the `NWS_USER_AGENT` secret is missing.
- The action versions in `.github/workflows/publish.yml` (checkout@v4, deploy-pages@v4, etc.) were current when
  written. If GitHub warns that one is outdated, bump the number.
