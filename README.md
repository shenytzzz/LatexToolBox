# LatexToolBox

LatexToolBox is a VS Code extension that adds practical shortcuts for writing LaTeX documents. It focuses on common image workflows that are repetitive when editing papers, notes, reports, and technical documents.

## Features

### Insert Clipboard Image

Run `LatexToolBox: Insert Clipboard Image` in a saved `.tex` file on macOS.

The command reads the current clipboard image, saves it beside the active TeX file under `figures/paste/`, and inserts a LaTeX figure snippet at the cursor position.

Default output:

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\linewidth]{figures/paste/pasted-YYYYMMDD-HHMMSS.png}
  \caption{}
  \label{fig:pasted-YYYYMMDD-HHMMSS}
\end{figure}
```

### Insert Image from File

Run `LatexToolBox: Insert Image from File` to choose an image from the file picker and insert a LaTeX snippet that references it.

The selected image is not copied. LatexToolBox inserts a path relative to the active `.tex` file, using POSIX-style `/` separators so the generated LaTeX remains portable.

Supported picker filters include `png`, `jpg`, `jpeg`, `pdf`, `eps`, `svg`, `bmp`, `gif`, `tif`, `tiff`, and `webp`.

### Wrap Selection with Wrapfigure

Select a LaTeX image block or a paragraph containing an image, then run `LatexToolBox: Wrap Selection with Wrapfigure`.

The command converts a selected `figure` environment into `wrapfigure`. If the selection contains surrounding text, only the image block is wrapped and the text remains outside the environment, allowing LaTeX to flow it around the image.

It can also insert `\usepackage{wrapfig}` into the preamble when the package is missing.

### Insert LaTeX Template Files

Run `LatexToolBox: Insert LaTeX Template Files` to copy the bundled notes template into the current VS Code project.

The command copies:

- `latextemplate/main.tex` -> `<project>/main.tex`
- `latextemplate/notes-style.tex` -> `<project>/notes-style.tex`

If the active file belongs to a workspace folder, that workspace folder is used as the project directory. In a multi-root workspace without an active file match, LatexToolBox asks which folder to use. Existing files are not overwritten unless you explicitly choose `Overwrite`.

### Insert Template Box Snippets

LatexToolBox includes snippets for the box environments defined by the bundled template:

- `definition` / `definitionbox`
- `principle` / `principlebox`
- `example` / `examplebox`
- `note` / `notebox`

You can insert them in two ways:

- Run `LatexToolBox: Insert Template Box Snippet` and choose a box type.
- Type one of the snippet prefixes in a LaTeX file and accept the VS Code completion item.

### Math Symbol Auto Replacement

LatexToolBox can automatically replace short typed symbols with LaTeX commands while the cursor is inside a math environment.

Default replacements:

```tex
<=>  ->  \Leftrightarrow
=>   ->  \Rightarrow
<=   ->  \leq
>=   ->  \geq
!=   ->  \neq
->   ->  \to
<-   ->  \leftarrow
|->  ->  \mapsto
+-   ->  \pm
-+   ->  \mp
~=   ->  \approx
===  ->  \equiv
...  ->  \ldots
```

Examples:

```tex
$ A => B $
```

becomes:

```tex
$ A \Rightarrow B $
```

The replacement only runs in LaTeX math mode, including `$...$`, `\(...\)`, `\[...\]`, and common math environments such as `equation`, `align`, `gather`, `multline`, `matrix`, and `cases`.

To add your own symbol, run `LatexToolBox: Register Math Symbol Replacement` and enter the typed trigger plus the LaTeX replacement. You can save it in the current workspace or in user settings.

## Requirements

- VS Code `^1.90.0`
- Node.js for local development
- macOS for clipboard image extraction

The file-picker image insertion and wrapfigure transformation are not macOS-specific.

## Extension Settings

### Clipboard Image

- `latexToolBox.clipboardImage.directory`
  - Default: `figures/paste`
  - Directory, relative to the active `.tex` file, where clipboard images are saved.
- `latexToolBox.clipboardImage.template`
  - Default: a full `figure` environment.
  - Snippet inserted after saving the clipboard image.
- `latexToolBox.clipboardImage.width`
  - Default: `0.8\linewidth`
  - Value used by `${width}` in the clipboard image template.

### Insert Image from File

- `latexToolBox.insertImage.template`
  - Default: a full `figure` environment.
  - Snippet inserted after choosing an image file.
- `latexToolBox.insertImage.width`
  - Default: `0.8\linewidth`
  - Value used by `${width}` in the file image template.

### Wrapfigure

- `latexToolBox.wrapFigure.position`
  - Default: `r`
  - Wrap placement. Common values are `r` for right and `l` for left.
- `latexToolBox.wrapFigure.width`
  - Default: `0.45\textwidth`
  - Width argument used by the `wrapfigure` environment.
- `latexToolBox.wrapFigure.includeGraphicsWidth`
  - Default: `\linewidth`
  - Width applied to `\includegraphics` inside the `wrapfigure` environment.
- `latexToolBox.wrapFigure.updateIncludeGraphicsWidth`
  - Default: `true`
  - Replace or add the width option on `\includegraphics` during conversion.
- `latexToolBox.wrapFigure.addPackage`
  - Default: `true`
  - Automatically add `\usepackage{wrapfig}` to the preamble when missing.

### Math Symbols

- `latexToolBox.mathSymbols.enabled`
  - Default: `true`
  - Enable automatic math-mode symbol replacement.
- `latexToolBox.mathSymbols.replacements`
  - Default: common symbolic triggers such as `=>`, `<=>`, `<=`, `>=`, `!=`, `->`, `<-`, `|->`, `+-`, `-+`, `~=`, `===`, and `...`.
  - Mapping from typed triggers to LaTeX replacements.

Example:

```json
{
  "latexToolBox.mathSymbols.replacements": {
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
  }
}
```

## Template Placeholders

Image insertion templates support these placeholders:

- `${path}`: relative POSIX path inserted into LaTeX.
- `${filename}`: image filename.
- `${basename}`: image filename without extension.
- `${width}`: configured image width.

Example custom template:

```json
{
  "latexToolBox.insertImage.template": "\\includegraphics[width=${width}]{${path}}"
}
```

## Development

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run in VS Code:

1. Open this repository in VS Code.
2. Press `F5`.
3. Use the newly opened Extension Development Host window.
4. Open `test.tex` or another saved `.tex` file.
5. Run commands from the Command Palette.

Useful files:

- `src/extension.ts`: command registration and VS Code integration.
- `src/clipboardImage.ts`: macOS clipboard image extraction.
- `src/latexTemplate.ts`: bundled template copying and template box snippet commands.
- `src/mathSymbols.ts`: math-mode detection and typed symbol replacement.
- `src/wrapFigure.ts`: LaTeX wrapfigure transformation logic.
- `latextemplate/main.tex`: bundled LaTeX notes template.
- `latextemplate/notes-style.tex`: bundled template style file.
- `snippets/latex.json`: LaTeX snippet contributions.
- `test.tex`: small document for manual testing.

## Current Limitations

- Clipboard image extraction currently targets macOS.
- The wrapfigure transformation is intentionally conservative and expects the selected text to contain an `\includegraphics` command.

## License

No license has been selected yet.
