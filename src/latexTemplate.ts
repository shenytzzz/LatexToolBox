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
  "notes-style.tex",
  "chapters/chapter1.tex",
  "chapters/chapter2.tex",
  "chapters/chapter3.tex"
];
const templateStyleFileName = "notes-style.tex";

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
    label: "theorembox",
    description: "Insert a titled theorem box.",
    snippet: new vscode.SnippetString([
      "\\begin{theorembox}{${1:Title}}",
      "${0:Theorem content.}",
      "\\end{theorembox}"
    ].join("\n"))
  },
  {
    label: "propositionbox",
    description: "Insert a titled proposition box.",
    snippet: new vscode.SnippetString([
      "\\begin{propositionbox}{${1:Title}}",
      "${0:Proposition content.}",
      "\\end{propositionbox}"
    ].join("\n"))
  },
  {
    label: "proofbox",
    description: "Insert a proof box.",
    snippet: new vscode.SnippetString([
      "\\begin{proofbox}{${1:Proof}}",
      "${0:Proof content.}",
      "\\end{proofbox}"
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
  return copyLatexTemplateNamedFiles(extensionUri, targetDirectory, templateFileNames, overwrite);
}

export async function copyLatexTemplateStyleFile(
  extensionUri: vscode.Uri,
  targetDirectory: vscode.Uri,
  overwrite: boolean
): Promise<TemplateCopyResult> {
  return copyLatexTemplateNamedFiles(extensionUri, targetDirectory, [templateStyleFileName], overwrite);
}

async function copyLatexTemplateNamedFiles(
  extensionUri: vscode.Uri,
  targetDirectory: vscode.Uri,
  fileNames: string[],
  overwrite: boolean
): Promise<TemplateCopyResult> {
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const fileName of fileNames) {
    const source = resolveTemplatePath(extensionUri, ["latextemplate", fileName]);
    const target = resolveTemplatePath(targetDirectory, [fileName]);

    if (!overwrite && await exists(target)) {
      skipped.push(fileName);
      continue;
    }

    await ensureDirectory(vscode.Uri.joinPath(target, ".."));
    await vscode.workspace.fs.copy(source, target, { overwrite });
    copied.push(fileName);
  }

  return {
    copied,
    skipped,
    targetDirectory: targetDirectory.fsPath
  };
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(uri);
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

function resolveTemplatePath(baseUri: vscode.Uri, paths: string[]): vscode.Uri {
  return vscode.Uri.joinPath(baseUri, ...paths.flatMap((templatePath) => templatePath.split("/")));
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
