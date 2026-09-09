# Formcraft — Heroku deployment snapshot

This folder is a standalone deployment copy of the vanilla ALS dashboard. No Git repository has been initialized and nothing has been published.

## Before publishing: study metadata is public

`public/study-data.js` contains the current embedded study metadata, including form labels, fields, dictionaries and defaults. `public/rules-data.js` and `public/rules.yaml` contain the bundled rules. Anyone who can access the deployed app can download these files. Only deploy data approved for that audience. A private GitHub repository does not add authentication to the deployed website. This package has no login/access control.

ALS and YAML uploads are processed in the visitor's browser, not stored by this server. There is no database or server-side saving of entered answers. Do not use this as a production clinical-data collection system without a separate security and persistence design.

## What to upload to GitHub

Upload the CONTENTS of this folder to the root of your new repository, preserving the public subfolders. Do not put the outer heroku-deployment folder inside the repository: package.json must be at the repository root.

```text
package.json          Node 24 runtime and npm start
package-lock.json     npm lockfile
Procfile              Heroku web process
server.cjs            Dependency-free static HTTP server
server.test.cjs       Optional automated server checks
README.md             These instructions
public/
  index.html
  styles.css
  app.js
  uploader.js
  study-data.js
  rules-data.js
  rules.yaml
  assets/fonts/       Poppins font files and license
  vendor/             SheetJS browser parser and license
```

Excel workbooks, source extraction tools, skills, QA notes, standalone YAML experiments, redundant study-data.json, and theme-lab.html are deliberately excluded. The runtime uses study-data.js; the sample download uses rules.yaml. Uploaded rules currently held only in a browser session are not included automatically.

## Local check

With Node.js 24 installed, open a terminal in this folder:

```sh
npm ci
npm test
npm start
```

Open http://localhost:3000. No third-party server dependencies or frontend build are required.

## Manual GitHub → Heroku deployment

1. Create your GitHub repository (private is preferable for unpublished study material). Use GitHub's Add file / Upload files to upload this folder's contents and commit through the website.
2. Create a Heroku app. In its Deploy section select GitHub, authorize the connection, then find and connect the repository.
3. Select the uploaded branch and use Deploy Branch under manual deployment. Heroku detects Node from the root package.json. If a buildpack must be selected, use Heroku Node.js.
4. Ensure the web process has a running dyno under Resources. Select the plan appropriate to your account; hosting may incur charges.
5. Open the app and check ALS upload, YAML rules, PR_RT portrait expansion, PK3 fixed rows, themes, and print preview.

The server binds to 0.0.0.0 and uses Heroku's PORT environment variable. Do not hardcode a Heroku port. No database/add-on is needed for the current browser-only behavior.

This is a snapshot, not a live link to the parent folder. For future releases, refresh the matching runtime files under public (and their assets/licenses) before manually uploading the changed files. Keep source development and deployment packaging separate.

Official references: [Node deployment](https://devcenter.heroku.com/articles/deploying-nodejs), [Node runtime support](https://devcenter.heroku.com/articles/nodejs-support), [GitHub integration](https://devcenter.heroku.com/articles/github-integration).
