# LaTeX PDE Notes Template

This folder contains an English LaTeX template styled after chapter notes with:

- optional table of contents;
- optional minimal cover page;
- optional large chapter or appendix mark at the upper right of chapter-opening pages;
- optional small running text at the top of normal pages;
- boxed definitions, theorems, propositions, proofs, examples, principles, and notes.

## Files

- `main.tex`: document switches, editable running-header text, cover-page text, and chapter inputs.
- `notes-style.tex`: packages, colors, page layout, chapter headings, table-of-contents styling, and box environments.
- `chapters/chapter1.tex`, `chapters/chapter2.tex`, `chapters/chapter3.tex`: sample chapter content.

Edit `main.tex` for document-level settings and add or remove `\input{chapters/...}` lines to control chapter order. Edit files under `chapters/` for normal chapter writing.

The feature switches are near the top of the file:

```tex
\ShowCoverPage           % Comment this line to skip the cover page.
\ShowTableOfContents      % Comment this line to skip the table of contents.
\ShowChapterNumberMark    % Comment this line to hide the large top-right chapter number.
\ShowTopRunningText       % Comment this line to hide the small text at the top of normal pages.
\UseDraftImages           % Uncomment this line to show draft boxes instead of rendering images.
```

`\UseDraftImages` enables `graphicx` draft mode. Images are replaced by same-layout draft boxes during compilation, which can speed up large documents while preserving image dimensions from options such as `width`, `height`, and `scale`. Uncomment the switch near the top of `main.tex` to enable draft images globally. Leave it commented for normal rendering, then use `{\UseDraftImages ... }` around a local section to enable draft image boxes only inside that TeX group.

The running-header text is explicitly marked in `main.tex`:

```tex
% EDIT HERE: small text shown at the top of normal pages.
\newcommand{\TopSmallTextLeft}{Unit \thechapter\quad Partial Differential Equations}
\newcommand{\TopSmallTextRight}{Riverside University\quad School of Mathematical Sciences}
```

The cover-page text is also explicitly marked in `main.tex`:

```tex
% EDIT HERE: cover page text.
\newcommand{\CoverTitle}{Partial Differential Equations}
\newcommand{\CoverSubtitle}{A concise template for mathematical notes}
\newcommand{\CoverAuthor}{Creative Informatics, The University of Tokyo}
```

The style file is loaded from `main.tex` with:

```tex
\input{notes-style.tex}
```

Chapter files are loaded from `main.tex` with:

```tex
\input{chapters/chapter1.tex}
\input{chapters/chapter2.tex}
\input{chapters/chapter3.tex}
```

## Compile

Run twice so the table of contents has correct page numbers:

```sh
pdflatex main.tex
pdflatex main.tex
```

If `latexmk` is installed, this also works:

```sh
latexmk -pdf main.tex
```
