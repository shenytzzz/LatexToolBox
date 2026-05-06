export type MathSymbolReplacements = Record<string, string>;

export interface MathSymbolReplacementMatch {
  replacement: string;
  startCharacter: number;
  trigger: string;
}

const defaultMathEnvironments = new Set([
  "align",
  "align*",
  "aligned",
  "alignedat",
  "array",
  "bmatrix",
  "Bmatrix",
  "cases",
  "displaymath",
  "eqnarray",
  "eqnarray*",
  "equation",
  "equation*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "gathered",
  "math",
  "matrix",
  "multline",
  "multline*",
  "pmatrix",
  "smallmatrix",
  "split",
  "subarray",
  "vmatrix",
  "Vmatrix"
]);

export function findMathSymbolReplacement(
  linePrefix: string,
  replacements: MathSymbolReplacements
): MathSymbolReplacementMatch | undefined {
  const triggers = Object.keys(replacements)
    .filter((trigger) => trigger.length > 0 && replacements[trigger].length > 0)
    .sort((left, right) => right.length - left.length);

  for (const trigger of triggers) {
    if (linePrefix.endsWith(trigger)) {
      return {
        replacement: replacements[trigger],
        startCharacter: linePrefix.length - trigger.length,
        trigger
      };
    }
  }

  return undefined;
}

export function normalizeMathSymbolReplacements(value: unknown): MathSymbolReplacements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: MathSymbolReplacements = {};

  for (const [trigger, replacement] of Object.entries(value)) {
    if (typeof replacement === "string" && trigger.length > 0 && replacement.length > 0) {
      normalized[trigger] = replacement;
    }
  }

  return normalized;
}

export function isInLatexMath(textBeforePosition: string): boolean {
  const state = {
    bracketMathDepth: 0,
    displayDollarMath: false,
    environmentMathDepth: 0,
    inlineDollarMath: false,
    parenMathDepth: 0
  };
  let inComment = false;

  for (let index = 0; index < textBeforePosition.length; index += 1) {
    const char = textBeforePosition[index];

    if (inComment) {
      if (char === "\n") {
        inComment = false;
      }

      continue;
    }

    if (char === "%" && !isEscaped(textBeforePosition, index)) {
      inComment = true;
      continue;
    }

    if (char === "\\" && !isEscaped(textBeforePosition, index)) {
      if (textBeforePosition.startsWith("\\(", index)) {
        state.parenMathDepth += 1;
        index += 1;
        continue;
      }

      if (textBeforePosition.startsWith("\\)", index)) {
        state.parenMathDepth = Math.max(0, state.parenMathDepth - 1);
        index += 1;
        continue;
      }

      if (textBeforePosition.startsWith("\\[", index)) {
        state.bracketMathDepth += 1;
        index += 1;
        continue;
      }

      if (textBeforePosition.startsWith("\\]", index)) {
        state.bracketMathDepth = Math.max(0, state.bracketMathDepth - 1);
        index += 1;
        continue;
      }

      const beginEnvironment = readEnvironmentCommand(textBeforePosition, index, "\\begin");

      if (beginEnvironment) {
        if (defaultMathEnvironments.has(beginEnvironment.name)) {
          state.environmentMathDepth += 1;
        }

        index = beginEnvironment.endIndex - 1;
        continue;
      }

      const endEnvironment = readEnvironmentCommand(textBeforePosition, index, "\\end");

      if (endEnvironment) {
        if (defaultMathEnvironments.has(endEnvironment.name)) {
          state.environmentMathDepth = Math.max(0, state.environmentMathDepth - 1);
        }

        index = endEnvironment.endIndex - 1;
        continue;
      }
    }

    if (char === "$" && !isEscaped(textBeforePosition, index)) {
      if (textBeforePosition[index + 1] === "$") {
        state.displayDollarMath = !state.displayDollarMath;
        index += 1;
        continue;
      }

      state.inlineDollarMath = !state.inlineDollarMath;
    }
  }

  return state.inlineDollarMath
    || state.displayDollarMath
    || state.parenMathDepth > 0
    || state.bracketMathDepth > 0
    || state.environmentMathDepth > 0;
}

function readEnvironmentCommand(
  text: string,
  index: number,
  command: "\\begin" | "\\end"
): { endIndex: number; name: string } | undefined {
  if (!text.startsWith(command, index)) {
    return undefined;
  }

  let cursor = index + command.length;

  while (/\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }

  if (text[cursor] !== "{") {
    return undefined;
  }

  const closeIndex = text.indexOf("}", cursor + 1);

  if (closeIndex < 0) {
    return undefined;
  }

  return {
    endIndex: closeIndex + 1,
    name: text.slice(cursor + 1, closeIndex)
  };
}

function isEscaped(text: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}
