"use client";

import { CSSProperties, ChangeEvent, ClipboardEvent, Fragment, KeyboardEvent, PointerEvent, useMemo, useRef, useState } from "react";
import * as UTIF from "utif";
import * as XLSX from "xlsx";

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"]);
const xlsxExtensions = new Set(["xlsx", "xlsm", "xls"]);
const defaultLayers = ["A", "B", "C", "D", "E", "F"];
const frameRate = 24;
const popupMinTop = 12;
const popupMinLeft = 12;

type ImageEntry = {
  file: File;
  name: string;
  url: string;
  selected: boolean;
};

type TimesheetData = {
  title: string;
  frameCount: number;
  sections: TimesheetSection[];
};

type TimesheetSection = {
  id: "genga" | "douga";
  label: string;
  cells: string[][];
  layers: string[];
};

type RawSheet = {
  sheetName: string;
  cells: Map<string, string | number>;
  maxRow: number;
  maxCol: number;
};

type CfbContainer = {
  FullPaths: string[];
  FileIndex: Array<{ content?: Uint8Array }>;
};

type PopupPosition = {
  x: number;
  y: number;
};

type ImagePanelMode = "dock" | "popup" | "hidden";

type TimesheetCellCoordinate = {
  rowIndex: number;
  colIndex: number;
  sectionId: TimesheetSection["id"];
  layerIndex: number;
};

type CellSelection = {
  anchor: TimesheetCellCoordinate;
  focus: TimesheetCellCoordinate;
};

type CellSelectionBounds = {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
};

type RepeatDirective = {
  frame: number;
  start: number;
  end: number;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function fileExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function isImageFile(file: File) {
  return imageExtensions.has(fileExtension(file));
}

function isWorkbookFile(file: File) {
  return xlsxExtensions.has(fileExtension(file));
}

function isTextFile(file: File) {
  return fileExtension(file) === "txt";
}

function fileDisplayName(file: File) {
  return file.webkitRelativePath || file.name;
}

function fileIdentity(file: File) {
  return `${fileDisplayName(file)}:${file.size}:${file.lastModified}`;
}

function isTiffFile(file: File) {
  const extension = fileExtension(file);
  return extension === "tif" || extension === "tiff";
}

async function previewUrlForImage(file: File) {
  if (!isTiffFile(file)) {
    return URL.createObjectURL(file);
  }

  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  const ifd = ifds[0];
  if (!ifd) {
    throw new Error("TIFF の画像データが見つかりませんでした。");
  }

  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const width = ifd.width;
  const height = ifd.height;
  if (!width || !height) {
    throw new Error("TIFF のサイズを取得できませんでした。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("プレビュー用 canvas を作成できませんでした。");
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("TIFF プレビューの変換に失敗しました。"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
}

function initialCells(frameCount: number, layerCount: number) {
  return Array.from({ length: frameCount }, () => Array.from({ length: layerCount }, () => ""));
}

function createSection(id: TimesheetSection["id"], label: string, frameCount: number, layers = defaultLayers): TimesheetSection {
  return {
    id,
    label,
    layers,
    cells: initialCells(frameCount, layers.length),
  };
}

function layerNameForIndex(index: number) {
  return index < 26 ? String.fromCharCode("A".charCodeAt(0) + index) : `L${index + 1}`;
}

function uniqueLayerName(layers: string[], preferredName: string) {
  if (!layers.includes(preferredName)) {
    return preferredName;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${preferredName}${index}`;
    if (!layers.includes(candidate)) {
      return candidate;
    }
  }

  return `${preferredName}_${Date.now()}`;
}

function insertedLayerName(layers: string[], insertIndex: number) {
  const baseName = layers[insertIndex] || layers[Math.max(0, insertIndex - 1)] || layerNameForIndex(insertIndex);
  return uniqueLayerName(layers, `${baseName}_un`);
}

function createBlankTimesheet(frameCount = 0): TimesheetData {
  return {
    title: "タイムシート",
    frameCount,
    sections: [createSection("genga", "原画", frameCount), createSection("douga", "動画", frameCount)],
  };
}

function cellKey(rowIndex: number, colIndex: number) {
  return `${rowIndex}:${colIndex}`;
}

function clampSheetName(value: string) {
  const sanitized = value.replace(/[\[\]:*?/\\]/g, "_").trim();
  return (sanitized || "タイムシート").slice(0, 31);
}

function normalizeCells(cells: string[][], frameCount: number, layerCount: number) {
  return Array.from({ length: frameCount }, (_, rowIndex) =>
    Array.from({ length: layerCount }, (_, colIndex) => cells[rowIndex]?.[colIndex] ?? ""),
  );
}

function normalizeSection(section: TimesheetSection, frameCount: number): TimesheetSection {
  return {
    ...section,
    cells: normalizeCells(section.cells, frameCount, section.layers.length),
  };
}

function synchronizeLayerNames(timesheet: TimesheetData): TimesheetData {
  const gengaSection = timesheet.sections.find((section) => section.id === "genga");
  const maxLayerCount = Math.max(1, ...timesheet.sections.map((section) => section.layers.length));
  const layers = Array.from({ length: maxLayerCount }, (_, layerIndex) => {
    return (
      gengaSection?.layers[layerIndex] ||
      timesheet.sections.find((section) => section.layers[layerIndex])?.layers[layerIndex] ||
      layerNameForIndex(layerIndex)
    );
  });

  return {
    ...timesheet,
    sections: timesheet.sections.map((section) => ({
      ...section,
      layers,
      cells: normalizeCells(section.cells, timesheet.frameCount, layers.length),
    })),
  };
}

function parseRepeatDirective(value: string): Omit<RepeatDirective, "frame"> | null {
  const match = value.match(/^r\(\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (!match) {
    return null;
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return { start, end };
}

function convertGengaCells(cells: string[][], frameCount: number, layerCount: number) {
  const leftOutput = initialCells(frameCount, layerCount);
  const rightOutput = initialCells(frameCount, layerCount);

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    const directSymbols = new Map<number, string>();
    const repeatDirectives: RepeatDirective[] = [];
    const instructionFramesSet = new Set<number>();

    for (let rowIndex = 0; rowIndex < frameCount; rowIndex += 1) {
      const frame = rowIndex + 1;
      const cell = valueToText(cells[rowIndex]?.[layerIndex]).trim();
      if (!cell) {
        continue;
      }

      const repeatDirective = parseRepeatDirective(cell);
      if (repeatDirective) {
        repeatDirectives.push({ frame, ...repeatDirective });
        instructionFramesSet.add(frame);
        continue;
      }

      directSymbols.set(frame, cell);
      instructionFramesSet.add(frame);
    }

    const leftLayer = Array.from({ length: frameCount + 1 }, () => "");
    const repeatBaseFrame: Array<number | null> = Array.from({ length: frameCount + 1 }, () => null);

    for (let frame = 1; frame <= frameCount; frame += 1) {
      const symbol = directSymbols.get(frame);
      if (symbol !== undefined) {
        leftLayer[frame] = symbol;
      }
    }

    const instructionFrames = Array.from(instructionFramesSet).sort((a, b) => a - b);
    const findNextInstructionFrame = (currentFrame: number) => instructionFrames.find((frame) => frame > currentFrame) ?? frameCount + 1;

    for (const directive of repeatDirectives.sort((a, b) => a.frame - b.frame)) {
      const patternLength = directive.end - directive.start + 1;
      if (patternLength <= 0) {
        continue;
      }

      const repeatEnd = Math.min(findNextInstructionFrame(directive.frame) - 1, frameCount);
      for (let frame = directive.frame; frame <= repeatEnd; frame += 1) {
        if (directSymbols.has(frame)) {
          continue;
        }

        const baseFrame = directive.start + ((frame - directive.frame) % patternLength);
        if (baseFrame < 1 || baseFrame > frameCount) {
          continue;
        }

        leftLayer[frame] = leftLayer[baseFrame];
        repeatBaseFrame[frame] = baseFrame;
      }
    }

    const rightLayer: Array<string | number> = Array.from({ length: frameCount + 1 }, () => "");
    const valueToNumberMap = new Map<string, number>();
    let counter = 0;
    let lastNumber: number | null = null;
    let pendingDotNumber: number | null = null;

    for (let frame = 1; frame <= frameCount; frame += 1) {
      if (repeatBaseFrame[frame] !== null) {
        continue;
      }

      const symbol = leftLayer[frame];
      if (!symbol) {
        rightLayer[frame] = "";
      } else if (symbol === "x" || symbol === "×") {
        rightLayer[frame] = symbol;
      } else if (symbol === ".") {
        const nextNumber: number = lastNumber !== null ? lastNumber + 1 : counter + 1;
        counter = Math.max(counter, nextNumber);
        rightLayer[frame] = nextNumber;
        lastNumber = nextNumber;
        pendingDotNumber = nextNumber + 1;
      } else {
        const existingNumber = valueToNumberMap.get(symbol);
        if (existingNumber !== undefined) {
          rightLayer[frame] = existingNumber;
          lastNumber = existingNumber;
        } else {
          const nextNumber: number = pendingDotNumber ?? counter + 1;
          counter = nextNumber;
          valueToNumberMap.set(symbol, nextNumber);
          rightLayer[frame] = nextNumber;
          lastNumber = nextNumber;
          pendingDotNumber = null;
        }
      }
    }

    for (let frame = 1; frame <= frameCount; frame += 1) {
      const baseFrame = repeatBaseFrame[frame];
      if (baseFrame !== null) {
        rightLayer[frame] = rightLayer[baseFrame];
      }
    }

    for (let frame = 1; frame <= frameCount; frame += 1) {
      const rowIndex = frame - 1;
      leftOutput[rowIndex][layerIndex] = leftLayer[frame] ?? "";
      rightOutput[rowIndex][layerIndex] = valueToText(rightLayer[frame]);
    }
  }

  return { leftOutput, rightOutput };
}

function convertGengaToDouga(timesheet: TimesheetData): TimesheetData {
  const syncedTimesheet = synchronizeLayerNames(timesheet);
  const gengaSection = syncedTimesheet.sections.find((section) => section.id === "genga") ?? createSection("genga", "原画", syncedTimesheet.frameCount);
  const { leftOutput, rightOutput } = convertGengaCells(gengaSection.cells, syncedTimesheet.frameCount, gengaSection.layers.length);

  return {
    ...syncedTimesheet,
    sections: syncedTimesheet.sections.map((section) => ({
      ...section,
      cells: section.id === "genga" ? leftOutput : rightOutput,
    })),
  };
}

function valueToText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function sheetToRaw(sheetName: string, sheet: XLSX.WorkSheet): RawSheet | null {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) {
    return null;
  }

  const cells = new Map<string, string | number>();
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const value = sheet[address]?.v;
      if (value !== undefined && value !== null && value !== "") {
        cells.set(cellKey(row, col), value as string | number);
      }
    }
  }

  return { sheetName, cells, maxRow: range.e.r, maxCol: range.e.c };
}

function parseXmlText(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function xmlFileText(cfb: CfbContainer, pattern: string) {
  const index = cfb.FullPaths.findIndex((path) => path.endsWith(pattern));
  const content = index >= 0 ? cfb.FileIndex[index]?.content : null;
  return content ? new TextDecoder().decode(content as Uint8Array) : "";
}

function getCellReferenceParts(reference: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference);
  if (!match) {
    return null;
  }
  return {
    col: XLSX.utils.decode_col(match[1].toUpperCase()),
    row: Number(match[2]) - 1,
  };
}

function rawFromWorkbookXml(buffer: ArrayBuffer): RawSheet | null {
  const cfb = XLSX.CFB.read(new Uint8Array(buffer), { type: "array" }) as CfbContainer;
  const workbookXml = xmlFileText(cfb, "xl/workbook.xml");
  const sharedStringsXml = xmlFileText(cfb, "xl/sharedStrings.xml");
  const sheetPath = cfb.FullPaths.find((path) => /xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!workbookXml || !sheetPath) {
    return null;
  }

  const workbook = parseXmlText(workbookXml);
  const sheetName = workbook.getElementsByTagName("sheet")[0]?.getAttribute("name") ?? "タイムシート";
  const sharedStrings = sharedStringsXml
    ? Array.from(parseXmlText(sharedStringsXml).getElementsByTagName("si")).map((item) =>
        Array.from(item.getElementsByTagName("t"))
          .map((text) => text.textContent ?? "")
          .join(""),
      )
    : [];

  const sheetXml = new TextDecoder().decode(cfb.FileIndex[cfb.FullPaths.indexOf(sheetPath)].content as Uint8Array);
  const sheet = parseXmlText(sheetXml);
  const cells = new Map<string, string | number>();
  let maxRow = 0;
  let maxCol = 0;

  for (const cell of Array.from(sheet.getElementsByTagName("c"))) {
    const reference = cell.getAttribute("r");
    const parts = reference ? getCellReferenceParts(reference) : null;
    if (!parts) {
      continue;
    }
    const valueNode = cell.getElementsByTagName("v")[0];
    const rawValue = valueNode?.textContent ?? "";
    const value = cell.getAttribute("t") === "s" ? sharedStrings[Number(rawValue)] ?? "" : rawValue;
    if (value !== "") {
      cells.set(cellKey(parts.row, parts.col), Number.isFinite(Number(value)) && value.trim() !== "" ? Number(value) : value);
      maxRow = Math.max(maxRow, parts.row);
      maxCol = Math.max(maxCol, parts.col);
    }
  }

  return { sheetName, cells, maxRow, maxCol };
}

async function readRawSheet(file: File): Promise<RawSheet | null> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0] ?? "タイムシート";
  const sheet = workbook.Sheets[sheetName] ?? workbook.Sheets[Object.keys(workbook.Sheets)[0]];
  const raw = sheet ? sheetToRaw(sheetName, sheet) : null;
  return raw ?? rawFromWorkbookXml(buffer);
}

function rowValues(raw: RawSheet, rowIndex: number) {
  return Array.from({ length: raw.maxCol + 1 }, (_, colIndex) => raw.cells.get(cellKey(rowIndex, colIndex)) ?? "");
}

function findFrameHeaderRow(raw: RawSheet) {
  for (let row = 0; row <= Math.min(raw.maxRow, 8); row += 1) {
    if (rowValues(raw, row).some((value) => valueToText(value).trim() === "フレーム")) {
      return row;
    }
  }
  return 0;
}

function parseSectionFromRaw(
  raw: RawSheet,
  headers: string[],
  dataStartRow: number,
  frameColumn: number,
  nextFrameColumn: number | undefined,
  id: TimesheetSection["id"],
  label: string,
  frameCount: number,
) {
  const layerStart = frameColumn + 1;
  const fallbackEnd = Math.max(layerStart, headers.findLastIndex((value) => value.trim() !== ""));
  const layerEnd = nextFrameColumn !== undefined ? nextFrameColumn - 1 : fallbackEnd;
  const parsedLayers = headers
    .slice(layerStart, layerEnd + 1)
    .map((value, index) => value.trim() || `${label}${index + 1}`)
    .filter(Boolean);
  const layers = parsedLayers.length > 0 ? parsedLayers : defaultLayers;
  return {
    id,
    label,
    layers,
    cells: Array.from({ length: frameCount }, (_, rowOffset) =>
      layers.map((_, layerIndex) => valueToText(raw.cells.get(cellKey(dataStartRow + rowOffset, layerStart + layerIndex)))),
    ),
  };
}

function countTimingDataRows(raw: RawSheet, dataStartRow: number, columnStart: number, columnEnd: number) {
  let lastDataRow = dataStartRow - 1;
  for (let row = dataStartRow; row <= raw.maxRow; row += 1) {
    for (let col = columnStart; col <= columnEnd; col += 1) {
      const value = raw.cells.get(cellKey(row, col));
      if (valueToText(value).trim() !== "") {
        lastDataRow = row;
        break;
      }
    }
  }

  return Math.max(0, lastDataRow - dataStartRow + 1);
}

function parseTimesheet(raw: RawSheet): TimesheetData {
  const headerRow = findFrameHeaderRow(raw);
  const titleValue = headerRow > 0 ? valueToText(raw.cells.get(cellKey(0, 0))).trim() : "";
  const headers = rowValues(raw, headerRow).map(valueToText);
  const frameColumns = headers.flatMap((value, index) => (value.trim() === "フレーム" ? [index] : []));
  const gengaFrameColumn = frameColumns[0] ?? 0;
  const dougaFrameColumn = frameColumns[1];

  const dataStartRow = headerRow + 1;
  const frameRows: number[] = [];
  let maxFrameNumber = 0;
  for (let row = dataStartRow; row <= raw.maxRow; row += 1) {
    const frameValue = raw.cells.get(cellKey(row, gengaFrameColumn));
    if (frameValue !== undefined && frameValue !== "") {
      frameRows.push(row);
      const frameNumber = Number(frameValue);
      if (Number.isFinite(frameNumber)) {
        maxFrameNumber = Math.max(maxFrameNumber, Math.floor(frameNumber));
      }
    }
  }

  const timingDataRowCount = countTimingDataRows(raw, dataStartRow, gengaFrameColumn, raw.maxCol);
  const frameCount = Math.max(frameRows.length, maxFrameNumber, timingDataRowCount);
  const gengaSection = parseSectionFromRaw(
    raw,
    headers,
    dataStartRow,
    gengaFrameColumn,
    dougaFrameColumn,
    "genga",
    "原画",
    frameCount,
  );
  const dougaSection =
    dougaFrameColumn !== undefined
      ? parseSectionFromRaw(raw, headers, dataStartRow, dougaFrameColumn, undefined, "douga", "動画", frameCount)
      : createSection("douga", "動画", frameCount, defaultLayers);

  return {
    title: titleValue || raw.sheetName || "タイムシート",
    frameCount,
    sections: [gengaSection, dougaSection],
  };
}

function buildWorkbook(timesheet: TimesheetData) {
  const syncedTimesheet = synchronizeLayerNames(timesheet);
  const gengaSection = syncedTimesheet.sections.find((section) => section.id === "genga") ?? createSection("genga", "原画", syncedTimesheet.frameCount);
  const dougaSection = syncedTimesheet.sections.find((section) => section.id === "douga") ?? createSection("douga", "動画", syncedTimesheet.frameCount);
  const rows = [
    ["フレーム", ...gengaSection.layers, "フレーム", ...gengaSection.layers],
    ...Array.from({ length: syncedTimesheet.frameCount }, (_, rowIndex) => [
      rowIndex + 1,
      ...gengaSection.layers.map((_, layerIndex) => gengaSection.cells[rowIndex]?.[layerIndex] ?? ""),
      rowIndex + 1,
      ...dougaSection.layers.map((_, layerIndex) => dougaSection.cells[rowIndex]?.[layerIndex] ?? ""),
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 8 },
    ...gengaSection.layers.map(() => ({ wch: 5 })),
    { wch: 8 },
    ...dougaSection.layers.map(() => ({ wch: 5 })),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, clampSheetName(syncedTimesheet.title));
  return workbook;
}

export function TimesheetEditor() {
  const [timesheet, setTimesheet] = useState<TimesheetData>(() => createBlankTimesheet());
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [additionalFrames, setAdditionalFrames] = useState(0);
  const [secondsDraft, setSecondsDraft] = useState("0");
  const [additionalFramesDraft, setAdditionalFramesDraft] = useState("0");
  const [cellZoom, setCellZoom] = useState(1);
  const [imageZoom, setImageZoom] = useState(1);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ x: 80, y: 80 });
  const [popupDragStart, setPopupDragStart] = useState<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [imagePanelMode, setImagePanelMode] = useState<ImagePanelMode>("dock");
  const [deleteLayerIndex, setDeleteLayerIndex] = useState(defaultLayers.length - 1);
  const [cellSelection, setCellSelection] = useState<CellSelection | null>(null);
  const [cellSelectionActive, setCellSelectionActive] = useState(false);
  const [workbookCandidates, setWorkbookCandidates] = useState<File[]>([]);
  const [selectedWorkbookKey, setSelectedWorkbookKey] = useState("");
  const [textNotes, setTextNotes] = useState("");
  const [status, setStatus] = useState("タイムシート入力アプリのフォルダを読み込んでください。");
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const skipCellFocusSelectionRef = useRef(false);

  const selectedImages = useMemo(() => images.filter((image) => image.selected), [images]);
  const layerOptions = useMemo(
    () => synchronizeLayerNames(timesheet).sections.find((section) => section.id === "genga")?.layers ?? defaultLayers,
    [timesheet],
  );
  const safeDeleteLayerIndex = Math.min(deleteLayerIndex, Math.max(0, layerOptions.length - 1));
  const selectedWorkbookFile = workbookCandidates.find((file) => fileIdentity(file) === selectedWorkbookKey) ?? workbookCandidates[0] ?? null;
  const gengaLayerCount = timesheet.sections.find((section) => section.id === "genga")?.layers.length ?? 0;
  const selectedCellCount = useMemo(() => {
    if (!cellSelection) {
      return 0;
    }
    const rowCount = Math.abs(cellSelection.anchor.rowIndex - cellSelection.focus.rowIndex) + 1;
    const colCount = Math.abs(cellSelection.anchor.colIndex - cellSelection.focus.colIndex) + 1;
    return rowCount * colCount;
  }, [cellSelection]);

  function syncDurationFromFrameCount(frameCount: number) {
    const nextSeconds = Math.floor(frameCount / frameRate);
    const nextAdditionalFrames = frameCount % frameRate;
    setSeconds(nextSeconds);
    setAdditionalFrames(nextAdditionalFrames);
    setSecondsDraft(String(nextSeconds));
    setAdditionalFramesDraft(String(nextAdditionalFrames));
  }

  function updateDuration(nextSeconds: number, nextAdditionalFrames: number) {
    const safeSeconds = Math.max(0, Math.floor(nextSeconds));
    const safeFrames = Math.max(0, Math.floor(nextAdditionalFrames));
    setSeconds(safeSeconds);
    setAdditionalFrames(safeFrames);
    setTimesheet((previous) => {
      const nextFrameCount = Math.max(0, safeSeconds * frameRate + safeFrames);
      return {
        ...previous,
        frameCount: nextFrameCount,
        sections: previous.sections.map((section) => normalizeSection(section, nextFrameCount)),
      };
    });
  }

  function applyDurationDraft() {
    const parsedSeconds = Number(secondsDraft.trim());
    const parsedAdditionalFrames = Number(additionalFramesDraft.trim());
    if (
      secondsDraft.trim() === "" ||
      additionalFramesDraft.trim() === "" ||
      !Number.isFinite(parsedSeconds) ||
      !Number.isFinite(parsedAdditionalFrames)
    ) {
      setSecondsDraft(String(seconds));
      setAdditionalFramesDraft(String(additionalFrames));
      return;
    }
    updateDuration(parsedSeconds, parsedAdditionalFrames);
  }

  function updateCell(sectionId: TimesheetSection["id"], rowIndex: number, layerIndex: number, value: string) {
    setTimesheet((previous) => ({
      ...previous,
      sections: previous.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              cells: section.cells.map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                  ? row.map((cell, currentLayerIndex) => (currentLayerIndex === layerIndex ? value : cell))
                  : row,
              ),
            }
          : section,
      ),
    }));
  }

  function cellColumnIndex(sectionId: TimesheetSection["id"], layerIndex: number, baseGengaLayerCount = gengaLayerCount) {
    return sectionId === "genga" ? layerIndex : baseGengaLayerCount + 1 + layerIndex;
  }

  function cellFromColumnIndex(rowIndex: number, colIndex: number, baseGengaLayerCount = gengaLayerCount): TimesheetCellCoordinate | null {
    const syncedTimesheet = synchronizeLayerNames(timesheet);
    const gengaSection = syncedTimesheet.sections.find((section) => section.id === "genga");
    const dougaSection = syncedTimesheet.sections.find((section) => section.id === "douga");
    if (colIndex < 0 || rowIndex < 0 || rowIndex >= syncedTimesheet.frameCount) {
      return null;
    }
    if (colIndex < baseGengaLayerCount && gengaSection?.layers[colIndex]) {
      return { rowIndex, colIndex, sectionId: "genga", layerIndex: colIndex };
    }
    const dougaLayerIndex = colIndex - baseGengaLayerCount - 1;
    if (dougaLayerIndex >= 0 && dougaSection?.layers[dougaLayerIndex]) {
      return { rowIndex, colIndex, sectionId: "douga", layerIndex: dougaLayerIndex };
    }
    return null;
  }

  function selectionBounds(selection: CellSelection): CellSelectionBounds {
    return {
      rowStart: Math.min(selection.anchor.rowIndex, selection.focus.rowIndex),
      rowEnd: Math.max(selection.anchor.rowIndex, selection.focus.rowIndex),
      colStart: Math.min(selection.anchor.colIndex, selection.focus.colIndex),
      colEnd: Math.max(selection.anchor.colIndex, selection.focus.colIndex),
    };
  }

  function focusCell(rowIndex: number, colIndex: number) {
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-timesheet-cell="true"][data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`,
      );
      skipCellFocusSelectionRef.current = true;
      input?.focus();
      input?.select();
      window.requestAnimationFrame(() => {
        skipCellFocusSelectionRef.current = false;
      });
    });
  }

  function isCellSelected(rowIndex: number, colIndex: number) {
    if (!cellSelection) {
      return false;
    }
    const { rowStart, rowEnd, colStart, colEnd } = selectionBounds(cellSelection);
    return rowIndex >= rowStart && rowIndex <= rowEnd && colIndex >= colStart && colIndex <= colEnd;
  }

  function selectSingleCell(cell: TimesheetCellCoordinate) {
    setCellSelection({ anchor: cell, focus: cell });
  }

  function beginCellSelection(cell: TimesheetCellCoordinate) {
    selectSingleCell(cell);
    setCellSelectionActive(true);
  }

  function handleCellFocus(cell: TimesheetCellCoordinate) {
    if (skipCellFocusSelectionRef.current) {
      return;
    }
    selectSingleCell(cell);
  }

  function extendCellSelection(cell: TimesheetCellCoordinate) {
    if (!cellSelectionActive) {
      return;
    }
    setCellSelection((previous) => (previous ? { ...previous, focus: cell } : { anchor: cell, focus: cell }));
  }

  function cellValueAt(data: TimesheetData, rowIndex: number, colIndex: number, baseGengaLayerCount = gengaLayerCount) {
    if (colIndex < baseGengaLayerCount) {
      return data.sections.find((section) => section.id === "genga")?.cells[rowIndex]?.[colIndex] ?? "";
    }
    const dougaLayerIndex = colIndex - baseGengaLayerCount - 1;
    if (dougaLayerIndex >= 0) {
      return data.sections.find((section) => section.id === "douga")?.cells[rowIndex]?.[dougaLayerIndex] ?? "";
    }
    return "";
  }

  function serializeSelectedCells() {
    if (!cellSelection) {
      return "";
    }
    const { rowStart, rowEnd, colStart, colEnd } = selectionBounds(cellSelection);
    return Array.from({ length: rowEnd - rowStart + 1 }, (_, rowOffset) =>
      Array.from({ length: colEnd - colStart + 1 }, (_, colOffset) =>
        cellValueAt(timesheet, rowStart + rowOffset, colStart + colOffset),
      ).join("\t"),
    ).join("\n");
  }

  function pasteCellsFromText(text: string) {
    if (!cellSelection || text.length === 0) {
      return;
    }
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = normalizedText.split("\n");
    if (rows.at(-1) === "") {
      rows.pop();
    }
    const pastedRows = rows.map((row) => row.split("\t"));
    if (pastedRows.length === 0) {
      return;
    }

    const { rowStart, colStart } = selectionBounds(cellSelection);
    setTimesheet((previous) => {
      const previousGengaLayerCount = previous.sections.find((section) => section.id === "genga")?.layers.length ?? 0;
      return {
        ...previous,
        sections: previous.sections.map((section) => ({
          ...section,
          cells: section.cells.map((row, rowIndex) =>
            row.map((cell, layerIndex) => {
              const colIndex = cellColumnIndex(section.id, layerIndex, previousGengaLayerCount);
              const pasteRow = rowIndex - rowStart;
              const pasteCol = colIndex - colStart;
              return pastedRows[pasteRow]?.[pasteCol] ?? cell;
            }),
          ),
        })),
      };
    });

    const lastRow = Math.min(timesheet.frameCount - 1, rowStart + pastedRows.length - 1);
    const lastCol = colStart + Math.max(...pastedRows.map((row) => row.length)) - 1;
    const startCell = cellFromColumnIndex(rowStart, colStart);
    const focusCellTarget = cellFromColumnIndex(lastRow, lastCol) ?? cellFromColumnIndex(rowStart, colStart);
    if (startCell && focusCellTarget) {
      setCellSelection({ anchor: startCell, focus: focusCellTarget });
      focusCell(focusCellTarget.rowIndex, focusCellTarget.colIndex);
    }
    setStatus(`${pastedRows.length}行を貼り付けました。`);
  }

  function clearSelectedCells() {
    if (!cellSelection) {
      return;
    }

    const selection = cellSelection;
    setTimesheet((previous) => {
      const previousGengaLayerCount = previous.sections.find((section) => section.id === "genga")?.layers.length ?? 0;
      const { rowStart, rowEnd, colStart, colEnd } = selectionBounds(selection);

      return {
        ...previous,
        sections: previous.sections.map((section) => ({
          ...section,
          cells: section.cells.map((row, rowIndex) =>
            row.map((cell, layerIndex) => {
              const colIndex = cellColumnIndex(section.id, layerIndex, previousGengaLayerCount);
              return rowIndex >= rowStart && rowIndex <= rowEnd && colIndex >= colStart && colIndex <= colEnd ? "" : cell;
            }),
          ),
        })),
      };
    });
    setStatus("選択範囲のセルを削除しました。");
  }

  function moveCellSelection(direction: "up" | "down" | "left" | "right", extend: boolean) {
    if (!cellSelection) {
      return;
    }
    const current = cellSelection.focus;
    const maxColIndex = gengaLayerCount * 2;
    let nextRowIndex = current.rowIndex;
    let nextColIndex = current.colIndex;

    if (direction === "up") {
      nextRowIndex -= 1;
    }
    if (direction === "down") {
      nextRowIndex += 1;
    }
    if (direction === "left") {
      nextColIndex -= current.colIndex === gengaLayerCount + 1 ? 2 : 1;
    }
    if (direction === "right") {
      nextColIndex += current.colIndex === gengaLayerCount - 1 ? 2 : 1;
    }

    nextRowIndex = Math.min(Math.max(0, nextRowIndex), Math.max(0, timesheet.frameCount - 1));
    nextColIndex = Math.min(Math.max(0, nextColIndex), maxColIndex);
    const nextCell = cellFromColumnIndex(nextRowIndex, nextColIndex);
    if (!nextCell) {
      return;
    }

    setCellSelection((previous) => {
      const anchor = extend ? previous?.anchor ?? current : nextCell;
      return { anchor, focus: nextCell };
    });
    focusCell(nextCell.rowIndex, nextCell.colIndex);
  }

  function handleTimesheetKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!cellSelection) {
      return;
    }

    const arrowDirectionByKey: Record<string, "up" | "down" | "left" | "right" | undefined> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const arrowDirection = arrowDirectionByKey[event.key];
    if (arrowDirection) {
      event.preventDefault();
      moveCellSelection(arrowDirection, event.shiftKey);
      return;
    }

    if ((event.key !== "Delete" && event.key !== "Backspace") || !cellSelection) {
      return;
    }
    const target = event.target;
    const isEditingSingleInput = target instanceof HTMLInputElement && selectedCellCount <= 1;
    if (isEditingSingleInput) {
      return;
    }

    event.preventDefault();
    clearSelectedCells();
  }

  function handleTimesheetCopy(event: ClipboardEvent<HTMLElement>) {
    if (!cellSelection) {
      return;
    }
    const target = event.target;
    const hasTextSelection =
      target instanceof HTMLInputElement &&
      target.selectionStart !== null &&
      target.selectionEnd !== null &&
      target.selectionStart !== target.selectionEnd &&
      selectedCellCount <= 1;
    if (hasTextSelection) {
      return;
    }
    const text = serializeSelectedCells();
    if (!text) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    setStatus(`${selectedCellCount}セルをコピーしました。`);
  }

  function handleTimesheetPaste(event: ClipboardEvent<HTMLElement>) {
    if (!cellSelection) {
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    const target = event.target;
    const shouldUseNativePaste = target instanceof HTMLInputElement && selectedCellCount <= 1 && !/[\t\r\n]/.test(text);
    if (shouldUseNativePaste) {
      return;
    }
    event.preventDefault();
    pasteCellsFromText(text);
  }

  function updateLayerName(layerIndex: number, value: string) {
    setTimesheet((previous) => ({
      ...previous,
      sections: previous.sections.map((section) => ({
          ...section,
          layers: section.layers.map((layer, currentIndex) => (currentIndex === layerIndex ? value : layer)),
        })),
    }));
  }

  function addLayerPair() {
    const currentLayerCount = layerOptions.length;
    setDeleteLayerIndex(currentLayerCount);
    setTimesheet((previous) => {
      const syncedPrevious = synchronizeLayerNames(previous);
      const currentMaxLayerCount = Math.max(0, ...syncedPrevious.sections.map((section) => section.layers.length));
      const nextLayerCount = currentMaxLayerCount + 1;
      return {
        ...syncedPrevious,
        sections: syncedPrevious.sections.map((section) => {
          const missingLayerNames = Array.from({ length: nextLayerCount - section.layers.length }, (_, index) =>
            layerNameForIndex(section.layers.length + index),
          );
          return {
            ...section,
            layers: [...section.layers, ...missingLayerNames],
            cells: section.cells.map((row) => [...row, ...missingLayerNames.map(() => "")]),
          };
        }),
      };
    });
  }

  function insertLayerPair(insertIndex: number) {
    setDeleteLayerIndex(insertIndex);
    setTimesheet((previous) => {
      const syncedPrevious = synchronizeLayerNames(previous);
      const currentLayers = syncedPrevious.sections.find((section) => section.id === "genga")?.layers ?? defaultLayers;
      const safeInsertIndex = Math.min(Math.max(0, insertIndex), currentLayers.length);
      const nextLayerName = insertedLayerName(currentLayers, safeInsertIndex);

      return {
        ...syncedPrevious,
        sections: syncedPrevious.sections.map((section) => ({
          ...section,
          layers: [...section.layers.slice(0, safeInsertIndex), nextLayerName, ...section.layers.slice(safeInsertIndex)],
          cells: section.cells.map((row) => [...row.slice(0, safeInsertIndex), "", ...row.slice(safeInsertIndex)]),
        })),
      };
    });
  }

  function removeLayerPair(layerIndex: number) {
    setTimesheet((previous) => {
      const syncedPrevious = synchronizeLayerNames(previous);
      const maxLayerIndex = Math.max(...syncedPrevious.sections.map((section) => section.layers.length)) - 1;
      const safeLayerIndex = Math.min(Math.max(0, layerIndex), maxLayerIndex);
      if (maxLayerIndex <= 0) {
        return syncedPrevious;
      }

      return {
        ...syncedPrevious,
        sections: syncedPrevious.sections.map((section) => {
          if (safeLayerIndex >= section.layers.length) {
            return section;
          }
          return {
            ...section,
            layers: section.layers.filter((_, index) => index !== safeLayerIndex),
            cells: section.cells.map((row) => row.filter((_, index) => index !== safeLayerIndex)),
          };
        }),
      };
    });
    setDeleteLayerIndex(Math.max(0, layerIndex - 1));
  }

  function applyGengaConversion() {
    setTimesheet((previous) => convertGengaToDouga(previous));
    setCellSelection(null);
    setCellSelectionActive(false);
    setStatus("原画欄を変換し、動画欄へ反映しました。");
  }

  async function loadWorkbookFile(workbookFile: File, imageCount: number) {
    const raw = await readRawSheet(workbookFile);
    const parsed = synchronizeLayerNames(raw ? parseTimesheet(raw) : createBlankTimesheet());
    setTimesheet(parsed);
    syncDurationFromFrameCount(parsed.frameCount);
    setCellSelection(null);
    setCellSelectionActive(false);
    setStatus(`${imageCount}件の画像と ${fileDisplayName(workbookFile)} を読み込みました。`);
  }

  async function loadSelectedWorkbook() {
    if (!selectedWorkbookFile) {
      return;
    }
    await loadWorkbookFile(selectedWorkbookFile, images.length);
  }

  async function handleFolderSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const workbookFiles = files.filter(isWorkbookFile).sort((a, b) => fileDisplayName(a).localeCompare(fileDisplayName(b), "ja"));
    const imageFiles = files.filter(isImageFile).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    const textFiles = files.filter(isTextFile).sort((a, b) => fileDisplayName(a).localeCompare(fileDisplayName(b), "ja"));
    const nextImages = (
      await Promise.all(
        imageFiles.map(async (file) => {
          try {
            return { file, name: file.name, url: await previewUrlForImage(file), selected: true };
          } catch (error) {
            console.error(error);
            return null;
          }
        }),
      )
    ).filter((image): image is ImageEntry => image !== null);
    const nextTextNotes = (
      await Promise.all(
        textFiles.map(async (file) => {
          const text = await file.text();
          return textFiles.length > 1 ? `【${fileDisplayName(file)}】\n${text.trim()}` : text.trim();
        }),
      )
    )
      .filter(Boolean)
      .join("\n\n");

    for (const image of images) {
      URL.revokeObjectURL(image.url);
    }

    setImages(nextImages);
    setTextNotes(nextTextNotes);
    setWorkbookCandidates(workbookFiles);
    setSelectedWorkbookKey(workbookFiles[0] ? fileIdentity(workbookFiles[0]) : "");
    if (workbookFiles.length === 1) {
      await loadWorkbookFile(workbookFiles[0], imageFiles.length);
    } else if (workbookFiles.length > 1) {
      setStatus(`${imageFiles.length}件の画像と ${workbookFiles.length}件のXLSXを読み込みました。使用するXLSXを選択してください。`);
    } else {
      const blank = synchronizeLayerNames(createBlankTimesheet());
      setTimesheet(blank);
      syncDurationFromFrameCount(blank.frameCount);
      setStatus(`${imageFiles.length}件の画像を読み込みました。XLSXがないため0Fから新規作成しました。`);
    }
    event.target.value = "";
  }

  function toggleImage(imageName: string) {
    setImages((previous) =>
      previous.map((image) => (image.name === imageName ? { ...image, selected: !image.selected } : image)),
    );
  }

  function downloadXlsx() {
    const workbook = buildWorkbook(timesheet);
    XLSX.writeFile(workbook, `${clampSheetName(timesheet.title)}.xlsx`);
    setStatus(`${clampSheetName(timesheet.title)}.xlsx を書き出しました。`);
  }

  function handlePopupPointerDown(event: PointerEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-popup-control]")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setPopupDragStart({
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: Math.max(popupMinLeft, popupPosition.x),
      y: Math.max(popupMinTop, popupPosition.y),
    });
  }

  function handlePopupPointerMove(event: PointerEvent<HTMLElement>) {
    if (!popupDragStart) {
      return;
    }
    setPopupPosition({
      x: Math.max(popupMinLeft, popupDragStart.x + event.clientX - popupDragStart.pointerX),
      y: Math.max(popupMinTop, popupDragStart.y + event.clientY - popupDragStart.pointerY),
    });
  }

  const cellWidth = Math.round(34 * cellZoom);
  const cellHeight = Math.round(28 * cellZoom);
  const cellFontSize = Math.max(11, Math.round(13 * cellZoom));

  return (
    <div className={classNames("grid gap-3 lg:h-[calc(100vh-92px)] lg:overflow-hidden", imagePanelMode === "dock" ? "lg:grid-cols-[7fr_3fr]" : "lg:grid-cols-1")}>
      <section className="flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-3 shadow-sm lg:min-h-0">
        <div className="mb-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_84px_96px_72px_120px_150px_auto] lg:items-end">
          <label className="grid gap-1">
            <span className="field-label">名前</span>
            <input
              className="field-control"
              value={timesheet.title}
              onChange={(event) => setTimesheet((previous) => ({ ...previous, title: event.target.value }))}
            />
          </label>
          <label className="grid gap-1">
            <span className="field-label">秒数</span>
            <input
              className="field-control"
              inputMode="numeric"
              min={0}
              type="number"
              step="1"
              value={secondsDraft}
              onChange={(event) => setSecondsDraft(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="field-label">+フレーム</span>
            <input
              className="field-control"
              inputMode="numeric"
              min={0}
              type="number"
              step="1"
              value={additionalFramesDraft}
              onChange={(event) => setAdditionalFramesDraft(event.target.value)}
            />
          </label>
          <button className="control-button" type="button" onClick={applyDurationDraft}>
            更新
          </button>
          <div className="grid gap-1">
            <span className="field-label">合計</span>
            <div className="field-control flex items-center justify-center bg-zinc-50 text-sm font-semibold">{timesheet.frameCount}F</div>
          </div>
          <label className="grid gap-1">
            <span className="field-label">セル拡大率</span>
            <input
              type="range"
              min="0.7"
              max="1.8"
              step="0.1"
              value={cellZoom}
              onChange={(event) => setCellZoom(Number(event.target.value))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={(node) => {
                folderInputRef.current = node;
                node?.setAttribute("webkitdirectory", "");
                node?.setAttribute("directory", "");
              }}
              type="file"
              className="hidden"
              multiple
              accept="image/*,.tif,.tiff,.xlsx,.xlsm,.xls,.txt"
              onChange={handleFolderSelect}
            />
            <button className="control-button" type="button" onClick={() => folderInputRef.current?.click()}>
              フォルダ
            </button>
            <button className="primary-button" type="button" onClick={downloadXlsx}>
              XLSX
            </button>
          </div>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button className="control-button" type="button" onClick={addLayerPair}>
            レイヤー+
          </button>
          <label className="flex items-center gap-1 text-xs font-semibold text-zinc-600">
            <span>削除</span>
            <select
              className="h-[2.125rem] rounded border border-zinc-300 bg-white px-2 text-sm font-semibold text-zinc-900"
              value={safeDeleteLayerIndex}
              onChange={(event) => setDeleteLayerIndex(Number(event.target.value))}
              disabled={layerOptions.length <= 1}
            >
              {layerOptions.map((layer, layerIndex) => (
                <option value={layerIndex} key={`${layerIndex}-${layer}`}>
                  {layer}
                </option>
              ))}
            </select>
          </label>
          <button
            className="control-button"
            type="button"
            onClick={() => removeLayerPair(safeDeleteLayerIndex)}
            disabled={layerOptions.length <= 1}
          >
            レイヤー-
          </button>
          <button className="primary-button" type="button" onClick={applyGengaConversion}>
            原画変換
          </button>
          {textNotes ? (
            <div className="max-h-16 min-w-[220px] max-w-xl overflow-auto rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-relaxed whitespace-pre-wrap text-zinc-800">
              {textNotes}
            </div>
          ) : null}
          {workbookCandidates.length > 1 ? (
            <div className="flex min-w-[260px] items-center gap-1.5">
              <select
                className="h-[2.125rem] min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 text-sm font-semibold text-zinc-900"
                value={selectedWorkbookKey}
                onChange={(event) => setSelectedWorkbookKey(event.target.value)}
              >
                {workbookCandidates.map((file) => (
                  <option value={fileIdentity(file)} key={fileIdentity(file)}>
                    {fileDisplayName(file)}
                  </option>
                ))}
              </select>
              <button className="control-button" type="button" onClick={loadSelectedWorkbook}>
                読込
              </button>
            </div>
          ) : null}
          {imagePanelMode === "hidden" ? (
            <button className="control-button" type="button" onClick={() => setImagePanelMode("dock")}>
              画像表示
            </button>
          ) : null}
        </div>

        <div
          className="min-h-0 flex-1 overflow-auto rounded border border-zinc-200"
          tabIndex={0}
          onKeyDown={handleTimesheetKeyDown}
          onCopy={handleTimesheetCopy}
          onPaste={handleTimesheetPaste}
          onPointerUp={() => setCellSelectionActive(false)}
          onPointerCancel={() => setCellSelectionActive(false)}
        >
          <table className="min-w-max border-collapse text-sm">
            <thead className="sticky top-0 z-20 bg-zinc-100">
              <tr>
                <th className="sticky left-0 z-30 w-20 border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs">フレーム</th>
                {timesheet.sections.map((section, sectionIndex) => (
                  <Fragment key={`${section.id}-title-group`}>
                    <th colSpan={section.layers.length} className="border border-zinc-300 bg-zinc-200 px-2 py-1 text-sm">
                      {section.label}
                    </th>
                    {sectionIndex === 0 ? (
                      <th
                        aria-hidden="true"
                        className="border border-zinc-300 bg-zinc-50 p-0"
                        style={{ width: `${cellWidth}px` }}
                      />
                    ) : null}
                  </Fragment>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-30 border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs"> </th>
                {timesheet.sections.map((section, sectionIndex) => (
                  <Fragment key={`${section.id}-layers`}>
                    {section.layers.map((layer, layerIndex) => (
                      <th key={`${section.id}-${layerIndex}-${layer}`} className="group relative border border-zinc-300 bg-zinc-100 p-0.5">
                        {section.id === "genga" ? (
                          <button
                            className="absolute -left-2 top-1/2 z-30 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-zinc-300 bg-white text-xs font-bold text-zinc-700 opacity-0 shadow-sm transition-opacity hover:border-zinc-700 group-hover:opacity-100"
                            type="button"
                            onClick={() => insertLayerPair(layerIndex)}
                            aria-label={layerIndex === 0 ? `${layer} の前にレイヤーを挿入` : `${section.layers[layerIndex - 1]} と ${layer} の間にレイヤーを挿入`}
                            title="ここにレイヤーを挿入"
                          >
                            +
                          </button>
                        ) : null}
                        <div className="grid place-items-center">
                          {section.id === "genga" ? (
                            <CommitInput
                              key={`layer-${layerIndex}-${layer}`}
                              className="h-7 rounded border border-zinc-300 bg-white px-1 text-center font-semibold"
                              style={{ width: `${cellWidth}px`, fontSize: `${cellFontSize}px` }}
                              value={layer}
                              onCommit={(value) => updateLayerName(layerIndex, value)}
                            />
                          ) : (
                            <div
                              className="grid h-7 place-items-center rounded border border-zinc-200 bg-zinc-50 px-1 text-center font-semibold text-zinc-600"
                              style={{ width: `${cellWidth}px`, fontSize: `${cellFontSize}px` }}
                            >
                              {layer}
                            </div>
                          )}
                        </div>
                      </th>
                    ))}
                    {sectionIndex === 0 ? (
                      <th
                        aria-hidden="true"
                        className="border border-zinc-300 bg-zinc-50 p-0"
                        style={{ width: `${cellWidth}px`, height: `${cellHeight}px` }}
                      />
                    ) : null}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: timesheet.frameCount }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="sticky left-0 z-10 border border-zinc-300 bg-white px-2 py-1 text-center text-xs font-semibold">
                    {rowIndex + 1}
                  </th>
                  {timesheet.sections.map((section, sectionIndex) => (
                    <Fragment key={`${section.id}-${rowIndex}`}>
                      {section.layers.map((_, layerIndex) => {
                        const colIndex = cellColumnIndex(section.id, layerIndex);
                        const cell = { rowIndex, colIndex, sectionId: section.id, layerIndex };
                        const selected = isCellSelected(rowIndex, colIndex);
                        return (
                          <td
                            key={`${section.id}-${rowIndex}-${layerIndex}`}
                            className={classNames("border border-zinc-300 p-0", selected && "bg-blue-100")}
                            onPointerDown={() => beginCellSelection(cell)}
                            onPointerEnter={() => extendCellSelection(cell)}
                          >
                            <CommitInput
                              key={`${section.id}-${rowIndex}-${layerIndex}-${section.cells[rowIndex]?.[layerIndex] ?? ""}`}
                              className={classNames(
                                "px-1 text-center outline-none focus:bg-blue-50",
                                selected ? "bg-blue-100 ring-1 ring-inset ring-blue-500" : "bg-white",
                              )}
                              style={{ width: `${cellWidth}px`, height: `${cellHeight}px`, fontSize: `${cellFontSize}px` }}
                              maxLength={6}
                              value={section.cells[rowIndex]?.[layerIndex] ?? ""}
                              onCommit={(value) => updateCell(section.id, rowIndex, layerIndex, value)}
                              cellCoordinate={cell}
                              onFocusCell={handleCellFocus}
                            />
                          </td>
                        );
                      })}
                      {sectionIndex === 0 ? (
                        <td aria-hidden="true" className="border border-zinc-300 bg-zinc-50 p-0">
                          <div style={{ width: `${cellWidth}px`, height: `${cellHeight}px` }} />
                        </td>
                      ) : null}
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700">{status}</p>
      </section>

      {imagePanelMode === "dock" ? (
        <ImagePanel
          images={images}
          selectedImages={selectedImages}
          onToggleImage={toggleImage}
          onPopup={() => setImagePanelMode("popup")}
          onHide={() => setImagePanelMode("hidden")}
          zoom={imageZoom}
          onZoomChange={setImageZoom}
        />
      ) : null}

      {imagePanelMode === "popup" ? (
        <div
          className="fixed z-50 grid h-[70vh] min-h-[280px] w-[min(620px,92vw)] min-w-[320px] resize overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-2xl"
          style={{ left: `${popupPosition.x}px`, top: `${popupPosition.y}px` }}
          onPointerMove={handlePopupPointerMove}
          onPointerUp={() => setPopupDragStart(null)}
          onPointerCancel={() => setPopupDragStart(null)}
        >
          <ImagePanel
            images={images}
            selectedImages={selectedImages}
            onToggleImage={toggleImage}
            onPopup={() => setImagePanelMode("dock")}
            onHide={() => setImagePanelMode("hidden")}
            zoom={imageZoom}
            onZoomChange={setImageZoom}
            onDragStart={handlePopupPointerDown}
            popup
          />
        </div>
      ) : null}
    </div>
  );
}

function CommitInput({
  value,
  className,
  style,
  maxLength,
  onCommit,
  cellCoordinate,
  onFocusCell,
}: {
  value: string;
  className: string;
  style?: CSSProperties;
  maxLength?: number;
  onCommit: (value: string) => void;
  cellCoordinate?: TimesheetCellCoordinate;
  onFocusCell?: (cell: TimesheetCellCoordinate) => void;
}) {
  const [draft, setDraft] = useState(value);
  const skipBlurCommitRef = useRef(false);

  function commit() {
    if (draft !== value) {
      onCommit(draft);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      commit();
      skipBlurCommitRef.current = true;
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(value);
      skipBlurCommitRef.current = true;
      event.currentTarget.blur();
    }
  }

  function handleBlur() {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    commit();
  }

  return (
    <input
      className={className}
      style={style}
      maxLength={maxLength}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={handleBlur}
      onFocus={() => {
        if (cellCoordinate) {
          onFocusCell?.(cellCoordinate);
        }
      }}
      onKeyDown={handleKeyDown}
      data-timesheet-cell={cellCoordinate ? "true" : undefined}
      data-row-index={cellCoordinate?.rowIndex}
      data-col-index={cellCoordinate?.colIndex}
    />
  );
}

function ImagePanel({
  images,
  selectedImages,
  zoom = 1,
  popup = false,
  onToggleImage,
  onPopup,
  onHide,
  onZoomChange,
  onDragStart,
}: {
  images: ImageEntry[];
  selectedImages: ImageEntry[];
  zoom?: number;
  popup?: boolean;
  onToggleImage: (imageName: string) => void;
  onPopup: () => void;
  onHide: () => void;
  onZoomChange?: (zoom: number) => void;
  onDragStart?: (event: PointerEvent<HTMLElement>) => void;
}) {
  const [imageListOpen, setImageListOpen] = useState(false);

  function updateZoom(nextZoom: number) {
    onZoomChange?.(Math.min(4, Math.max(0.4, Number(nextZoom.toFixed(2)))));
  }

  return (
    <aside className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div
        className={classNames("mb-2 flex min-w-0 items-center justify-between gap-2", popup && "cursor-move")}
        onPointerDown={popup ? onDragStart : undefined}
      >
        <h2 className="text-sm font-semibold text-zinc-900">{popup ? "画像 - ドラッグで移動" : "画像"}</h2>
        <div className="flex items-center gap-1.5">
          <button data-popup-control className="control-button" type="button" onClick={onPopup}>
            {popup ? "戻す" : "ポップアップ"}
          </button>
          <button data-popup-control className="control-button" type="button" onClick={onHide}>
            非表示
          </button>
        </div>
      </div>
      {onZoomChange ? (
        <div data-popup-control className="mb-2 grid gap-1 text-xs text-zinc-600">
          <div className="flex items-center justify-between gap-2">
            <span>画像拡大率</span>
            <div className="flex items-center gap-1">
              <button className="control-button min-h-0 px-2 py-0.5 text-xs" type="button" onClick={() => updateZoom(zoom - 0.1)}>
                縮小
              </button>
              <span className="w-12 text-right tabular-nums">{Math.round(zoom * 100)}%</span>
              <button className="control-button min-h-0 px-2 py-0.5 text-xs" type="button" onClick={() => updateZoom(zoom + 0.1)}>
                拡大
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0.4"
            max="4"
            step="0.1"
            value={zoom}
            onChange={(event) => updateZoom(Number(event.target.value))}
          />
        </div>
      ) : null}
      <div data-popup-control className="mb-2 min-w-0 rounded border border-zinc-200">
        <button
          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          type="button"
          onClick={() => setImageListOpen((previous) => !previous)}
        >
          <span>画像選択</span>
          <span className="text-zinc-500">
            {selectedImages.length}/{images.length} {imageListOpen ? "閉じる" : "開く"}
          </span>
        </button>
        {imageListOpen ? (
          <div className="max-h-32 overflow-auto border-t border-zinc-200 p-2">
            {images.length > 0 ? (
              images.map((image) => (
                <label key={image.name} className="flex items-center gap-2 py-1 text-xs text-zinc-700">
                  <input type="checkbox" checked={image.selected} onChange={() => onToggleImage(image.name)} />
                  <span className="min-w-0 truncate">{image.name}</span>
                </label>
              ))
            ) : (
              <p className="text-xs text-zinc-500">画像がありません。</p>
            )}
          </div>
        ) : null}
      </div>
      <div data-popup-control className="min-h-0 w-full max-w-full flex-1 overflow-auto overscroll-contain rounded border border-zinc-200 bg-zinc-950 p-2">
        {selectedImages.length > 0 ? (
          <div className="inline-grid min-w-max gap-2">
            {selectedImages.map((image) => (
              <figure key={image.name} className="grid w-max gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.name}
                  className="rounded bg-zinc-900 object-contain"
                  style={{ width: `${Math.round((popup ? 520 : 360) * zoom)}px`, maxWidth: "none" }}
                />
                <figcaption className="truncate text-xs text-zinc-300">{image.name}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-zinc-300">表示する画像を選択してください。</p>
        )}
      </div>
    </aside>
  );
}
