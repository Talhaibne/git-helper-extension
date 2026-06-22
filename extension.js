const vscode = require('vscode');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function activate(context) {
  console.log("✅ Git Helper Activated");

  const provider = new GitHelperViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "gitHelperView",
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("git-helper-ui.ping", () => {
      vscode.window.showInformationMessage("Git Helper is alive");
    })
  );
}

class GitHelperViewProvider {
  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };

    // Read one level of subfolders from each workspace root
    const repos = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const root = folder.uri.fsPath;
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            repos.push({ name: entry.name, path: path.join(root, entry.name) });
          }
        }
      } catch {
        // If reading fails, fall back to the root itself
        repos.push({ name: folder.name, path: root });
      }
    }

    webviewView.webview.html = getHtml(JSON.stringify(repos));

    webviewView.webview.onDidReceiveMessage(async (data) => {
      const cwd = typeof data.repo === "string" ? data.repo : "";

      if (!cwd) {
        webviewView.webview.postMessage({ type: "error", message: "Select a repository first" });
        return;
      }

      try {
        if (data.type === "push") {
          const result = await handlePush(cwd, data);
          webviewView.webview.postMessage({ type: "success", message: result });
        }

        if (data.type === "pull") {
          const result = await handlePull(cwd);
          webviewView.webview.postMessage({ type: "success", message: result });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        webviewView.webview.postMessage({ type: "error", message });
      }
    });
  }
}

async function handlePush(cwd, data) {
  const branch = String(data.branch || "").trim();
  const message = String(data.message || "").trim();

  if (!branch) throw new Error("Enter a branch name before pushing");
  if (!message) throw new Error("Enter a commit message before pushing");

  // Create branch if it doesn't exist, otherwise switch to it
  try {
    // Try to create new branch
    await runGit(cwd, ["branch", branch]);
  } catch {
    // Branch already exists — that's fine, we'll just check it out
  }

  await runGit(cwd, ["checkout", branch]);
  await runGit(cwd, ["add", "."]);

  try {
    await runGit(cwd, ["commit", "-m", message]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "nothing to commit" is not a real error
    if (!msg.includes("nothing to commit")) throw e;
    return `Nothing new to commit on '${branch}'`;
  }

  await runGit(cwd, ["push", "-u", "origin", branch]);
  return `Pushed to '${branch}' successfully`;
}

async function handlePull(cwd) {
  // Always checkout main and pull
  const mainBranch = await resolveMainBranch(cwd);
  await runGit(cwd, ["checkout", mainBranch]);
  await runGit(cwd, ["pull", "origin", mainBranch]);
  return `Pulled latest '${mainBranch}'`;
}

async function resolveMainBranch(cwd) {
  // Try to read the remote HEAD reference first
  try {
    const output = await runGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const ref = output.trim();
    if (ref.startsWith("refs/remotes/origin/")) {
      return ref.replace("refs/remotes/origin/", "");
    }
  } catch {
    // Fall through
  }

  // Fall back to checking for common branch names locally
  for (const branch of ["main", "master"]) {
    try {
      await runGit(cwd, ["rev-parse", "--verify", branch]);
      return branch;
    } catch {
      // Try next
    }
  }

  throw new Error("Could not find 'main' or 'master' branch");
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const details = (stderr || stdout || error.message).trim();
        reject(new Error(details || "Git command failed"));
        return;
      }
      resolve(stdout);
    });
  });
}

function getHtml(reposJson = "[]") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
    }

    h2 {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--vscode-sideBarSectionHeader-foreground, #bbb);
      margin-bottom: 14px;
    }

    label {
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    select, input {
      width: 100%;
      padding: 5px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      font-family: inherit;
      font-size: inherit;
      margin-bottom: 10px;
      outline: none;
    }

    select:focus, input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    button {
      flex: 1;
      padding: 6px 10px;
      border: none;
      border-radius: 3px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    button:hover { opacity: 0.85; }
    button:active { opacity: 0.7; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }

    #btn-push {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    #btn-pull {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }

    #status {
      margin-top: 12px;
      padding: 8px 10px;
      border-radius: 3px;
      font-size: 12px;
      line-height: 1.4;
      display: none;
    }

    #status.success {
      display: block;
      background: var(--vscode-diffEditor-insertedLineBackground, rgba(40,167,69,0.15));
      color: var(--vscode-terminal-ansiGreen, #4caf50);
      border-left: 3px solid currentColor;
    }

    #status.error {
      display: block;
      background: var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.12));
      color: var(--vscode-errorForeground, #f44336);
      border-left: 3px solid currentColor;
    }

    .spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h2>Git Helper</h2>

  <label for="repo">Repository</label>
  <select id="repo"></select>

  <label for="branch">Branch name</label>
  <input id="branch" type="text" placeholder="e.g. feature/my-branch" spellcheck="false" />

  <label for="message">Commit message</label>
  <input id="message" type="text" placeholder="e.g. fix: update styles" />

  <div class="btn-row">
    <button id="btn-push" onclick="push()">↑ Push</button>
    <button id="btn-pull" onclick="pull()">↓ Pull main</button>
  </div>

  <div id="status"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const repos = ${reposJson};
    const select = document.getElementById("repo");
    const statusEl = document.getElementById("status");
    const btnPush = document.getElementById("btn-push");
    const btnPull = document.getElementById("btn-pull");

    // Populate repo dropdown
    if (repos.length === 0) {
      const opt = document.createElement("option");
      opt.text = "No folders open";
      opt.disabled = true;
      select.appendChild(opt);
    } else {
      repos.forEach((repo) => {
        const opt = document.createElement("option");
        opt.value = repo.path;
        opt.text = repo.name;
        select.appendChild(opt);
      });
    }

    function setLoading(loading) {
      btnPush.disabled = loading;
      btnPull.disabled = loading;
    }

    function showStatus(type, message) {
      statusEl.className = type;
      statusEl.innerHTML = message;
    }

    function push() {
      setLoading(true);
      showStatus("success", '<span class="spinner"></span>Pushing...');
      vscode.postMessage({
        type: "push",
        repo: select.value,
        branch: document.getElementById("branch").value,
        message: document.getElementById("message").value
      });
    }

    function pull() {
      setLoading(true);
      showStatus("success", '<span class="spinner"></span>Pulling main...');
      vscode.postMessage({
        type: "pull",
        repo: select.value
      });
    }

    // Listen for responses from the extension host
    window.addEventListener("message", (event) => {
      const data = event.data;
      setLoading(false);
      if (data.type === "success") {
        showStatus("success", "✓ " + data.message);
      } else if (data.type === "error") {
        showStatus("error", "✗ " + data.message);
      }
    });
  </script>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };