import * as path from "node:path";

export function makeTimestampedPngName(date = new Date()): string {
  return `pasted-${formatDatePart(date)}-${formatTimePart(date)}.png`;
}

export function toLatexRelativePath(fromDirectory: string, toFile: string): string {
  return path.relative(fromDirectory, toFile).split(path.sep).join("/");
}

export function stripPngExtension(fileName: string): string {
  return fileName.replace(/\.png$/i, "");
}

function formatDatePart(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return `${year}${month}${day}`;
}

function formatTimePart(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");

  return `${hours}${minutes}${seconds}`;
}
