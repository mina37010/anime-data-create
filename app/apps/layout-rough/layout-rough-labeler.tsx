"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as UTIF from "utif";

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"]);
const csvColumns = [
  "image_filename",
  "layer",
  "keyframe_number",
  "x1",
  "y1",
  "x2",
  "y2",
  "paper_color",
  "paper_color_other",
  "layout_flag",
  "correction_layout_flag",
  "rough_keyframe_flag",
  "correction_rough_keyframe_flag",
  "reference_flag",
  "book_flag",
  "assembly_instruction_flag",
  "blank_paper_flag",
  "composite_instruction_flag",
  "material_type",
  "classification",
] as const;
const imageAccept = "image/*,.tif,.tiff,.csv";
const layerOptions = ["A", "B", "C", "D", "E", "F"];
const naturalCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

type Bbox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type ImageEntry = {
  file: File;
  name: string;
  url: string;
};

type Annotation = {
  id: string;
  imageFilename: string;
  layer: string;
  keyframeNumber: string;
  paperColor: PaperColor;
  paperColorOther: string;
  materialMark: MaterialMark;
  blankPaperFlag: boolean;
  compositeInstructionFlag: boolean;
  bbox: Bbox | null;
};

type ImageSize = {
  width: number;
  height: number;
};

type Draft = {
  layer: string;
  keyframeNumber: string;
  paperColor: PaperColor;
  paperColorOther: string;
  materialMark: MaterialMark;
  blankPaperFlag: boolean;
  compositeInstructionFlag: boolean;
  bbox: Bbox | null;
};

type Classification = {
  kind: MaterialMark;
  source: "explicit";
};

type MaterialMark =
  | "layout"
  | "correction_layout"
  | "rough_keyframe"
  | "correction_rough_keyframe"
  | "reference"
  | "book"
  | "assembly_instruction"
  | "blank_paper";
type PaperColor = "none" | "white" | "pink" | "yellow" | "other";

type TimelineEntry = {
  annotation: Annotation;
  classification: Classification;
  image: ImageEntry | null;
};

type TimelineColumn = {
  keyframeNumber: string;
  entries: TimelineEntry[];
};

type TimelineRow = {
  label: string;
  columns: TimelineColumn[];
};

const initialDraft: Draft = {
  layer: "A",
  keyframeNumber: "",
  paperColor: "white",
  paperColorOther: "",
  materialMark: "layout",
  blankPaperFlag: false,
  compositeInstructionFlag: false,
  bbox: null,
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function isImageFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? imageExtensions.has(extension) : false;
}

function isCsvFile(file: File) {
  return file.name.toLowerCase().endsWith(".csv");
}

function pickCsvFile(files: File[], preferredName: string) {
  const csvFiles = files.filter(isCsvFile).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return csvFiles.find((file) => file.name.toLowerCase() === preferredName) ?? csvFiles[0] ?? null;
}

function isTiffFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
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

function normalizeBbox(bbox: Bbox | null) {
  if (!bbox) {
    return null;
  }

  return {
    x1: Math.round(Math.min(bbox.x1, bbox.x2)),
    y1: Math.round(Math.min(bbox.y1, bbox.y2)),
    x2: Math.round(Math.max(bbox.x1, bbox.x2)),
    y2: Math.round(Math.max(bbox.y1, bbox.y2)),
  };
}

function isFlagOn(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function paperColorFromCsv(color: string | undefined, coloredPaperFlag: boolean): PaperColor {
  if (color === "white" || color === "pink" || color === "yellow" || color === "other") {
    return color;
  }
  return coloredPaperFlag ? "other" : "white";
}

function paperColorLabel(color: PaperColor, other: string) {
  if (color === "white") {
    return "白";
  }
  if (color === "pink") {
    return "ピンク";
  }
  if (color === "yellow") {
    return "黄";
  }
  if (color === "other") {
    return other.trim() ? `その他(${other.trim()})` : "その他";
  }
  return "未指定";
}

function paperColorDotClass(color: PaperColor) {
  if (color === "white") {
    return "border-zinc-500 bg-white";
  }
  if (color === "pink") {
    return "border-pink-500 bg-pink-300";
  }
  if (color === "yellow") {
    return "border-yellow-500 bg-yellow-300";
  }
  if (color === "other") {
    return "border-zinc-500 bg-zinc-400";
  }
  return "border-zinc-300 bg-zinc-100";
}

function classifyAnnotation(annotation: Annotation): Classification {
  return { kind: annotation.materialMark, source: "explicit" };
}

function classifyAnnotationForExport(annotation: Annotation): Classification {
  return classifyAnnotation(annotation);
}

function classificationLabel(classification: Classification) {
  if (classification.kind === "layout") {
    return "レイアウト";
  }
  if (classification.kind === "correction_layout") {
    return "修正レイアウト";
  }
  if (classification.kind === "rough_keyframe") {
    return "ラフ原画";
  }
  if (classification.kind === "correction_rough_keyframe") {
    return "修正ラフ原画";
  }
  if (classification.kind === "reference") {
    return "参考";
  }
  if (classification.kind === "book") {
    return "Book";
  }
  if (classification.kind === "assembly_instruction") {
    return "組み指示";
  }
  return "白紙";
}

function materialTypeLabel(classification: Classification) {
  return classificationLabel(classification);
}

function timelineRowLabel(annotation: Annotation, classification: Classification) {
  if (
    annotation.compositeInstructionFlag ||
    classification.kind === "blank_paper" ||
    classification.kind === "book" ||
    classification.kind === "assembly_instruction"
  ) {
    return "その他";
  }

  const layer = annotation.layer.trim();
  const keyframeNumber = annotation.keyframeNumber.trim();
  if (!layer || !keyframeNumber) {
    return "その他";
  }

  return layer;
}

function timelineRowSortValue(label: string) {
  const optionIndex = layerOptions.indexOf(label);
  if (optionIndex >= 0) {
    return optionIndex;
  }
  if (label === "その他") {
    return Number.MAX_SAFE_INTEGER;
  }
  return layerOptions.length + 1;
}

function timelineColumnLabel(annotation: Annotation, rowLabel: string) {
  if (rowLabel !== "その他") {
    return annotation.keyframeNumber.trim() || "未設定";
  }
  if (annotation.compositeInstructionFlag) {
    return "合成指示";
  }
  return annotation.keyframeNumber.trim() || "未設定";
}

function buildTimelineRows(annotations: Annotation[], images: ImageEntry[]): TimelineRow[] {
  const imageByName = new Map(images.map((image) => [image.name, image]));
  const rowMap = new Map<string, Map<string, TimelineEntry[]>>();

  for (const annotation of annotations) {
    const classification = classifyAnnotation(annotation);
    const rowLabel = timelineRowLabel(annotation, classification);
    const keyframeNumber = timelineColumnLabel(annotation, rowLabel);
    const columnKey = keyframeNumber || "未設定";
    const row = rowMap.get(rowLabel) ?? new Map<string, TimelineEntry[]>();
    const entries = row.get(columnKey) ?? [];
    entries.push({
      annotation,
      classification,
      image: imageByName.get(annotation.imageFilename) ?? null,
    });
    row.set(columnKey, entries);
    rowMap.set(rowLabel, row);
  }

  return [...rowMap.entries()]
    .sort(([labelA], [labelB]) => {
      const order = timelineRowSortValue(labelA) - timelineRowSortValue(labelB);
      return order || naturalCollator.compare(labelA, labelB);
    })
    .map(([label, columns]) => ({
      label,
      columns: [...columns.entries()]
        .sort(([numberA], [numberB]) => naturalCollator.compare(numberA, numberB))
        .map(([keyframeNumber, entries]) => ({
          keyframeNumber,
          entries: entries.sort((a, b) => naturalCollator.compare(a.annotation.imageFilename, b.annotation.imageFilename)),
        })),
    }));
}

function materialMarkFromDraft(draft: Draft): MaterialMark {
  return draft.materialMark;
}

function draftFlagsFromMaterialMark(mark: MaterialMark) {
  return {
    materialMark: mark,
    blankPaperFlag: mark === "blank_paper",
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvEscape(value: string | number) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function materialMarkFromCsv(values: Map<string, string>): MaterialMark {
  const classification = values.get("classification")?.trim();
  const materialType = values.get("material_type")?.trim();
  if (classification === "correction_layout" || materialType === "修正レイアウト") {
    return "correction_layout";
  }
  if (classification === "rough_keyframe" || materialType === "ラフ原画") {
    return "rough_keyframe";
  }
  if (classification === "correction_rough_keyframe" || materialType === "修正ラフ原画") {
    return "correction_rough_keyframe";
  }
  if (classification === "reference" || materialType === "参考") {
    return "reference";
  }
  if (classification === "book" || materialType === "Book") {
    return "book";
  }
  if (classification === "assembly_instruction" || materialType === "組み指示") {
    return "assembly_instruction";
  }
  if (classification === "blank_paper" || materialType === "白紙") {
    return "blank_paper";
  }
  if (isFlagOn(values.get("correction_layout_flag"))) {
    return "correction_layout";
  }
  if (isFlagOn(values.get("rough_keyframe_flag"))) {
    return "rough_keyframe";
  }
  if (isFlagOn(values.get("correction_rough_keyframe_flag"))) {
    return "correction_rough_keyframe";
  }
  if (isFlagOn(values.get("reference_flag"))) {
    return "reference";
  }
  if (isFlagOn(values.get("book_flag"))) {
    return "book";
  }
  if (isFlagOn(values.get("assembly_instruction_flag"))) {
    return "assembly_instruction";
  }
  if (isFlagOn(values.get("blank_paper_flag"))) {
    return "blank_paper";
  }
  return "layout";
}

function annotationsFromCsv(text: string): Annotation[] {
  const rows = parseCsv(text.trim());
  if (rows.length === 0) {
    return [];
  }

  const header = rows[0].map((value) => value.replace(/^\uFEFF/, ""));
  return rows.slice(1).flatMap((row, index) => {
    const values = new Map(header.map((column, columnIndex) => [column, row[columnIndex] ?? ""]));
    const imageFilename = values.get("image_filename")?.trim() ?? "";
    const layer = values.get("layer")?.trim() ?? "";
    const keyframeNumber = values.get("keyframe_number")?.trim() ?? "";
    const coloredPaperFlag = isFlagOn(values.get("colored_paper_flag"));
    const materialMark = materialMarkFromCsv(values);
    const canOmitTimelinePosition =
      materialMark === "book" || materialMark === "assembly_instruction" || materialMark === "blank_paper";
    const compositeInstructionFlag = isFlagOn(values.get("composite_instruction_flag"));

    if (!imageFilename || (!canOmitTimelinePosition && (!layer || !keyframeNumber))) {
      return [];
    }

    const coordinates = ["x1", "y1", "x2", "y2"].map((column) => values.get(column)?.trim() ?? "");
    const bbox =
      coordinates.every(Boolean) && coordinates.every((value) => Number.isFinite(Number(value)))
        ? {
            x1: Number(coordinates[0]),
            y1: Number(coordinates[1]),
            x2: Number(coordinates[2]),
            y2: Number(coordinates[3]),
          }
        : null;

    return [
      {
        id: `csv-${Date.now()}-${index}`,
        imageFilename,
        layer,
        keyframeNumber,
        paperColor: paperColorFromCsv(values.get("paper_color"), coloredPaperFlag),
        paperColorOther: values.get("paper_color_other")?.trim() ?? "",
        materialMark,
        blankPaperFlag: materialMark === "blank_paper",
        compositeInstructionFlag,
        bbox: normalizeBbox(bbox),
      },
    ];
  });
}

function annotationsToCsv(annotations: Annotation[]) {
  const rows = [
    csvColumns.join(","),
    ...annotations.map((annotation) => {
      const bbox = normalizeBbox(annotation.bbox);
      const classification = classifyAnnotationForExport(annotation);
      return [
        annotation.imageFilename,
        annotation.layer,
        annotation.keyframeNumber,
        bbox?.x1 ?? "",
        bbox?.y1 ?? "",
        bbox?.x2 ?? "",
        bbox?.y2 ?? "",
        annotation.paperColor === "none" ? "" : annotation.paperColor,
        annotation.paperColorOther,
        classification.kind === "layout" ? "1" : "0",
        classification.kind === "correction_layout" ? "1" : "0",
        classification.kind === "rough_keyframe" ? "1" : "0",
        classification.kind === "correction_rough_keyframe" ? "1" : "0",
        classification.kind === "reference" ? "1" : "0",
        classification.kind === "book" ? "1" : "0",
        classification.kind === "assembly_instruction" ? "1" : "0",
        classification.kind === "blank_paper" ? "1" : "0",
        annotation.compositeInstructionFlag ? "1" : "0",
        materialTypeLabel(classification),
        classification.kind,
      ]
        .map(csvEscape)
        .join(",");
    }),
  ];

  return `${rows.join("\n")}\n`;
}

function draftFromAnnotation(annotation: Annotation): Draft {
  return {
    layer: annotation.layer,
    keyframeNumber: annotation.keyframeNumber,
    paperColor: annotation.paperColor,
    paperColorOther: annotation.paperColorOther,
    materialMark: annotation.materialMark,
    blankPaperFlag: annotation.blankPaperFlag,
    compositeInstructionFlag: annotation.compositeInstructionFlag,
    bbox: annotation.bbox,
  };
}

export function LayoutRoughLabeler() {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [index, setIndex] = useState(0);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [locked, setLocked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState("ローカル画像フォルダを読み込んでください。画像はサーバーへ送信されません。");
  const [mainView, setMainView] = useState<"image" | "timeline">("image");

  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const layerInputRef = useRef<HTMLInputElement | null>(null);
  const keyframeInputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  const currentImage = images[index] ?? null;
  const currentAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.imageFilename === currentImage?.name),
    [annotations, currentImage?.name],
  );
  const totalWithAnnotations = useMemo(
    () => new Set(annotations.map((annotation) => annotation.imageFilename)).size,
    [annotations],
  );
  const timelineRows = useMemo(() => buildTimelineRows(annotations, images), [annotations, images]);

  useEffect(() => {
    return () => {
      for (const image of images) {
        URL.revokeObjectURL(image.url);
      }
    };
  }, [images]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !isEditableTarget(event.target)) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        }
        return;
      }

      if (!event.ctrlKey || event.metaKey) {
        return;
      }

      if (key === "1" && !locked) {
        event.preventDefault();
        updateMaterialMark("layout");
      }
      if (key === "2" && !locked) {
        event.preventDefault();
        updateMaterialMark("correction_layout");
      }
      if (key === "3" && !locked) {
        event.preventDefault();
        updateMaterialMark("rough_keyframe");
      }
      if (key === "4" && !locked) {
        event.preventDefault();
        updateMaterialMark("correction_rough_keyframe");
      }
      if (key === "5" && !locked) {
        event.preventDefault();
        updateMaterialMark("reference");
      }
      if (key === "6" && !locked) {
        event.preventDefault();
        updateMaterialMark("book");
      }
      if (key === "7" && !locked) {
        event.preventDefault();
        updateMaterialMark("blank_paper");
      }
      if (key === "k" && !locked) {
        event.preventDefault();
        updateMaterialMark("assembly_instruction");
      }
      if (key === "8" && !locked) {
        event.preventDefault();
        updatePaperColor("white");
      }
      if (key === "9" && !locked) {
        event.preventDefault();
        updatePaperColor("pink");
      }
      if (key === "0" && !locked) {
        event.preventDefault();
        updatePaperColor("yellow");
      }
      if (key === "-" && !locked) {
        event.preventDefault();
        updatePaperColor("other");
      }
      if (key === "q" && !locked) {
        event.preventDefault();
        updateCompositeInstructionFlag(!draft.compositeInstructionFlag);
      }
      if (event.key === "ArrowLeft" || key === "[") {
        event.preventDefault();
        go(-1);
      }
      if (event.key === "ArrowRight" || key === "]") {
        event.preventDefault();
        go(1);
      }
      if (event.key === "Enter" && currentImage && !locked) {
        event.preventDefault();
        saveDraft("stay");
      }
      if (key === "n" && currentImage) {
        event.preventDefault();
        addAnother();
      }
      if (key === "i") {
        event.preventDefault();
        directoryInputRef.current?.click();
      }
      if (key === "o") {
        event.preventDefault();
        csvInputRef.current?.click();
      }
      if (key === "e" && locked) {
        event.preventDefault();
        enableEditMode();
      }
      if (key === "s" && annotations.length > 0) {
        event.preventDefault();
        downloadCsv();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  function loadImageAt(nextIndex: number, sourceAnnotations = annotations, sourceImages = images) {
    const nextImage = sourceImages[nextIndex];
    setIndex(nextIndex);
    setImageSize(null);
    setSelectedId(null);
    setEditingId(null);
    setDragStart(null);

    if (!nextImage) {
      setLocked(false);
      setDraft((previous) => ({
        ...previous,
        keyframeNumber: "",
        paperColor: "white",
        paperColorOther: "",
        materialMark: "layout",
        blankPaperFlag: false,
        compositeInstructionFlag: false,
        bbox: null,
      }));
      setStatus(
        sourceImages.length === 0
          ? "ローカル画像フォルダを読み込んでください。画像はサーバーへ送信されません。"
          : "全ての画像の入力が完了しました。",
      );
      return;
    }

    const rows = sourceAnnotations.filter((annotation) => annotation.imageFilename === nextImage.name);
    if (rows.length > 0) {
      setLocked(true);
      setSelectedId(rows[0].id);
      setDraft(draftFromAnnotation(rows[0]));
      setStatus("既存データが見つかりました。編集する場合は行を選んで編集モードにしてください。");
    } else {
      setLocked(false);
      setDraft((previous) => ({
        ...previous,
        keyframeNumber: "",
        paperColor: "white",
        paperColorOther: "",
        materialMark: "layout",
        blankPaperFlag: false,
        compositeInstructionFlag: false,
        bbox: null,
      }));
      setStatus("新規入力を行ってください。");
      window.setTimeout(() => layerInputRef.current?.focus(), 0);
    }
  }

  async function handleDirectorySelect(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    const csvFile = pickCsvFile(selectedFiles, "layout_rough.csv");
    const importedAnnotations = csvFile ? annotationsFromCsv(await csvFile.text()) : [];
    const files = selectedFiles
      .filter(isImageFile)
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .reverse();
    const failedTiffs: string[] = [];
    const nextImages = (
      await Promise.all(
        files.map(async (file) => {
          try {
            return {
              file,
              name: file.name,
              url: await previewUrlForImage(file),
            };
          } catch (error) {
            if (isTiffFile(file)) {
              failedTiffs.push(file.name);
            }
            console.error(error);
            return null;
          }
        }),
      )
    ).filter((image): image is ImageEntry => image !== null);

    for (const image of images) {
      URL.revokeObjectURL(image.url);
    }

    setImages(nextImages);
    setIndex(0);
    setAnnotations(importedAnnotations);
    setDraft(initialDraft);
    setSelectedId(null);
    setEditingId(null);
    setImageSize(null);
    setLocked(false);
    if (nextImages.length > 0 && importedAnnotations.length > 0) {
      loadImageAt(0, importedAnnotations, nextImages);
    }
    setStatus(
      nextImages.length > 0
        ? `${nextImages.length}件の画像を読み込みました。${csvFile ? ` ${csvFile.name} から ${importedAnnotations.length}件のCSV行を読み込みました。` : ""}${failedTiffs.length ? ` TIFF変換失敗: ${failedTiffs.join(", ")}` : ""}`
        : "画像が見つかりませんでした。",
    );
    window.setTimeout(() => layerInputRef.current?.focus(), 0);
    event.target.value = "";
  }

  async function handleCsvSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rows = annotationsFromCsv(await file.text());
    setAnnotations(rows);
    if (currentImage) {
      loadImageAt(index, rows);
    }
    setStatus(`${file.name} から ${rows.length}件の既存データを読み込みました。`);
    event.target.value = "";
  }

  function getLayerValue() {
    return draft.layer.trim();
  }

  function updateMaterialMark(mark: MaterialMark) {
    const flags = draftFlagsFromMaterialMark(mark);
    setDraft((previous) => ({ ...previous, ...flags }));
  }

  function updatePaperColor(paperColor: PaperColor) {
    setDraft((previous) => ({ ...previous, paperColor }));
  }

  function updatePaperColorOther(paperColorOther: string) {
    setDraft((previous) => ({ ...previous, paperColorOther }));
  }

  function updateCompositeInstructionFlag(compositeInstructionFlag: boolean) {
    setDraft((previous) => ({ ...previous, compositeInstructionFlag }));
  }

  function buildAnnotation(): Annotation | null {
    if (!currentImage) {
      setStatus("ローカル画像フォルダを読み込んでください。画像はサーバーへ送信されません。");
      return null;
    }

    const layer = getLayerValue();
    const keyframeNumber = draft.keyframeNumber.trim();
    const canOmitTimelinePosition =
      draft.materialMark === "book" || draft.materialMark === "assembly_instruction" || draft.materialMark === "blank_paper";
    if (!canOmitTimelinePosition && !layer) {
      setStatus("レイヤーを選択または入力してください。");
      return null;
    }

    if (!canOmitTimelinePosition && !keyframeNumber) {
      setStatus("番号を入力してください。");
      return null;
    }

    return {
      id: editingId ?? `annotation-${Date.now()}`,
      imageFilename: currentImage.name,
      layer,
      keyframeNumber,
      paperColor: draft.paperColor,
      paperColorOther: draft.paperColorOther.trim(),
      materialMark: draft.materialMark,
      blankPaperFlag: draft.blankPaperFlag,
      compositeInstructionFlag: draft.compositeInstructionFlag,
      bbox: normalizeBbox(draft.bbox),
    };
  }

  function saveDraft(mode: "next" | "stay") {
    const annotation = buildAnnotation();
    if (!annotation) {
      return;
    }

    const nextAnnotations = editingId
      ? annotations.map((item) => (item.id === editingId ? annotation : item))
      : [...annotations, annotation];
    const unifiedAnnotations = nextAnnotations;

    setAnnotations(unifiedAnnotations);
    if (mode === "next") {
      loadImageAt(index + 1, unifiedAnnotations);
    } else {
      setLocked(false);
      setSelectedId(null);
      setEditingId(null);
      setDraft((previous) => ({
        ...previous,
        keyframeNumber: "",
        materialMark: "layout",
        blankPaperFlag: false,
        compositeInstructionFlag: false,
        bbox: null,
      }));
      setStatus("同じ画像に新しい枠と番号を追加できます。");
    }
  }

  function deleteActiveAnnotation() {
    const activeId = editingId ?? selectedId;
    if (!activeId) {
      if (!locked && draft.bbox) {
        setDraft((previous) => ({ ...previous, bbox: null }));
        setStatus("未保存の矩形を削除しました。");
        return;
      }
      setStatus("削除する行または矩形を選択してください。");
      return;
    }

    const target = annotations.find((annotation) => annotation.id === activeId);
    if (!target) {
      setSelectedId(null);
      setEditingId(null);
      setStatus("削除対象が見つかりませんでした。");
      return;
    }

    const nextAnnotations = annotations.filter((annotation) => annotation.id !== activeId);
    const nextRows = nextAnnotations.filter((annotation) => annotation.imageFilename === target.imageFilename);
    const nextSelection = nextRows[0] ?? null;

    setAnnotations(nextAnnotations);
    setEditingId(null);

    if (nextSelection) {
      setLocked(true);
      setSelectedId(nextSelection.id);
      setDraft(draftFromAnnotation(nextSelection));
    } else {
      setLocked(false);
      setSelectedId(null);
      setDraft((previous) => ({
        ...previous,
        keyframeNumber: "",
        materialMark: "layout",
        blankPaperFlag: false,
        compositeInstructionFlag: false,
        bbox: null,
      }));
    }

    setStatus(`${target.imageFilename} の選択行を削除しました。`);
  }

  function go(delta: number) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex > images.length) {
      setStatus("これ以上移動できません。");
      return;
    }
    loadImageAt(nextIndex);
  }

  function selectAnnotation(annotation: Annotation) {
    setSelectedId(annotation.id);
    setDraft(draftFromAnnotation(annotation));
    if (!locked) {
      setEditingId(annotation.id);
      setStatus("既存行を編集中です。保存するとこの行を更新します。");
    } else {
      setStatus("既存行を選択しました。編集する場合は編集モードにしてください。");
    }
  }

  function openTimelineAnnotation(annotation: Annotation) {
    const nextIndex = images.findIndex((image) => image.name === annotation.imageFilename);
    if (nextIndex >= 0) {
      setIndex(nextIndex);
      setImageSize(null);
      setDragStart(null);
    }
    setLocked(true);
    setSelectedId(annotation.id);
    setEditingId(null);
    setDraft(draftFromAnnotation(annotation));
    setMainView("image");
    setStatus("タイムラインから既存行を選択しました。修正する場合は編集してください。");
  }

  function scrollTimeline(delta: number) {
    timelineScrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  function enableEditMode() {
    const target = annotations.find((annotation) => annotation.id === selectedId) ?? currentAnnotations[0];
    if (!target) {
      setLocked(false);
      setStatus("新しい枠と番号を追加できます。");
      return;
    }

    setLocked(false);
    setEditingId(target.id);
    setSelectedId(target.id);
    setDraft(draftFromAnnotation(target));
    setStatus("編集モードです。保存すると選択行を更新します。");
    window.setTimeout(() => layerInputRef.current?.focus(), 0);
  }

  function addAnother() {
    if (locked) {
      setLocked(false);
      setEditingId(null);
      setSelectedId(null);
      setDraft((previous) => ({
        ...previous,
        keyframeNumber: "",
        materialMark: "layout",
        blankPaperFlag: false,
        compositeInstructionFlag: false,
        bbox: null,
      }));
      setStatus("同じ画像に新しい枠と番号を追加できます。");
      return;
    }

    if (draft.keyframeNumber.trim() || draft.bbox) {
      saveDraft("stay");
      return;
    }

    setSelectedId(null);
    setEditingId(null);
    setStatus("同じ画像に新しい枠と番号を追加できます。");
  }

  function pointFromEvent(event: PointerEvent<SVGSVGElement>) {
    const size = imageSize;
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!size || !bounds) {
      return null;
    }

    return {
      x: Math.max(0, Math.min(size.width, ((event.clientX - bounds.left) / bounds.width) * size.width)),
      y: Math.max(0, Math.min(size.height, ((event.clientY - bounds.top) / bounds.height) * size.height)),
    };
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!imageSize) {
      return;
    }
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }

    if (locked) {
      const target = [...currentAnnotations]
        .filter((annotation) => {
          const bbox = normalizeBbox(annotation.bbox);
          return bbox && bbox.x1 <= point.x && point.x <= bbox.x2 && bbox.y1 <= point.y && point.y <= bbox.y2;
        })
        .sort((a, b) => {
          const bboxA = normalizeBbox(a.bbox);
          const bboxB = normalizeBbox(b.bbox);
          const areaA = bboxA ? (bboxA.x2 - bboxA.x1) * (bboxA.y2 - bboxA.y1) : Number.MAX_SAFE_INTEGER;
          const areaB = bboxB ? (bboxB.x2 - bboxB.x1) * (bboxB.y2 - bboxB.y1) : Number.MAX_SAFE_INTEGER;
          return areaA - areaB;
        })[0];

      if (target) {
        selectAnnotation(target);
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setDraft((previous) => ({ ...previous, bbox: { x1: point.x, y1: point.y, x2: point.x, y2: point.y } }));
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (locked || !dragStart) {
      return;
    }
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }
    setDraft((previous) => ({
      ...previous,
      bbox: { x1: dragStart.x, y1: dragStart.y, x2: point.x, y2: point.y },
    }));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!dragStart) {
      return;
    }
    const point = pointFromEvent(event);
    if (point) {
      setDraft((previous) => ({
        ...previous,
        bbox: normalizeBbox({ x1: dragStart.x, y1: dragStart.y, x2: point.x, y2: point.y }),
      }));
    }
    setDragStart(null);
  }

  function downloadCsv() {
    const csv = `\uFEFF${annotationsToCsv(annotations)}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "layout_rough.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("layout_rough.csv を書き出しました。");
  }

  const normalizedDraftBbox = normalizeBbox(draft.bbox);
  const canSave = Boolean(currentImage && !locked);
  const draftAnnotation: Annotation | null = currentImage
    ? {
        id: editingId ?? "draft",
        imageFilename: currentImage.name,
        layer: draft.layer.trim(),
        keyframeNumber: draft.keyframeNumber.trim(),
        paperColor: draft.paperColor,
        paperColorOther: draft.paperColorOther,
        materialMark: draft.materialMark,
        blankPaperFlag: draft.blankPaperFlag,
        compositeInstructionFlag: draft.compositeInstructionFlag,
        bbox: normalizedDraftBbox,
      }
    : null;
  const draftClassification: Classification = draftAnnotation ? classifyAnnotation(draftAnnotation) : { kind: "layout", source: "explicit" };
  const materialMark = materialMarkFromDraft(draft);

  return (
    <div className="grid gap-3 lg:h-[calc(100vh-92px)] lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
      <section className="flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-3 shadow-sm lg:min-h-0 lg:overflow-y-auto">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-zinc-500">
              {currentImage ? `${index + 1}/${images.length}` : "0/0"}
            </p>
            <h2 className="break-all text-base font-semibold tracking-normal">
              {currentImage?.name ?? "画像未選択"}
            </h2>
          </div>
          <div className="flex gap-2">
            <button className="control-button" type="button" onClick={() => go(-1)} disabled={index === 0}>
              前へ
            </button>
            <button className="control-button" type="button" onClick={() => go(1)} disabled={images.length === 0 || index >= images.length}>
              次へ
            </button>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={classNames("control-button", mainView === "image" && "border-zinc-900 bg-zinc-100")}
            onClick={() => setMainView("image")}
          >
            画像
          </button>
          <button
            type="button"
            className={classNames("control-button", mainView === "timeline" && "border-zinc-900 bg-zinc-100")}
            onClick={() => setMainView("timeline")}
          >
            タイムライン
          </button>
        </div>

        {mainView === "image" ? (
          <>
            <div className="flex min-h-[360px] flex-1 items-center justify-center overflow-hidden rounded-md bg-zinc-950 lg:h-[calc(100vh-220px)] lg:min-h-0">
              {currentImage ? (
                <div className="relative inline-flex max-h-[70vh] max-w-full lg:max-h-[calc(100vh-220px)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage.url}
                    alt={currentImage.name}
                    className="block max-h-[70vh] max-w-full select-none object-contain lg:max-h-[calc(100vh-220px)]"
                    draggable={false}
                    onLoad={(event) =>
                      setImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  {imageSize ? (
                    <svg
                      ref={overlayRef}
                      className="absolute inset-0 h-full w-full touch-none"
                      viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={() => setDragStart(null)}
                    >
                      {currentAnnotations.map((annotation) => {
                        const bbox = normalizeBbox(annotation.id === editingId ? draft.bbox : annotation.bbox);
                        if (!bbox) {
                          return null;
                        }
                        return (
                          <rect
                            key={annotation.id}
                            x={bbox.x1}
                            y={bbox.y1}
                            width={bbox.x2 - bbox.x1}
                            height={bbox.y2 - bbox.y1}
                            fill="transparent"
                            stroke={annotation.id === selectedId ? "#2563eb" : "#ef4444"}
                            strokeWidth={annotation.id === selectedId ? 6 : 4}
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                      {normalizedDraftBbox && !editingId ? (
                        <rect
                          x={normalizedDraftBbox.x1}
                          y={normalizedDraftBbox.y1}
                          width={normalizedDraftBbox.x2 - normalizedDraftBbox.x1}
                          height={normalizedDraftBbox.y2 - normalizedDraftBbox.y1}
                          fill="transparent"
                          stroke="#2563eb"
                          strokeWidth={5}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                    </svg>
                  ) : null}
                </div>
              ) : (
                <div className="px-6 text-center text-sm leading-6 text-zinc-300">
                  ローカル画像フォルダを読み込むと、ここにプレビューが表示されます。
                </div>
              )}
            </div>

            <p className="mt-2 text-xs text-zinc-600">
              {normalizedDraftBbox
                ? `矩形: (${normalizedDraftBbox.x1}, ${normalizedDraftBbox.y1}) - (${normalizedDraftBbox.x2}, ${normalizedDraftBbox.y2})`
                : "矩形: 未選択"}
            </p>
          </>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col rounded-md border border-zinc-200 bg-zinc-50 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">タイムライン</h2>
              <div className="flex gap-1">
                <button className="control-button min-h-8 px-2 py-1" type="button" onClick={() => scrollTimeline(-360)}>
                  ←
                </button>
                <button className="control-button min-h-8 px-2 py-1" type="button" onClick={() => scrollTimeline(360)}>
                  →
                </button>
              </div>
            </div>
            <div
              ref={timelineScrollRef}
              className="min-h-0 flex-1 overflow-auto rounded border border-zinc-200 bg-white"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  event.stopPropagation();
                  scrollTimeline(-180);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                  scrollTimeline(180);
                }
              }}
            >
              {timelineRows.length > 0 ? (
                <div className="grid gap-0">
                  {timelineRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[72px_1fr] border-b border-zinc-100 last:border-b-0">
                      <div className="sticky left-0 z-10 flex items-start bg-white px-2 py-2 text-xs font-semibold text-zinc-700">
                        {row.label}
                      </div>
                      <div className="flex min-w-max gap-2 px-2 py-2">
                        {row.columns.map((column) => (
                          <div key={`${row.label}-${column.keyframeNumber}`} className="w-28 shrink-0">
                            <div className="mb-1 truncate text-center text-xs font-semibold text-zinc-600">{column.keyframeNumber}</div>
                            <div className="grid gap-1">
                              {column.entries.map((entry) => (
                                <button
                                  key={entry.annotation.id}
                                  type="button"
                                  className={classNames(
                                    "rounded border bg-white p-1 text-left text-xs shadow-sm hover:border-zinc-900",
                                    entry.annotation.id === selectedId ? "border-blue-500 ring-2 ring-blue-100" : "border-zinc-200",
                                  )}
                                  onClick={() => openTimelineAnnotation(entry.annotation)}
                                >
                                  <div className="relative h-16 w-full overflow-hidden rounded bg-zinc-100">
                                    <span
                                      className={classNames(
                                        "absolute left-1 top-1 z-10 h-3.5 w-3.5 rounded-full border shadow-sm",
                                        paperColorDotClass(entry.annotation.paperColor),
                                      )}
                                      title={`色: ${paperColorLabel(entry.annotation.paperColor, entry.annotation.paperColorOther)}`}
                                    />
                                    {entry.image ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={entry.image.url}
                                        alt={entry.image.name}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-zinc-500">画像なし</div>
                                    )}
                                  </div>
                                  <div className="mt-1 truncate font-medium text-zinc-800">
                                    {entry.annotation.layer || "-"} / {entry.annotation.keyframeNumber || "-"}
                                  </div>
                                  <div className="truncate text-zinc-500">
                                    {classificationLabel(entry.classification)} /{" "}
                                    {paperColorLabel(entry.annotation.paperColor, entry.annotation.paperColorOther)}
                                    {entry.annotation.compositeInstructionFlag ? " / 合成" : ""}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-4 text-sm text-zinc-500">保存済みの注釈がありません。</p>
              )}
            </div>
          </section>
        )}
      </section>

      <aside className="flex min-h-0 flex-col gap-2 lg:overflow-y-auto lg:pr-1">
        <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2">
            <input
              ref={(node) => {
                directoryInputRef.current = node;
                node?.setAttribute("webkitdirectory", "");
                node?.setAttribute("directory", "");
              }}
              id="image-folder"
              type="file"
              multiple
              accept={imageAccept}
              className="hidden"
              onChange={handleDirectorySelect}
            />
            <input ref={csvInputRef} id="csv-file" type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvSelect} />
            <button className="primary-button" type="button" onClick={() => directoryInputRef.current?.click()}>
              ローカル画像を読み込む
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="control-button" type="button" onClick={() => csvInputRef.current?.click()}>
                CSVを読み込む
              </button>
              <button className="control-button" type="button" onClick={downloadCsv} disabled={annotations.length === 0}>
                CSVを書き出す
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md border border-zinc-200 p-1.5">
              <span className="block text-base font-semibold">{images.length}</span>
              画像
            </div>
            <div className="rounded-md border border-zinc-200 p-1.5">
              <span className="block text-base font-semibold">{annotations.length}</span>
              行
            </div>
            <div className="rounded-md border border-zinc-200 p-1.5">
              <span className="block text-base font-semibold">{totalWithAnnotations}</span>
              入力済
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2">
            <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
              <div className="grid gap-1">
                <label className="field-label" htmlFor="layer">
                  レイヤー
                </label>
                <input
                  ref={layerInputRef}
                  id="layer"
                  list="layer-options"
                  className="field-control"
                  value={draft.layer}
                  disabled={locked}
                  onChange={(event) => setDraft((previous) => ({ ...previous, layer: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      keyframeInputRef.current?.focus();
                    }
                  }}
                />
              </div>
              <div className="grid gap-1">
                <label className="field-label" htmlFor="keyframe-number">
                  番号
                </label>
                <input
                  ref={keyframeInputRef}
                  id="keyframe-number"
                  className="field-control"
                  value={draft.keyframeNumber}
                  disabled={locked}
                  onChange={(event) => setDraft((previous) => ({ ...previous, keyframeNumber: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && !event.metaKey && event.key === "Enter" && canSave) {
                      saveDraft("stay");
                    }
                  }}
                />
              </div>
            </div>
            <datalist id="layer-options">
              {layerOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </datalist>

            <fieldset className="grid gap-2">
              <legend className="field-label">資料種別</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["layout", "レイアウト", "Ctrl+1"],
                  ["correction_layout", "修正レイアウト", "Ctrl+2"],
                  ["rough_keyframe", "ラフ原画", "Ctrl+3"],
                  ["correction_rough_keyframe", "修正ラフ原画", "Ctrl+4"],
                  ["reference", "参考", "Ctrl+5"],
                  ["book", "Book", "Ctrl+6"],
                  ["assembly_instruction", "組み指示", "Ctrl+K"],
                  ["blank_paper", "白紙", "Ctrl+7"],
                ].map(([value, label, shortcut]) => (
                  <label
                    key={value}
                    className={classNames(
                      "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm font-medium text-zinc-700",
                      materialMark === value ? "border-zinc-900 bg-zinc-100" : "border-zinc-200",
                    )}
                  >
                    <input
                      type="radio"
                      name="material-mark"
                      className="h-4 w-4"
                      value={value}
                      checked={materialMark === value}
                      disabled={locked}
                      onChange={() => updateMaterialMark(value as MaterialMark)}
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="text-xs font-normal text-zinc-500">{shortcut}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="field-label">色</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["white", "白", "Ctrl+8"],
                  ["pink", "ピンク", "Ctrl+9"],
                  ["yellow", "黄", "Ctrl+0"],
                  ["other", "その他", "Ctrl+-"],
                ].map(([value, label, shortcut]) => (
                  <label
                    key={value}
                    className={classNames(
                      "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm font-medium text-zinc-700",
                      draft.paperColor === value ? "border-zinc-900 bg-zinc-100" : "border-zinc-200",
                    )}
                  >
                    <input
                      type="radio"
                      name="paper-color"
                      className="h-4 w-4"
                      value={value}
                      checked={draft.paperColor === value}
                      disabled={locked}
                      onChange={() => updatePaperColor(value as PaperColor)}
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {shortcut ? <span className="text-xs font-normal text-zinc-500">{shortcut}</span> : null}
                  </label>
                ))}
              </div>
              {draft.paperColor === "other" ? (
                <input
                  className="field-control"
                  value={draft.paperColorOther}
                  disabled={locked}
                  placeholder="色を入力"
                  onChange={(event) => updatePaperColorOther(event.target.value)}
                />
              ) : null}
            </fieldset>

            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs font-medium text-zinc-700">
              資料種別: {classificationLabel(draftClassification)} / 色: {paperColorLabel(draft.paperColor, draft.paperColorOther)}
            </p>

            <label
              className={classNames(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm font-medium text-zinc-700",
                draft.compositeInstructionFlag ? "border-zinc-900 bg-zinc-100" : "border-zinc-200",
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.compositeInstructionFlag}
                disabled={locked}
                onChange={(event) => updateCompositeInstructionFlag(event.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate">合成指示</span>
              <span className="text-xs font-normal text-zinc-500">Ctrl+Q</span>
            </label>

            <div className="grid gap-2 pt-2">
              {locked ? (
                <button className="primary-button" type="button" onClick={enableEditMode}>
                  編集する
                </button>
              ) : (
                <button className="primary-button" type="button" onClick={() => saveDraft("stay")} disabled={!canSave}>
                  保存する
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button className="control-button" type="button" onClick={addAnother} disabled={!currentImage}>
                  枠と番号を追加
                </button>
                <button
                  className="control-button"
                  type="button"
                  onClick={deleteActiveAnnotation}
                  disabled={!currentImage || (!selectedId && !editingId && !draft.bbox)}
                >
                  削除
                </button>
              </div>
            </div>
            <p className="text-xs leading-5 text-zinc-500">
              Ctrl: I画像 / O読込 / Enter保存 / 1レイアウト / 2修正レイアウト / 3ラフ原画 / 4修正ラフ / 5参考 / 6Book / 7白紙 / K組み指示 / 8白 / 9桃 / 0黄 / -他色 / Q合成
            </p>
          </div>
        </section>

        <section className="min-h-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-900">既存行</h2>
          <div className="mt-2 max-h-36 overflow-auto rounded-md border border-zinc-200 lg:max-h-none">
            {currentAnnotations.length > 0 ? (
              currentAnnotations.map((annotation, rowIndex) => (
                <button
                  key={annotation.id}
                  type="button"
                  className={classNames(
                    "flex w-full items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-zinc-50",
                    annotation.id === selectedId && "bg-blue-50",
                  )}
                  onClick={() => selectAnnotation(annotation)}
                >
                  <span className="min-w-0 truncate">
                    {rowIndex + 1}. {annotation.bbox ? "□" : "-"} {annotation.layer} / {annotation.keyframeNumber}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {classificationLabel(classifyAnnotation(annotation))} / {paperColorLabel(annotation.paperColor, annotation.paperColorOther)}
                    {annotation.compositeInstructionFlag ? " / 合成" : ""}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-sm text-zinc-500">既存データ: なし</p>
            )}
          </div>
        </section>

        <p className="rounded-lg border border-zinc-200 bg-white p-2 text-xs leading-5 text-zinc-700 shadow-sm">{status}</p>
      </aside>
    </div>
  );
}
