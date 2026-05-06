export interface WrapFigureConfiguration {
  addPackage: boolean;
  includeGraphicsWidth: string;
  position: string;
  updateIncludeGraphicsWidth: boolean;
  width: string;
}

export interface WrapFigureTransformResult {
  error?: string;
  text?: string;
}

const figureEnvironmentPattern = /\\begin\s*\{figure\}\s*(?:\[[^\]]*\])?([\s\S]*?)\\end\s*\{figure\}/g;
const includeGraphicsPattern = /\\includegraphics\b/;

export function transformSelectionToWrapFigure(
  selectedText: string,
  configuration: WrapFigureConfiguration
): WrapFigureTransformResult {
  if (selectedText.trim().length === 0) {
    return {
      error: "select a LaTeX paragraph or image block before converting it to wrapfigure."
    };
  }

  if (/\\begin\s*\{wrapfigure\}/.test(selectedText)) {
    return {
      error: "the selected text already contains a wrapfigure environment."
    };
  }

  if (!includeGraphicsPattern.test(selectedText)) {
    return {
      error: "the selected text must contain an \\includegraphics command."
    };
  }

  let convertedFigureEnvironment = false;
  const figureConvertedText = selectedText.replace(
    figureEnvironmentPattern,
    (_match, content: string) => {
      convertedFigureEnvironment = true;
      return buildWrapFigure(content, configuration);
    }
  );

  if (convertedFigureEnvironment) {
    return {
      text: figureConvertedText
    };
  }

  return {
    text: wrapFirstIncludeGraphicsBlock(selectedText, configuration)
  };
}

function wrapFirstIncludeGraphicsBlock(
  selectedText: string,
  configuration: WrapFigureConfiguration
): string {
  const lineBreak = selectedText.includes("\r\n") ? "\r\n" : "\n";
  const lines = selectedText.split(/\r?\n/);
  const includeGraphicsLineIndex = lines.findIndex((line) => includeGraphicsPattern.test(line));

  if (includeGraphicsLineIndex < 0) {
    return selectedText;
  }

  const blockStart = findGraphicsBlockStart(lines, includeGraphicsLineIndex);
  const blockEnd = findGraphicsBlockEnd(lines, includeGraphicsLineIndex);
  const block = lines.slice(blockStart, blockEnd + 1).join(lineBreak);
  const centeredBlock = ensureCentering(block);
  const wrapFigure = buildWrapFigure(centeredBlock, configuration);

  return [
    ...lines.slice(0, blockStart),
    wrapFigure,
    ...lines.slice(blockEnd + 1)
  ].join(lineBreak);
}

function findGraphicsBlockStart(lines: string[], includeGraphicsLineIndex: number): number {
  let blockStart = includeGraphicsLineIndex;

  while (blockStart > 0 && isGraphicsPrefixLine(lines[blockStart - 1])) {
    blockStart -= 1;
  }

  return blockStart;
}

function findGraphicsBlockEnd(lines: string[], includeGraphicsLineIndex: number): number {
  let blockEnd = includeGraphicsLineIndex;

  while (blockEnd + 1 < lines.length && isGraphicsSuffixLine(lines[blockEnd + 1])) {
    blockEnd += 1;
  }

  return blockEnd;
}

function isGraphicsPrefixLine(line: string): boolean {
  return /^\s*\\centering\b/.test(line);
}

function isGraphicsSuffixLine(line: string): boolean {
  return /^\s*\\(?:caption|label)\b/.test(line);
}

function ensureCentering(block: string): string {
  if (/\\centering\b/.test(block)) {
    return block;
  }

  return `  \\centering\n${block}`;
}

function buildWrapFigure(content: string, configuration: WrapFigureConfiguration): string {
  const adjustedContent = configuration.updateIncludeGraphicsWidth
    ? updateIncludeGraphicsWidth(content, configuration.includeGraphicsWidth)
    : content;
  const normalizedContent = normalizeWrapFigureContent(adjustedContent);

  return `\\begin{wrapfigure}{${configuration.position}}{${configuration.width}}${normalizedContent}\\end{wrapfigure}`;
}

function normalizeWrapFigureContent(content: string): string {
  let normalized = content;

  if (!normalized.startsWith("\n") && !normalized.startsWith("\r\n")) {
    normalized = `\n${normalized}`;
  }

  if (!normalized.endsWith("\n")) {
    normalized = `${normalized}\n`;
  }

  return normalized;
}

function updateIncludeGraphicsWidth(content: string, width: string): string {
  return content.replace(
    /\\includegraphics(\s*)(?:\[([^\]]*)\])?(\s*)\{/g,
    (_match, beforeOptions: string, options: string | undefined, beforePath: string) => {
      const nextOptions = updateGraphicsOptions(options, width);

      return `\\includegraphics${beforeOptions}[${nextOptions}]${beforePath}{`;
    }
  );
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
