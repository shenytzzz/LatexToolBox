import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ElectronNativeImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

interface ElectronClipboard {
  readBuffer?(format: string): Buffer;
  readImage(): ElectronNativeImage;
}

interface ElectronModule {
  clipboard?: ElectronClipboard;
}

const macClipboardImageScript = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

const pasteboard = $.NSPasteboard.generalPasteboard;

function encodePngData(data) {
  if (!data) {
    return null;
  }

  return data.base64EncodedStringWithOptions(0).js;
}

function encodeBitmapData(data) {
  if (!data) {
    return null;
  }

  const bitmap = $.NSBitmapImageRep.imageRepWithData(data);

  if (!bitmap) {
    return null;
  }

  const pngData = bitmap.representationUsingTypeProperties(
    $.NSBitmapImageFileTypePNG,
    Ref()
  );

  return encodePngData(pngData);
}

function dataForType(type) {
  try {
    return pasteboard.dataForType(type);
  } catch (_error) {
    return null;
  }
}

const pngTypes = [
  "public.png",
  "PNG",
  "Apple PNG pasteboard type"
];

for (const type of pngTypes) {
  const encoded = encodePngData(dataForType(type));

  if (encoded) {
    encoded;
    return;
  }
}

const bitmapTypes = [
  "public.tiff",
  "com.apple.tiff",
  "TIFF",
  "NeXT TIFF v4.0 pasteboard type"
];

for (const type of bitmapTypes) {
  const encoded = encodeBitmapData(dataForType(type));

  if (encoded) {
    encoded;
    return;
  }
}

try {
  const objects = pasteboard.readObjectsForClassesOptions(
    [$.NSImage],
    Ref()
  );

  if (objects && objects.count > 0) {
    const image = objects.objectAtIndex(0);
    const encoded = encodeBitmapData(image.TIFFRepresentation);

    if (encoded) {
      encoded;
      return;
    }
  }
} catch (_error) {
}

throw new Error("No image found in the clipboard.");
`;

const macClipboardInfoScript = String.raw`
ObjC.import("AppKit");

const pasteboard = $.NSPasteboard.generalPasteboard;
const types = [];

try {
  const pasteboardTypes = pasteboard.types;

  if (pasteboardTypes) {
    for (let index = 0; index < pasteboardTypes.count; index += 1) {
      types.push(ObjC.unwrap(pasteboardTypes.objectAtIndex(index)));
    }
  }
} catch (_error) {
}

JSON.stringify(types);
`;

const macAppleScriptClipboardImageScript = `
on run argv
  set pngPath to item 1 of argv
  set tiffPath to item 2 of argv

  try
    set imageData to the clipboard as \u00abclass PNGf\u00bb
    my writeBinaryFile(pngPath, imageData)
    return "png"
  on error
    try
      set imageData to the clipboard as TIFF picture
      my writeBinaryFile(tiffPath, imageData)
      return "tiff"
    on error
      error "No image found in the clipboard."
    end try
  end try
end run

on writeBinaryFile(outputPath, imageData)
  set outputFile to open for access POSIX file outputPath with write permission
  try
    set eof of outputFile to 0
    write imageData to outputFile
    close access outputFile
  on error errorMessage
    try
      close access outputFile
    end try
    error errorMessage
  end try
end writeBinaryFile
`;

export async function readClipboardImageAsPng(): Promise<Buffer> {
  if (process.platform !== "darwin") {
    throw new Error("Clipboard image insertion is currently supported on macOS only.");
  }

  // Prefer raw macOS pasteboard data so VS Code/Electron theme rendering cannot
  // affect the saved image colors.
  const appleScriptImage = await readClipboardImageWithAppleScript();

  if (appleScriptImage) {
    return appleScriptImage;
  }

  const macPasteboardImage = await readClipboardImageWithMacPasteboard();

  if (macPasteboardImage) {
    return macPasteboardImage;
  }

  const electronImage = readClipboardImageWithElectron();

  if (electronImage) {
    return electronImage;
  }

  throw new Error(await normalizeClipboardError(new Error("No image found in the clipboard.")));
}

function readClipboardImageWithElectron(): Buffer | undefined {
  try {
    const electron = require("electron") as ElectronModule;
    const clipboard = electron.clipboard;

    if (!clipboard) {
      return undefined;
    }

    const directPng = clipboard.readBuffer?.("public.png");

    if (directPng && directPng.length > 0) {
      return directPng;
    }

    const image = clipboard.readImage();

    if (image && !image.isEmpty()) {
      const png = image.toPNG();

      if (png.length > 0) {
        return png;
      }
    }
  } catch (_error) {
    return undefined;
  }

  return undefined;
}

async function readClipboardImageWithAppleScript(): Promise<Buffer | undefined> {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "latextoolbox-clipboard-"));
  const pngPath = path.join(temporaryDirectory, "clipboard.png");
  const tiffPath = path.join(temporaryDirectory, "clipboard.tiff");

  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      macAppleScriptClipboardImageScript,
      pngPath,
      tiffPath
    ], {
      maxBuffer: 1024 * 1024
    });
    const format = stdout.trim();

    if (format === "png") {
      return await fs.readFile(pngPath);
    }

    if (format === "tiff") {
      await execFileAsync("sips", [
        "-s",
        "format",
        "png",
        tiffPath,
        "--out",
        pngPath
      ], {
        maxBuffer: 1024 * 1024
      });

      return await fs.readFile(pngPath);
    }
  } catch (_error) {
    return undefined;
  } finally {
    await fs.rm(temporaryDirectory, { force: true, recursive: true });
  }

  return undefined;
}

async function readClipboardImageWithMacPasteboard(): Promise<Buffer | undefined> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      macClipboardImageScript
    ], {
      maxBuffer: 64 * 1024 * 1024
    });

    const base64 = stdout.trim();

    if (!base64) {
      throw new Error("No image found in the clipboard.");
    }

    return Buffer.from(base64, "base64");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("No image found")) {
      return undefined;
    }

    throw new Error(await normalizeClipboardError(error));
  }
}

async function normalizeClipboardError(error: unknown): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("No image found")) {
    const types = await readClipboardTypesForErrorMessage();

    if (types.length > 0) {
      return `No PNG/TIFF image data found in the clipboard. Clipboard types: ${types.join(", ")}.`;
    }

    return "No image found in the clipboard. If you copied from a browser or Preview, try copying the image itself rather than a web page selection.";
  }

  if (message.includes("not allowed assistive access") || message.includes("Operation not permitted")) {
    return "macOS denied clipboard access. Allow VS Code to access the clipboard and try again.";
  }

  return message || "Failed to read an image from the clipboard.";
}

async function readClipboardTypesForErrorMessage(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      macClipboardInfoScript
    ]);
    const parsed = JSON.parse(stdout.trim()) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch (_error) {
    return [];
  }

  return [];
}
