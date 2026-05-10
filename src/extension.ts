import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readClipboardImageAsPng } from "./clipboardImage";
import { makeTimestampedPngName, toLatexRelativePath } from "./fileNames";
import {
  copyLatexTemplateFiles,
  copyLatexTemplateStyleFile,
  listTemplateFileNames,
  resolveProjectDirectory,
  selectTemplateBoxSnippet
} from "./latexTemplate";
import {
  findMathSymbolReplacement,
  isInLatexMath,
  normalizeMathSymbolReplacements,
  type MathSymbolReplacementMatch,
  type MathSymbolReplacements
} from "./mathSymbols";
import { renderLatexTemplate } from "./template";
import {
  transformSelectionFromSubfigures,
  transformSelectionToSubfigures,
  type SubfigureTransformResult
} from "./subfigures";
import {
  transformSelectionFromWrapFigure,
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
let applyingInlineMathSelectionWrap = false;
let lastMathSymbolReplacement: LastMathSymbolReplacement | undefined;
let lastLatexSelections: LastLatexSelectionSnapshot | undefined;
const previousDocumentTexts = new Map<string, string>();

interface LastMathSymbolReplacement {
  documentUri: string;
  line: number;
  replacement: string;
  startCharacter: number;
  trigger: string;
}

interface LastLatexSelectionSnapshot {
  documentUri: string;
  selections: Array<{
    range: vscode.Range;
    text: string;
  }>;
}

export function activate(context: vscode.ExtensionContext): void {
  vscode.workspace.textDocuments.forEach(rememberDocumentText);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "latex-toolbox.boldSelection",
      () => formatSelectionWithLatexCommand("textbf", "bold")
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.italicSelection",
      () => formatSelectionWithLatexCommand("textit", "italic")
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.underlineSelection",
      () => formatSelectionWithLatexCommand("underline", "underline")
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.wrapSelectionWithInlineMath",
      wrapSelectionWithInlineMath
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.insertClipboardImage",
      insertClipboardImage
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.insertImageFromFile",
      insertImageFromFile
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.mergeSelectionIntoSubfigures",
      mergeSelectionIntoSubfigures
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.unmergeSelectionFromSubfigures",
      unmergeSelectionFromSubfigures
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.insertTemplateFiles",
      () => insertTemplateFiles(context)
    ),
    vscode.commands.registerCommand(
      "latex-toolbox.updateTemplateStyleFile",
      () => updateTemplateStyleFile(context)
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
    vscode.commands.registerCommand(
      "latex-toolbox.unwrapSelectionFromWrapFigure",
      unwrapSelectionFromWrapFigure
    ),
    vscode.workspace.onDidOpenTextDocument(rememberDocumentText),
    vscode.workspace.onDidCloseTextDocument((document) => {
      previousDocumentTexts.delete(document.uri.toString());
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      rememberLatexSelections(event.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void handleTextDocumentChange(event);
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
  const latexProjectDirectory = await resolveLatexProjectDirectory(document);
  const imageDirectory = path.resolve(latexProjectDirectory, configuration.directory);

  try {
    const image = await readClipboardImageAsPng();
    const imagePath = await writeClipboardImage(imageDirectory, image);
    const snippet = buildSnippet(configuration, latexProjectDirectory, imagePath);

    await editor.insertSnippet(new vscode.SnippetString(snippet));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`LatexToolBox: ${message}`);
  }
}

async function formatSelectionWithLatexCommand(commandName: string, formatName: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage(`LatexToolBox: open a LaTeX file before applying ${formatName}.`);
    return;
  }

  const document = editor.document;

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      `LatexToolBox: the active document is not recognized as LaTeX. Apply ${formatName} anyway?`,
      { modal: true },
      "Apply Anyway"
    );

    if (choice !== "Apply Anyway") {
      return;
    }
  }

  const selections = editor.selections.filter((selection) => !selection.isEmpty);

  if (selections.length === 0) {
    vscode.window.showErrorMessage(`LatexToolBox: select text before applying ${formatName}.`);
    return;
  }

  const sortedSelections = [...selections].sort((left, right) => document.offsetAt(right.start) - document.offsetAt(left.start));
  const nextSelections = new Map<string, vscode.Selection>();

  await editor.edit((editBuilder) => {
    for (const selection of sortedSelections) {
      const toggle = getLatexCommandToggle(document, selection, commandName);

      if (toggle) {
        editBuilder.replace(toggle.range, toggle.innerText);
        nextSelections.set(selectionKey(selection), toggle.nextSelection);
        continue;
      }

      const selectedText = document.getText(selection);
      const wrappedText = `\\${commandName}{${selectedText}}`;

      editBuilder.replace(selection, wrappedText);
      nextSelections.set(
        selectionKey(selection),
        makeSelectionFromTextOffsets(selection.start, commandName.length + 2, commandName.length + 2 + selectedText.length, wrappedText)
      );
    }
  });

  editor.selections = selections
    .map((selection) => nextSelections.get(selectionKey(selection)))
    .filter((selection): selection is vscode.Selection => selection !== undefined);
}

async function wrapSelectionWithInlineMath(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a LaTeX file before wrapping a selection with inline math.");
    return;
  }

  const document = editor.document;

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Wrap the selection with inline math anyway?",
      { modal: true },
      "Wrap Anyway"
    );

    if (choice !== "Wrap Anyway") {
      return;
    }
  }

  if (!await wrapEditorSelectionsWithInlineMath(editor)) {
    vscode.window.showErrorMessage("LatexToolBox: select text before wrapping it with inline math.");
  }
}

async function wrapEditorSelectionsWithInlineMath(editor: vscode.TextEditor): Promise<boolean> {
  const document = editor.document;
  const selections = editor.selections.filter((selection) => !selection.isEmpty);

  if (selections.length === 0) {
    return false;
  }

  const sortedSelections = [...selections].sort((left, right) => document.offsetAt(right.start) - document.offsetAt(left.start));
  const nextSelections = new Map<string, vscode.Selection>();

  await editor.edit((editBuilder) => {
    for (const selection of sortedSelections) {
      const selectedText = document.getText(selection);
      const wrappedText = `$${selectedText}$`;

      editBuilder.replace(selection, wrappedText);
      nextSelections.set(
        selectionKey(selection),
        makeSelectionFromTextOffsets(selection.start, 1, 1 + selectedText.length, wrappedText)
      );
    }
  });

  editor.selections = selections
    .map((selection) => nextSelections.get(selectionKey(selection)))
    .filter((selection): selection is vscode.Selection => selection !== undefined);

  return true;
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

  const latexProjectDirectory = await resolveLatexProjectDirectory(document);
  const selectedImage = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(latexProjectDirectory),
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
  const snippet = buildSnippet(configuration, latexProjectDirectory, imageUri.fsPath);

  await editor.insertSnippet(new vscode.SnippetString(snippet));
}

async function mergeSelectionIntoSubfigures(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a LaTeX file before merging figures into subfigures.");
    return;
  }

  const document = editor.document;

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Merge the selected figures anyway?",
      { modal: true },
      "Merge Anyway"
    );

    if (choice !== "Merge Anyway") {
      return;
    }
  }

  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showErrorMessage("LatexToolBox: select two or more figure environments before merging them into subfigures.");
    return;
  }

  const result: SubfigureTransformResult = transformSelectionToSubfigures(document.getText(selection));

  if (!result.text) {
    vscode.window.showErrorMessage(`LatexToolBox: ${result.error ?? "could not merge the selected figures into subfigures."}`);
    return;
  }

  const transformedText = result.text;

  await editor.edit((editBuilder) => {
    const insertion = getPackageInsertion(document, "subcaption");

    if (insertion) {
      editBuilder.insert(insertion.position, insertion.text);
    }

    editBuilder.replace(selection, transformedText);
  });
}

async function unmergeSelectionFromSubfigures(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a LaTeX file before unmerging subfigures.");
    return;
  }

  const document = editor.document;

  if (!isLatexDocument(document)) {
    const choice = await vscode.window.showWarningMessage(
      "LatexToolBox: the active document is not recognized as LaTeX. Unmerge the selected subfigures anyway?",
      { modal: true },
      "Unmerge Anyway"
    );

    if (choice !== "Unmerge Anyway") {
      return;
    }
  }

  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showErrorMessage("LatexToolBox: select one figure environment containing subfigures before unmerging it.");
    return;
  }

  const result: SubfigureTransformResult = transformSelectionFromSubfigures(document.getText(selection));

  if (!result.text) {
    vscode.window.showErrorMessage(`LatexToolBox: ${result.error ?? "could not unmerge the selected subfigures."}`);
    return;
  }

  const transformedText = result.text;

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, transformedText);
  });
}

async function insertTemplateFiles(context: vscode.ExtensionContext): Promise<void> {
  const baseDirectory = await resolveProjectDirectory();

  if (!baseDirectory) {
    vscode.window.showErrorMessage("LatexToolBox: open a project folder or saved file before inserting the LaTeX template.");
    return;
  }

  const targetDirectory = await selectTemplateTargetDirectory(baseDirectory);

  if (!targetDirectory) {
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

async function selectTemplateTargetDirectory(baseDirectory: vscode.Uri): Promise<vscode.Uri | undefined> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        description: baseDirectory.fsPath,
        label: "Current project folder",
        target: "current" as const
      },
      {
        description: `Create a folder under ${baseDirectory.fsPath}`,
        label: "New folder...",
        target: "new" as const
      }
    ],
    {
      placeHolder: "Select where the LaTeX template files should be inserted"
    }
  );

  if (!selected) {
    return undefined;
  }

  if (selected.target === "current") {
    return baseDirectory;
  }

  const folderPath = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "notes or notes/week1",
    prompt: `New folder path relative to ${baseDirectory.fsPath}`,
    validateInput: validateTemplateTargetSubdirectory
  });

  if (!folderPath) {
    return undefined;
  }

  return vscode.Uri.joinPath(baseDirectory, ...splitRelativePath(folderPath));
}

function validateTemplateTargetSubdirectory(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Folder path cannot be empty.";
  }

  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return "Use a relative folder path.";
  }

  const segments = splitRelativePath(trimmed);

  if (segments.length === 0) {
    return "Folder path cannot be empty.";
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "Folder path cannot contain dot segments.";
  }

  return undefined;
}

function splitRelativePath(value: string): string[] {
  return value.trim().split(/[\\/]+/).filter((segment) => segment.length > 0);
}

async function updateTemplateStyleFile(context: vscode.ExtensionContext): Promise<void> {
  const targetDirectory = await resolveProjectDirectory();

  if (!targetDirectory) {
    vscode.window.showErrorMessage("LatexToolBox: open a project folder or saved file before updating the LaTeX template style.");
    return;
  }

  const existingFiles = await findExistingTemplateFiles(targetDirectory);

  if (existingFiles.includes("notes-style.tex")) {
    const choice = await vscode.window.showWarningMessage(
      `LatexToolBox: overwrite notes-style.tex in ${targetDirectory.fsPath}? main.tex will not be changed.`,
      { modal: true },
      "Overwrite notes-style.tex"
    );

    if (choice !== "Overwrite notes-style.tex") {
      return;
    }
  }

  try {
    const result = await copyLatexTemplateStyleFile(context.extensionUri, targetDirectory, true);
    vscode.window.showInformationMessage(`LatexToolBox: updated ${result.copied.join(", ")} in ${result.targetDirectory}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`LatexToolBox: failed to update template style. ${message}`);
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
      const insertion = getPackageInsertion(document, "wrapfig");

      if (insertion) {
        editBuilder.insert(insertion.position, insertion.text);
      }
    }

    editBuilder.replace(selection, wrappedText);
  });
}

async function unwrapSelectionFromWrapFigure(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("LatexToolBox: open a LaTeX file before converting wrapfigure back to figure.");
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
    vscode.window.showErrorMessage("LatexToolBox: select a wrapfigure environment before converting it back to figure.");
    return;
  }

  const result = transformSelectionFromWrapFigure(document.getText(selection));

  if (!result.text) {
    vscode.window.showErrorMessage(`LatexToolBox: ${result.error ?? "could not convert the selected wrapfigure back to figure."}`);
    return;
  }

  const transformedText = result.text;

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, transformedText);
  });
}

function rememberLatexSelections(editor: vscode.TextEditor): void {
  if (!isLatexDocument(editor.document)) {
    lastLatexSelections = undefined;
    return;
  }

  const selections = editor.selections
    .filter((selection) => !selection.isEmpty)
    .map((selection) => ({
      range: new vscode.Range(selection.start, selection.end),
      text: editor.document.getText(selection)
    }));

  lastLatexSelections = selections.length > 0
    ? {
      documentUri: editor.document.uri.toString(),
      selections
    }
    : undefined;
}

async function handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
  try {
    if (applyingInlineMathSelectionWrap) {
      return;
    }

    if (await handleInlineMathSelectionWrap(event)) {
      return;
    }

    await handleMathSymbolReplacement(event);
  } finally {
    rememberDocumentText(event.document);
  }
}

async function handleInlineMathSelectionWrap(event: vscode.TextDocumentChangeEvent): Promise<boolean> {
  if (!isLatexDocument(event.document) || event.contentChanges.length !== 1) {
    return false;
  }

  if (
    event.reason === vscode.TextDocumentChangeReason.Undo
    || event.reason === vscode.TextDocumentChangeReason.Redo
  ) {
    return false;
  }

  const change = event.contentChanges[0];

  if ((change.text !== "$" && change.text !== "$$") || change.range.isEmpty) {
    return false;
  }

  const snapshot = lastLatexSelections?.documentUri === event.document.uri.toString()
    ? lastLatexSelections
    : undefined;
  const matchedSelection = snapshot?.selections.find((selection) => selection.range.isEqual(change.range));
  const selectedText = matchedSelection?.text ?? getPreviousDocumentText(event.document, change.range);

  if (!selectedText) {
    return false;
  }

  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
    return false;
  }

  const wrappedText = `$${selectedText}$`;

  applyingInlineMathSelectionWrap = true;
  lastLatexSelections = undefined;

  try {
    await vscode.commands.executeCommand("undo");

    await editor.edit((editBuilder) => {
      editBuilder.replace(change.range, wrappedText);
    });

    editor.selection = makeSelectionFromTextOffsets(change.range.start, 1, 1 + selectedText.length, wrappedText);
  } finally {
    applyingInlineMathSelectionWrap = false;
  }

  return true;
}

function rememberDocumentText(document: vscode.TextDocument): void {
  if (isLatexDocument(document)) {
    previousDocumentTexts.set(document.uri.toString(), document.getText());
  } else {
    previousDocumentTexts.delete(document.uri.toString());
  }
}

function getPreviousDocumentText(document: vscode.TextDocument, range: vscode.Range): string | undefined {
  const previousText = previousDocumentTexts.get(document.uri.toString());

  if (previousText === undefined) {
    return undefined;
  }

  const startOffset = offsetAtTextPosition(previousText, range.start);
  const endOffset = offsetAtTextPosition(previousText, range.end);

  if (startOffset === undefined || endOffset === undefined || endOffset <= startOffset) {
    return undefined;
  }

  return previousText.slice(startOffset, endOffset);
}

function offsetAtTextPosition(text: string, position: vscode.Position): number | undefined {
  let offset = 0;

  for (let line = 0; line < position.line; line += 1) {
    const nextLineOffset = findNextLineOffset(text, offset);

    if (nextLineOffset === undefined) {
      return undefined;
    }

    offset = nextLineOffset;
  }

  const lineEndOffset = findLineEndOffset(text, offset);

  if (offset + position.character > lineEndOffset) {
    return undefined;
  }

  return offset + position.character;
}

function findNextLineOffset(text: string, offset: number): number | undefined {
  for (let index = offset; index < text.length; index += 1) {
    if (text[index] === "\n") {
      return index + 1;
    }

    if (text[index] === "\r") {
      return text[index + 1] === "\n" ? index + 2 : index + 1;
    }
  }

  return undefined;
}

function findLineEndOffset(text: string, offset: number): number {
  for (let index = offset; index < text.length; index += 1) {
    if (text[index] === "\n" || text[index] === "\r") {
      return index;
    }
  }

  return text.length;
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

  const doublePrimePreservation = getDoublePrimePreservation(event.document, linePrefix, insertedTextEnd, match);

  if (doublePrimePreservation) {
    applyingMathSymbolReplacement = true;

    try {
      await editor.edit((editBuilder) => {
        editBuilder.replace(doublePrimePreservation.range, "''");
      }, {
        undoStopAfter: false,
        undoStopBefore: false
      });

      editor.selection = doublePrimePreservation.nextSelection;
      lastMathSymbolReplacement = undefined;
    } finally {
      applyingMathSymbolReplacement = false;
    }

    return;
  }

  if (shouldPreserveRawDoublePrime(linePrefix, match)) {
    lastMathSymbolReplacement = undefined;
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
    lastMathSymbolReplacement = {
      documentUri: event.document.uri.toString(),
      line: triggerStart.line,
      replacement: match.replacement,
      startCharacter: triggerStart.character,
      trigger: match.trigger
    };
  } finally {
    applyingMathSymbolReplacement = false;
  }
}

function getDoublePrimePreservation(
  document: vscode.TextDocument,
  linePrefix: string,
  insertedTextEnd: vscode.Position,
  match: MathSymbolReplacementMatch
): { nextSelection: vscode.Selection; range: vscode.Range } | undefined {
  if (match.trigger !== "'" || !linePrefix.endsWith(`${match.replacement}'`)) {
    return undefined;
  }

  const replacementStartCharacter = match.startCharacter - match.replacement.length;

  if (replacementStartCharacter < 0) {
    return undefined;
  }

  if (
    !lastMathSymbolReplacement
    || lastMathSymbolReplacement.documentUri !== document.uri.toString()
    || lastMathSymbolReplacement.line !== insertedTextEnd.line
    || lastMathSymbolReplacement.startCharacter !== replacementStartCharacter
    || lastMathSymbolReplacement.trigger !== match.trigger
    || lastMathSymbolReplacement.replacement !== match.replacement
  ) {
    return undefined;
  }

  const rangeStart = new vscode.Position(insertedTextEnd.line, replacementStartCharacter);
  const range = new vscode.Range(rangeStart, insertedTextEnd);
  const currentText = document.getText(range);

  if (currentText !== `${match.replacement}'`) {
    return undefined;
  }

  const selectionEnd = rangeStart.translate(0, 2);

  return {
    nextSelection: new vscode.Selection(selectionEnd, selectionEnd),
    range
  };
}

function shouldPreserveRawDoublePrime(
  linePrefix: string,
  match: MathSymbolReplacementMatch
): boolean {
  return match.trigger === "'" && linePrefix.endsWith("''");
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
    "...": "\\ldots",
    "'": "^{\\prime}"
  };
}

function normalizeWrapFigurePosition(position: string): string {
  const trimmed = position.trim();

  if (/^[rRlLiIoO]$/.test(trimmed)) {
    return trimmed;
  }

  return "r";
}

function getPackageInsertion(document: vscode.TextDocument, packageName: string): { position: vscode.Position; text: string } | undefined {
  const text = document.getText();
  const packagePattern = new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${escapeRegExp(packageName)}\\b[^}]*\\}`);

  if (packagePattern.test(text)) {
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
      text: `\\usepackage{${packageName}}\n`
    };
  }

  return {
    position: document.positionAt(beginDocumentMatch.index),
    text: `\\usepackage{${packageName}}\n\n`
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findExistingTemplateFiles(targetDirectory: vscode.Uri): Promise<string[]> {
  const existingFiles: string[] = [];

  for (const fileName of listTemplateFileNames()) {
    const uri = vscode.Uri.joinPath(targetDirectory, ...fileName.split("/"));

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

async function resolveLatexProjectDirectory(document: vscode.TextDocument): Promise<string> {
  const documentDirectory = path.dirname(document.uri.fsPath);
  const texRootPath = resolveTexRootDirective(document, documentDirectory);

  if (texRootPath) {
    return path.dirname(texRootPath);
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceDirectory = workspaceFolder?.uri.scheme === "file"
    ? workspaceFolder.uri.fsPath
    : undefined;
  const mainTexDirectory = await findNearestMainTexDirectory(documentDirectory, workspaceDirectory);

  return mainTexDirectory ?? documentDirectory;
}

function resolveTexRootDirective(document: vscode.TextDocument, documentDirectory: string): string | undefined {
  const lines = document.getText().split(/\r?\n/, 50);

  for (const line of lines) {
    const match = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/i.exec(line);

    if (!match) {
      continue;
    }

    const rootValue = stripTexRootQuotes(match[1].trim());

    if (!rootValue) {
      continue;
    }

    return path.isAbsolute(rootValue)
      ? path.normalize(rootValue)
      : path.resolve(documentDirectory, rootValue);
  }

  return undefined;
}

function stripTexRootQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

async function findNearestMainTexDirectory(startDirectory: string, stopDirectory: string | undefined): Promise<string | undefined> {
  const stop = stopDirectory ? path.resolve(stopDirectory) : undefined;
  let current = path.resolve(startDirectory);

  while (true) {
    if (await isFile(path.join(current, "main.tex"))) {
      return current;
    }

    if (current === stop) {
      return undefined;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
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

function selectionKey(selection: vscode.Selection): string {
  return [
    selection.start.line,
    selection.start.character,
    selection.end.line,
    selection.end.character
  ].join(":");
}

function getLatexCommandToggle(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  commandName: string
): { innerText: string; nextSelection: vscode.Selection; range: vscode.Range } | undefined {
  return getWholeCommandSelectionToggle(document, selection, commandName)
    ?? getContainingCommandSelectionToggle(document, selection, commandName);
}

function getWholeCommandSelectionToggle(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  commandName: string
): { innerText: string; nextSelection: vscode.Selection; range: vscode.Range } | undefined {
  const selectedText = document.getText(selection);
  const openWrapper = `\\${commandName}{`;

  if (!selectedText.startsWith(openWrapper) || !selectedText.endsWith("}")) {
    return undefined;
  }

  const closeOffset = findMatchingClosingBrace(selectedText, openWrapper.length - 1);

  if (closeOffset !== selectedText.length - 1) {
    return undefined;
  }

  const innerText = selectedText.slice(openWrapper.length, -1);

  return {
    innerText,
    nextSelection: makeSelectionFromTextOffsets(selection.start, 0, innerText.length, innerText),
    range: selection
  };
}

function getContainingCommandSelectionToggle(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  commandName: string
): { innerText: string; nextSelection: vscode.Selection; range: vscode.Range } | undefined {
  const documentText = document.getText();
  const openWrapper = `\\${commandName}{`;
  const selectionStartOffset = document.offsetAt(selection.start);
  const selectionEndOffset = document.offsetAt(selection.end);
  let openOffset = documentText.lastIndexOf(openWrapper, selectionStartOffset);

  while (openOffset >= 0) {
    const contentStartOffset = openOffset + openWrapper.length;
    const closeOffset = findMatchingClosingBrace(documentText, contentStartOffset - 1);

    if (
      closeOffset >= 0
      && selectionStartOffset >= contentStartOffset
      && selectionEndOffset <= closeOffset
    ) {
      const innerText = documentText.slice(contentStartOffset, closeOffset);
      const rangeStart = document.positionAt(openOffset);
      const range = new vscode.Range(rangeStart, document.positionAt(closeOffset + 1));
      const nextSelectionStartOffset = selectionStartOffset - contentStartOffset;
      const nextSelectionEndOffset = selectionEndOffset - contentStartOffset;

      return {
        innerText,
        nextSelection: makeSelectionFromTextOffsets(
          rangeStart,
          nextSelectionStartOffset,
          nextSelectionEndOffset,
          innerText
        ),
        range
      };
    }

    openOffset = documentText.lastIndexOf(openWrapper, openOffset - 1);
  }

  return undefined;
}

function findMatchingClosingBrace(text: string, openBraceOffset: number): number {
  let depth = 0;

  for (let index = openBraceOffset; index < text.length; index += 1) {
    const char = text[index];

    if (char === "{" && !isEscapedAt(text, index)) {
      depth += 1;
      continue;
    }

    if (char === "}" && !isEscapedAt(text, index)) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function makeSelectionFromTextOffsets(
  startPosition: vscode.Position,
  startOffset: number,
  endOffset: number,
  text: string
): vscode.Selection {
  const start = translateByTextOffset(startPosition, text.slice(0, startOffset));
  const end = translateByTextOffset(startPosition, text.slice(0, endOffset));

  return new vscode.Selection(start, end);
}

function translateByTextOffset(position: vscode.Position, text: string): vscode.Position {
  const lines = text.split(/\r?\n/);

  if (lines.length === 1) {
    return position.translate(0, text.length);
  }

  return new vscode.Position(
    position.line + lines.length - 1,
    lines[lines.length - 1].length
  );
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
