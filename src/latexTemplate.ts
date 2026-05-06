import * as path from "node:path";
import * as vscode from "vscode";

export interface TemplateCopyResult {
  copied: string[];
  skipped: string[];
  targetDirectory: string;
}

export interface TemplateBoxSnippet {
  description: string;
  label: string;
  snippet: vscode.SnippetString;
}

const templateFileNames = [
  "main.tex",
  "notes-style.tex"
];

const templateBoxSnippets: TemplateBoxSnippet[] = [
  {
    label: "definitionbox",
    description: "Insert a titled definition box.",
    snippet: new vscode.SnippetString([
      "\\begin{definitionbox}{${1:Title}}",
      "${0:Definition content.}",
      "\\end{definitionbox}"
    ].join("\n"))
  },
  {
    label: "principlebox",
    description: "Insert a highlighted principle box.",
    snippet: new vscode.SnippetString([
      "\\begin{principlebox}{${1:Title}}",
      "${0:Principle content.}",
      "\\end{principlebox}"
    ].join("\n"))
  },
  {
    label: "examplebox",
    description: "Insert a titled example box.",
    snippet: new vscode.SnippetString([
      "\\begin{examplebox}{${1:Title}}",
      "${0:Example content.}",
      "\\end{examplebox}"
    ].join("\n"))
  },
  {
    label: "notebox",
    description: "Insert a titled note box.",
    snippet: new vscode.SnippetString([
      "\\begin{notebox}{${1:Title}}",
      "${0:Note content.}",
      "\\end{notebox}"
    ].join("\n"))
  }
];

export async function copyLatexTemplateFiles(
  extensionUri: vscode.Uri,
  targetDirectory: vscode.Uri,
  overwrite: boolean
): Promise<TemplateCopyResult> {
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const fileName of templateFileNames) {
    const source = vscode.Uri.joinPath(extensionUri, "latextemplate", fileName);
    const target = vscode.Uri.joinPath(targetDirectory, fileName);

    if (!overwrite && await exists(target)) {
      skipped.push(fileName);
      continue;
    }

    await vscode.workspace.fs.copy(source, target, { overwrite });
    copied.push(fileName);
  }

  return {
    copied,
    skipped,
    targetDirectory: targetDirectory.fsPath
  };
}

export async function resolveProjectDirectory(): Promise<vscode.Uri | undefined> {
  const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;

  if (activeDocumentUri?.scheme === "file") {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);

    if (workspaceFolder) {
      return workspaceFolder.uri;
    }
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri;
  }

  if (workspaceFolders.length > 1) {
    const selected = await vscode.window.showQuickPick(
      workspaceFolders.map((folder) => ({
        description: folder.uri.fsPath,
        label: folder.name,
        uri: folder.uri
      })),
      {
        placeHolder: "Select the project folder where the LaTeX template files should be copied"
      }
    );

    return selected?.uri;
  }

  if (activeDocumentUri?.scheme === "file") {
    return vscode.Uri.file(path.dirname(activeDocumentUri.fsPath));
  }

  return undefined;
}

export async function selectTemplateBoxSnippet(): Promise<TemplateBoxSnippet | undefined> {
  return vscode.window.showQuickPick(templateBoxSnippets, {
    placeHolder: "Select a LaTeX template snippet to insert"
  });
}

export function listTemplateFileNames(): string[] {
  return [...templateFileNames];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return false;
    }

    throw error;
  }
}
