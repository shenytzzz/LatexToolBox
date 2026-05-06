import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readClipboardImageAsPng } from "./clipboardImage";
import { makeTimestampedPngName, toLatexRelativePath } from "./fileNames";
import {
  copyLatexTemplateFiles,
  listTemplateFileNames,
  resolveProjectDirectory,
  selectTemplateBoxSnippet
} from "./latexTemplate";
import {
  findMathSymbolReplacement,
  isInLatexMath,
  normalizeMathSymbolReplacements,
  type MathSymbolReplacements
} from "./mathSymbols";
import { renderLatexTemplate } from "./template";
import {
  transformSelectionToWrapFigure,
  type WrapFigureConfiguration
} from "./wrapFigure";

interface ImageSnippetConfiguration {
  template: string;
  width: string;
}

interface ClipboardImageConfiguration extends ImageSnippetConfiguration {
  directory: string;
}

interface MathSymbolConfiguration {
  enabled: boolean;
  replacements: MathSymbolReplacements;
}

let applyingMathSymbolReplacement = false;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "latex-toolbox.insertClipboardImage",
      insertClipboardImage
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.insertImageFromFile",
      insertImageFromFile
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.insertTemplateFiles",
      () => insertTemplateFiles(context)
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.insertTemplateBoxSnippet",
      insertTemplateBoxSnippet
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.registerMathSymbolReplacement",
      registerMathSymbolReplacement
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.wrapSelectionWithWrapFigure",
      wrapSelectionWithWrapFigure
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void handleMathSymbolReplacement(event);
    })
  );
}

export function deactivate(): void {
  // VS Code disposes command registrations from the extension context.
}

async function insertClipboardImage(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a saved LaTeX file before inserting a clipboard image.");
    return;
  }

  const document = editor.document;

  if (document.isUntitled || document.uri.scheme !== "file") {
    vscode.window.showErrorMessage("LatexToolBox: save the current LaTeX file before inserting a clipboard image.");
    return;
  }

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Insert the image snippet anyway?",
      { modal: true },
      "Insert Anyway"
    );

    if (choice !== "Insert Anyway") {
      return;
    }
  }

  const configuration = getClipboardImageConfiguration();
  const texDirectory = path.dirname(document.uri.fsPath);
  const imageDirectory = path.resolve(texDirectory, configuration.directory);

  try {
    const image = await readClipboardImageAsPng();
    const imagePath = await writeClipboardImage(imageDirectory, image);
    const snippet = buildSnippet(configuration, texDirectory, imagePath);

    await editor.insertSnippet(new vscode.SnippetString(snippet));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`LatexToolBox: ${message}`);
  }
}

async function insertImageFromFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a saved LaTeX file before inserting an image.");
    return;
  }

  const document = editor.document;

  if (document.isUntitled || document.uri.scheme !== "file") {
    vscode.window.showErrorMessage("LatexToolBox: save the current LaTeX file before inserting an image.");
    return;
  }

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Insert the image snippet anyway?",
      { modal: true },
      "Insert Anyway"
    );

    if (choice !== "Insert Anyway") {
      return;
    }
  }

  const texDirectory = path.dirname(document.uri.fsPath);
  const selectedImage = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(texDirectory),
    filters: {
      Images: [
        "png",
        "jpg",
        "jpeg",
        "pdf",
        "eps",
        "svg",
        "bmp",
        "gif",
        "tif",
        "tiff",
        "webp"
      ],
      "All Files": [
        "*"
      ]
    },
    openLabel: "Insert Image"
  });

  if (!selectedImage || selectedImage.length === 0) {
    return;
  }

  const imageUri = selectedImage[0];

  if (imageUri.scheme !== "file") {
    vscode.window.showErrorMessage("LatexToolBox: selected image must be a local file.");
    return;
  }

  const configuration = getInsertImageConfiguration();
  const snippet = buildSnippet(configuration, texDirectory, imageUri.fsPath);

  await editor.insertSnippet(new vscode.SnippetString(snippet));
}

async function insertTemplateFiles(context: vscode.ExtensionContext): Promise<void> {
  const targetDirectory = await resolveProjectDirectory();

  if (!targetDirectory) {
    vscode.window.showErrorMessage("LatexToolBox: open a project folder or saved file before inserting the LaTeX template.");
    return;
  }

  const existingFiles = await findExistingTemplateFiles(targetDirectory);
  let overwrite = false;

  if (existingFiles.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `LatexToolBox: ${existingFiles.join(", ")} already exist in ${targetDirectory.fsPath}.`,
      { modal: true },
      "Overwrite",
      "Skip Existing"
    );

    if (!choice) {
      return;
    }

    overwrite = choice === "Overwrite";
  }

  try {
    const result = await copyLatexTemplateFiles(context.extensionUri, targetDirectory, overwrite);
    const copied = result.copied.length > 0
      ? `copied ${result.copied.join(", ")}`
      : "copied no files";
    const skipped = result.skipped.length > 0
      ? `; skipped ${result.skipped.join(", ")}`
      : "";

    vscode.window.showInformationMessage(`LatexToolBox: ${copied}${skipped} to ${result.targetDirectory}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`LatexToolBox: failed to insert template files. ${message}`);
  }
}

async function insertTemplateBoxSnippet(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a LaTeX file before inserting a template snippet.");
    return;
  }

  const document = editor.document;

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Insert the snippet anyway?",
      { modal: true },
      "Insert Anyway"
    );

    if (choice !== "Insert Anyway") {
      return;
    }
  }

  const snippet = await selectTemplateBoxSnippet();

  if (!snippet) {
    return;
  }

  await editor.insertSnippet(snippet.snippet);
}

async function registerMathSymbolReplacement(): Promise<void> {
  const trigger = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "=>",
    prompt: "Text to replace while typing inside LaTeX math mode",
    validateInput: (value) => value.length > 0 ? undefined : "Trigger text cannot be empty."
  });

  if (!trigger) {
    return;
  }

  const replacement = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "\\Rightarrow",
    prompt: `LaTeX replacement for ${trigger}`,
    validateInput: (value) => value.length > 0 ? undefined : "Replacement text cannot be empty."
  });

  if (!replacement) {
    return;
  }

  const targets = [
    ...(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? [{
        label: "Workspace",
        target: vscode.ConfigurationTarget.Workspace
      }]
      : []),
    {
      label: "User",
      target: vscode.ConfigurationTarget.Global
    }
  ];
  const selectedTarget = await vscode.window.showQuickPick(targets, {
    placeHolder: "Where should this math symbol replacement be registered?"
  });

  if (!selectedTarget) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration("latexToolBox.mathSymbols");
  const current = normalizeMathSymbolReplacements(configuration.get("replacements", defaultMathSymbolReplacements()));
  const next = {
    ...current,
    [trigger]: replacement
  };

  await configuration.update("replacements", next, selectedTarget.target);
  vscode.window.showInformationMessage(`LatexToolBox: registered ${trigger} -> ${replacement}.`);
}

async function wrapSelectionWithWrapFigure(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a LaTeX file before converting a selection to wrapfigure.");
    return;
  }

  const document = editor.document;

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Convert the selection anyway?",
      { modal: true },
      "Convert Anyway"
    );

    if (choice !== "Convert Anyway") {
      return;
    }
  }

  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showErrorMessage("LatexToolBox: select a LaTeX paragraph or image block before converting it to wrapfigure.");
    return;
  }

  const selectedText = document.getText(selection);
  const configuration = getWrapFigureConfiguration();
  const result = transformSelectionToWrapFigure(selectedText, configuration);

  if (!result.text) {
    vscode.window.showErrorMessage(`LatexToolBox: ${result.error ?? "could not convert the selected text to wrapfigure."}`);
    return;
  }

  const wrappedText = result.text;

  await editor.edit((editBuilder) => {
    if (configuration.addPackage) {
      const insertion = getWrapfigPackageInsertion(document);

      if (insertion) {
        editBuilder.insert(insertion.position, insertion.text);
      }
    }

    editBuilder.replace(selection, wrappedText);
  });
}

async function handleMathSymbolReplacement(event: vscode.TextDocumentChangeEvent): Promise<void> {
  if (applyingMathSymbolReplacement || event.contentChanges.length !== 1 || !isLatexDocument(event.document)) {
    return;
  }

  const configuration = getMathSymbolConfiguration();

  if (!configuration.enabled || Object.keys(configuration.replacements).length === 0) {
    return;
  }

  const change = event.contentChanges[0];

  if (change.text.length === 0 || change.text.includes("\n") || change.text.includes("\r")) {
    return;
  }

  const insertedTextEnd = new vscode.Position(
    change.range.start.line,
    change.range.start.character + change.text.length
  );
  const linePrefix = event.document.lineAt(insertedTextEnd.line).text.slice(0, insertedTextEnd.character);
  const match = findMathSymbolReplacement(linePrefix, configuration.replacements);

  if (!match) {
    return;
  }

  const triggerStart = new vscode.Position(insertedTextEnd.line, match.startCharacter);
  const textBeforeTrigger = event.document.getText(new vscode.Range(
    new vscode.Position(0, 0),
    triggerStart
  ));

  if (!isInLatexMath(textBeforeTrigger)) {
    return;
  }

  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
    return;
  }

  const replacementRange = new vscode.Range(triggerStart, insertedTextEnd);

  applyingMathSymbolReplacement = true;

  try {
    await editor.edit((editBuilder) => {
      editBuilder.replace(replacementRange, match.replacement);
    }, {
      undoStopAfter: false,
      undoStopBefore: false
    });

    const replacementEnd = triggerStart.translate(0, match.replacement.length);
    editor.selection = new vscode.Selection(replacementEnd, replacementEnd);
  } finally {
    applyingMathSymbolReplacement = false;
  }
}

function isLatexDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "latex" || document.fileName.toLowerCase().endsWith(".tex");
}

function getClipboardImageConfiguration(): ClipboardImageConfiguration {
  const configuration = vscode.workspace.getConfiguration("latexToolBox.clipboardImage");

  return {
    directory: normalizeRelativeDirectory(configuration.get("directory", "figures/paste")),
    template: configuration.get("template", defaultTemplate()),
    width: configuration.get("width", "0.8\\linewidth")
  };
}

function getInsertImageConfiguration(): ImageSnippetConfiguration {
  const configuration = vscode.workspace.getConfiguration("latexToolBox.insertImage");

  return {
    template: configuration.get("template", defaultTemplate()),
    width: configuration.get("width", "0.8\\linewidth")
  };
}

function getWrapFigureConfiguration(): WrapFigureConfiguration {
  const configuration = vscode.workspace.getConfiguration("latexToolBox.wrapFigure");

  return {
    addPackage: configuration.get("addPackage", true),
    includeGraphicsWidth: configuration.get("includeGraphicsWidth", "\\linewidth"),
    position: normalizeWrapFigurePosition(configuration.get("position", "r")),
    updateIncludeGraphicsWidth: configuration.get("updateIncludeGraphicsWidth", true),
    width: configuration.get("width", "0.45\\textwidth")
  };
}

function getMathSymbolConfiguration(): MathSymbolConfiguration {
  const configuration = vscode.workspace.getConfiguration("latexToolBox.mathSymbols");

  return {
    enabled: configuration.get("enabled", true),
    replacements: normalizeMathSymbolReplacements(
      configuration.get("replacements", defaultMathSymbolReplacements())
    )
  };
}

function defaultMathSymbolReplacements(): MathSymbolReplacements {
  return {
    "<=>": "\\Leftrightarrow",
    "=>": "\\Rightarrow",
    "<=": "\\leq",
    ">=": "\\geq",
    "!=": "\\neq",
    "->": "\\to",
    "<-": "\\leftarrow",
    "|->": "\\mapsto",
    "+-": "\\pm",
    "-+": "\\mp",
    "~=": "\\approx",
    "===": "\\equiv",
    "...": "\\ldots"
  };
}

function normalizeWrapFigurePosition(position: string): string {
  const trimmed = position.trim();

  if (/^[rRlLiIoO]$/.test(trimmed)) {
    return trimmed;
  }

  return "r";
}

function getWrapfigPackageInsertion(document: vscode.TextDocument): { position: vscode.Position; text: string } | undefined {
  const text = document.getText();

  if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*\bwrapfig\b[^}]*\}/.test(text)) {
    return undefined;
  }

  const beginDocumentMatch = /\\begin\s*\{document\}/.exec(text);

  if (!beginDocumentMatch) {
    return undefined;
  }

  const preamble = text.slice(0, beginDocumentMatch.index);
  const usePackagePattern = /\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/g;
  let lastUsePackageEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = usePackagePattern.exec(preamble)) !== null) {
    lastUsePackageEnd = match.index + match[0].length;
  }

  if (lastUsePackageEnd >= 0) {
    const lastUsePackagePosition = document.positionAt(lastUsePackageEnd);

    return {
      position: new vscode.Position(lastUsePackagePosition.line + 1, 0),
      text: "\\usepackage{wrapfig}\n"
    };
  }

  return {
    position: document.positionAt(beginDocumentMatch.index),
    text: "\\usepackage{wrapfig}\n\n"
  };
}

async function findExistingTemplateFiles(targetDirectory: vscode.Uri): Promise<string[]> {
  const existingFiles: string[] = [];

  for (const fileName of listTemplateFileNames()) {
    const uri = vscode.Uri.joinPath(targetDirectory, fileName);

    try {
      await vscode.workspace.fs.stat(uri);
      existingFiles.push(fileName);
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
        throw error;
      }
    }
  }

  return existingFiles;
}

function normalizeRelativeDirectory(directory: string): string {
  const trimmed = directory.trim();

  if (!trimmed || path.isAbsolute(trimmed)) {
    return "figures/paste";
  }

  return trimmed;
}

function defaultTemplate(): string {
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\includegraphics[width=${width}]{${path}}",
    "  \\caption{$1}",
    "  \\label{fig:${basename}}",
    "\\end{figure}"
  ].join("\n");
}

async function writeClipboardImage(imageDirectory: string, image: Buffer): Promise<string> {
  await fs.mkdir(imageDirectory, { recursive: true });

  const initialName = makeTimestampedPngName();
  const imagePath = await findAvailablePath(imageDirectory, initialName);

  await fs.writeFile(imagePath, image, { flag: "wx" });

  return imagePath;
}

async function findAvailablePath(directory: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName);
  const basename = path.basename(fileName, extension);

  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0
      ? fileName
      : `${basename}-${index}${extension}`;
    const candidatePath = path.join(directory, candidateName);

    if (await isAvailable(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error("could not find an available image filename.");
}

async function isAvailable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function buildSnippet(
  configuration: ImageSnippetConfiguration,
  texDirectory: string,
  imagePath: string
): string {
  const filename = path.basename(imagePath);
  const basename = path.basename(filename, path.extname(filename));
  const relativePath = toLatexRelativePath(texDirectory, imagePath);

  return renderLatexTemplate(configuration.template, {
    basename,
    filename,
    path: relativePath,
    width: configuration.width
  });
}
