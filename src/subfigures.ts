export interface SubfigureTransformResult {
  error?: string;
  text?: string;
}

interface ParsedFigure {
  caption: string;
  includeOptions: string | undefined;
  imagePath: string;
  label: string | undefined;
  options: string | undefined;
}

const figureEnvironmentPattern = /\\begin\s*\{figure\}\s*(\[[^\]]*\])?([\s\S]*?)\\end\s*\{figure\}/g;
const subfigureEnvironmentPattern = /\\begin\s*\{subfigure\}\s*(?:\[[^\]]*\])?\s*\{[^}]*\}([\s\S]*?)\\end\s*\{subfigure\}/g;

export function transformSelectionToSubfigures(selectedText: string): SubfigureTransformResult {
  if (selectedText.trim().length === 0) {
    return {
      error: "select at least two figure environments before merging them into subfigures."
    };
  }

  const figures = readSelectedFigures(selectedText);

  if (figures.error) {
    return {
      error: figures.error
    };
  }

  if (figures.items.length < 2) {
    return {
      error: "select at least two complete figure environments."
    };
  }

  return {
    text: buildSubfigureEnvironment(figures.items)
  };
}

export function transformSelectionFromSubfigures(selectedText: string): SubfigureTransformResult {
  if (selectedText.trim().length === 0) {
    return {
      error: "select a figure environment containing at least two subfigures before unmerging it."
    };
  }

  const figure = readSingleSelectedFigure(selectedText);

  if (figure.error) {
    return {
      error: figure.error
    };
  }

  const subfigures = readSubfigures(figure.content, figure.options);

  if (subfigures.error) {
    return {
      error: subfigures.error
    };
  }

  if (subfigures.items.length < 2) {
    return {
      error: "selected figure must contain at least two subfigure environments."
    };
  }

  return {
    text: buildSeparateFigureEnvironments(subfigures.items)
  };
}

function readSingleSelectedFigure(selectedText: string): { content: string; error?: string; options: string | undefined } {
  figureEnvironmentPattern.lastIndex = 0;

  const match = figureEnvironmentPattern.exec(selectedText);

  if (!match) {
    return {
      content: "",
      error: "select one complete figure environment.",
      options: undefined
    };
  }

  const beforeFigure = selectedText.slice(0, match.index);
  const afterFigure = selectedText.slice(match.index + match[0].length);

  if (beforeFigure.trim().length > 0 || afterFigure.trim().length > 0) {
    return {
      content: "",
      error: "selection can only contain one figure environment and whitespace.",
      options: undefined
    };
  }

  return {
    content: match[2],
    options: match[1]
  };
}

function readSubfigures(content: string, figureOptions: string | undefined): { error?: string; items: ParsedFigure[] } {
  const subfigures: ParsedFigure[] = [];
  let match: RegExpExecArray | null;

  subfigureEnvironmentPattern.lastIndex = 0;

  while ((match = subfigureEnvironmentPattern.exec(content)) !== null) {
    const parsed = parseFigureContent(match[1], figureOptions);

    if (!parsed) {
      return {
        error: "each selected subfigure environment must contain an \\includegraphics command.",
        items: []
      };
    }

    subfigures.push(parsed);
  }

  return {
    items: subfigures
  };
}

function readSelectedFigures(selectedText: string): { error?: string; items: ParsedFigure[] } {
  const figures: ParsedFigure[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  figureEnvironmentPattern.lastIndex = 0;

  while ((match = figureEnvironmentPattern.exec(selectedText)) !== null) {
    if (selectedText.slice(cursor, match.index).trim().length > 0) {
      return {
        error: "selection can only contain figure environments and whitespace.",
        items: []
      };
    }

    const parsed = parseFigureContent(match[2], match[1]);

    if (!parsed) {
      return {
        error: "each selected figure environment must contain an \\includegraphics command.",
        items: []
      };
    }

    figures.push(parsed);
    cursor = match.index + match[0].length;
  }

  if (selectedText.slice(cursor).trim().length > 0) {
    return {
      error: "selection can only contain figure environments and whitespace.",
      items: []
    };
  }

  return {
    items: figures
  };
}

function parseFigureContent(content: string, options: string | undefined): ParsedFigure | undefined {
  const includeGraphics = readIncludeGraphics(content);

  if (!includeGraphics) {
    return undefined;
  }

  return {
    caption: readCommandArgument(content, "caption") ?? "",
    includeOptions: includeGraphics.options,
    imagePath: includeGraphics.path,
    label: readCommandArgument(content, "label"),
    options
  };
}

function readIncludeGraphics(content: string): { options: string | undefined; path: string } | undefined {
  const includePattern = /\\includegraphics\b\s*(?:\[([^\]]*)\])?\s*\{/g;
  const match = includePattern.exec(content);

  if (!match) {
    return undefined;
  }

  const openBraceIndex = includePattern.lastIndex - 1;
  const closeBraceIndex = findMatchingClosingBrace(content, openBraceIndex);

  if (closeBraceIndex < 0) {
    return undefined;
  }

  return {
    options: match[1],
    path: content.slice(openBraceIndex + 1, closeBraceIndex)
  };
}

function readCommandArgument(content: string, commandName: string): string | undefined {
  const commandPattern = new RegExp(`\\\\${commandName}\\b\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
  const match = commandPattern.exec(content);

  if (!match) {
    return undefined;
  }

  const openBraceIndex = commandPattern.lastIndex - 1;
  const closeBraceIndex = findMatchingClosingBrace(content, openBraceIndex);

  if (closeBraceIndex < 0) {
    return undefined;
  }

  return content.slice(openBraceIndex + 1, closeBraceIndex);
}

function buildSubfigureEnvironment(figures: ParsedFigure[]): string {
  const columns = getSubfigureColumnCount(figures.length);
  const subfigureWidth = getSubfigureWidth(columns);
  const figureOptions = figures[0].options ?? "[htbp]";
  const lines = [
    `\\begin{figure}${figureOptions}`,
    "  \\centering"
  ];

  figures.forEach((figure, index) => {
    lines.push(
      `  \\begin{subfigure}[b]{${subfigureWidth}}`,
      "    \\centering",
      `    \\includegraphics[${updateGraphicsOptions(figure.includeOptions, "\\linewidth")}]{${figure.imagePath}}`,
      `    \\caption{${figure.caption}}`
    );

    if (figure.label) {
      lines.push(`    \\label{${figure.label}}`);
    }

    lines.push("  \\end{subfigure}");

    if (index < figures.length - 1) {
      lines.push((index + 1) % columns === 0 ? "  \\medskip" : "  \\hfill");
    }
  });

  lines.push(
    "  \\caption{}",
    `  \\label{${buildCombinedLabel(figures)}}`,
    "\\end{figure}"
  );

  return lines.join("\n");
}

function getSubfigureColumnCount(figureCount: number): number {
  const candidates = [2, 3, 4].filter((columns) => columns <= figureCount);

  return candidates.sort((left, right) => {
    const leftScore = scoreSubfigureColumnCount(figureCount, left);
    const rightScore = scoreSubfigureColumnCount(figureCount, right);

    return leftScore.singleItemLastRow - rightScore.singleItemLastRow
      || leftScore.rows - rightScore.rows
      || left - right;
  })[0] ?? 1;
}

function getSubfigureWidth(columns: number): string {
  const width = (0.96 / columns).toFixed(2);

  return `${width}\\textwidth`;
}

function scoreSubfigureColumnCount(figureCount: number, columns: number): { rows: number; singleItemLastRow: number } {
  const remainder = figureCount % columns;

  return {
    rows: Math.ceil(figureCount / columns),
    singleItemLastRow: remainder === 1 ? 1 : 0
  };
}

function buildSeparateFigureEnvironments(figures: ParsedFigure[]): string {
  return figures.map((figure) => {
    const lines = [
      `\\begin{figure}${figure.options ?? "[htbp]"}`,
      "  \\centering",
      `  \\includegraphics[${updateGraphicsOptions(figure.includeOptions, "0.8\\linewidth")}]{${figure.imagePath}}`,
      `  \\caption{${figure.caption}}`
    ];

    if (figure.label) {
      lines.push(`  \\label{${figure.label}}`);
    }

    lines.push("\\end{figure}");

    return lines.join("\n");
  }).join("\n");
}

function updateGraphicsOptions(options: string | undefined, width: string): string {
  if (!options || options.trim().length === 0) {
    return `width=${width}`;
  }

  if (/(^|,)\s*width\s*=/.test(options)) {
    return options.replace(/(^|,)\s*width\s*=\s*[^,]+/, `$1width=${width}`);
  }

  return `width=${width},${options}`;
}

function buildCombinedLabel(figures: ParsedFigure[]): string {
  const firstLabel = figures.find((figure) => figure.label)?.label;

  if (!firstLabel) {
    return "fig:combined-subfigures";
  }

  return `${firstLabel}-combined`;
}

function findMatchingClosingBrace(text: string, openBraceIndex: number): number {
  let depth = 0;

  for (let index = openBraceIndex; index < text.length; index += 1) {
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
