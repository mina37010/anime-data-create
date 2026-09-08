"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as UTIF from "utif";

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"]);
const imageAccept = "image/*,.tif,.tiff,.csv";
const csvColumns = ["image_filename", "property_key", "property_label", "value", "x1", "y1", "x2", "y2"] as const;
const naturalCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

const cutBagProperties = [
  { key: "cut_number", label: "カット番号" },
  { key: "episode_number", label: "EP番号" },
  { key: "title", label: "タイトル" },
  { key: "duration", label: "秒数" },
  { key: "key_animation_staff", label: "原画担当" },
  { key: "inbetween_staff", label: "動画担当" },
  { key: "animation_check_director", label: "動画監督" },
  { key: "scan_resolution", label: "スキャン解像度" },
  { key: "offset", label: "オフセット" },
  { key: "size", label: "サイズ" },
  { key: "trace_staff", label: "Trace担当" },
  { key: "paint_staff", label: "Paint担当" },
  { key: "color_design_staff", label: "色指定担当" },
  { key: "special_effects_staff", label: "特殊効果担当" },
  { key: "three_d_staff", label: "3D担当" },
  { key: "finish_check_staff", label: "仕上げ検査担当" },
  { key: "compositing_staff", label: "撮影" },
  { key: "memo", label: "Memo" },
  { key: "other", label: "その他" },
] as const;

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
  width: number;
  height: number;
};

type CutBagPropertyKey = (typeof cutBagProperties)[number]["key"];

type Annotation = {
  id: string;
  imageFilename: string;
  propertyKey: CutBagPropertyKey;
  propertyLabel: string;
  value: string;
  bbox: Bbox;
};

type Draft = {
  propertyKey: CutBagPropertyKey;
  value: string;
  bbox: Bbox | null;
};

const initialDraft: Draft = {
  propertyKey: "cut_number",
  value: "",
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

function fileExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function isImageFile(file: File) {
  return imageExtensions.has(fileExtension(file));
}

function isCsvFile(file: File) {
  return file.name.toLowerCase().endsWith(".csv");
}

function isTiffFile(file: File) {
  const extension = fileExtension(file);
  return extension === "tif" || extension === "tiff";
}

function fileDisplayName(file: File) {
  return file.webkitRelativePath || file.name;
}

function propertyLabel(propertyKey: CutBagPropertyKey) {
  return cutBagProperties.find((property) => property.key === propertyKey)?.label ?? propertyKey;
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

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some((value) => value.trim().length > 0));
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function annotationsFromCsv(text: string) {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));

  return rows.slice(1).flatMap((row, rowIndex) => {
    const propertyKey = row[indexes.property_key] as CutBagPropertyKey | undefined;
    const validProperty = cutBagProperties.some((property) => property.key === propertyKey);
    const bbox = normalizeBbox({
      x1: Number(row[indexes.x1] ?? 0),
      y1: Number(row[indexes.y1] ?? 0),
      x2: Number(row[indexes.x2] ?? 0),
      y2: Number(row[indexes.y2] ?? 0),
    });

    if (!propertyKey || !validProperty || !bbox) {
      return [];
    }

    return [
      {
        id: `csv-${Date.now()}-${rowIndex}`,
        imageFilename: row[indexes.image_filename] ?? "",
        propertyKey,
        propertyLabel: row[indexes.property_label] || propertyLabel(propertyKey),
        value: row[indexes.value] ?? "",
        bbox,
      },
    ];
  });
}

async function imageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => reject(new Error("画像サイズを取得できませんでした。"));
    image.src = url;
  });
}

async function previewUrlForImage(file: File) {
  if (!isTiffFile(file)) {
    const url = URL.createObjectURL(file);
    const size = await imageSize(url);
    return { url, ...size };
  }

  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  const ifd = ifds[0];
  if (!ifd) {
    throw new Error("TIFF の画像データが見つかりませんでした。");
  }

  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const width = ifd.width || 1;
  const height = ifd.height || 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("プレビュー用 canvas を作成できませんでした。");
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const url = await new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("TIFF プレビューの変換に失敗しました。"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });

  return { url, width, height };
}

function pointerToImagePoint(event: PointerEvent<HTMLElement>, image: ImageEntry, imageElement: HTMLImageElement | null) {
  if (!imageElement) {
    return null;
  }
  const rect = imageElement.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * image.width;
  const y = ((event.clientY - rect.top) / rect.height) * image.height;
  return {
    x: Math.max(0, Math.min(image.width, x)),
    y: Math.max(0, Math.min(image.height, y)),
  };
}

function bboxStyle(bbox: Bbox, image: ImageEntry) {
  const normalized = normalizeBbox(bbox);
  if (!normalized) {
    return {};
  }

  return {
    left: `${(normalized.x1 / image.width) * 100}%`,
    top: `${(normalized.y1 / image.height) * 100}%`,
    width: `${((normalized.x2 - normalized.x1) / image.width) * 100}%`,
    height: `${((normalized.y2 - normalized.y1) / image.height) * 100}%`,
  };
}

export function CutBagLabeler() {
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const imagePanelRef = useRef<HTMLDivElement | null>(null);
  const imagesRef = useRef<ImageEntry[]>([]);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("カット袋画像を読み込んでください。");
  const [loading, setLoading] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  useEffect(() => {
    const panel = imagePanelRef.current;
    if (!panel) {
      return;
    }

    const updatePanelSize = () => {
      setPanelSize({
        width: panel.clientWidth,
        height: panel.clientHeight,
      });
    };
    updatePanelSize();

    const resizeObserver = new ResizeObserver(updatePanelSize);
    resizeObserver.observe(panel);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCurrentIndex((index) => Math.max(0, index - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCurrentIndex((index) => Math.min(images.length - 1, index + 1));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length]);

  const currentImage = images[currentIndex] ?? null;
  const currentAnnotations = useMemo(() => {
    if (!currentImage) {
      return [];
    }
    return annotations.filter((annotation) => annotation.imageFilename === currentImage.name);
  }, [annotations, currentImage]);
  const normalizedDraftBbox = normalizeBbox(draft.bbox);
  const canSave = Boolean(currentImage && normalizedDraftBbox && draft.value.trim());
  const fitScale = currentImage
    ? Math.min(
        Math.max((panelSize.width - 24) / currentImage.width, 0.05),
        Math.max((panelSize.height - 56) / currentImage.height, 0.05),
        1,
      )
    : 1;
  const displayScale = fitScale * (zoom / 100);

  async function loadFiles(files: File[]) {
    const imageFiles = files.filter(isImageFile).sort((a, b) => naturalCollator.compare(fileDisplayName(a), fileDisplayName(b)));
    const csvFile = files.filter(isCsvFile).sort((a, b) => naturalCollator.compare(a.name, b.name))[0] ?? null;

    if (imageFiles.length === 0) {
      setStatus("画像ファイルが見つかりませんでした。");
      return;
    }

    setLoading(true);
    setStatus("画像を読み込んでいます。");
    try {
      const loadedImages = await Promise.all(
        imageFiles.map(async (file) => {
          const preview = await previewUrlForImage(file);
          return {
            file,
            name: fileDisplayName(file),
            url: preview.url,
            width: preview.width,
            height: preview.height,
          };
        }),
      );

      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
      setImages(loadedImages);
      setCurrentIndex(0);
      setDraft(initialDraft);
      setSelectedId(null);

      if (csvFile) {
        const csvText = await csvFile.text();
        const loadedAnnotations = annotationsFromCsv(csvText);
        setAnnotations(loadedAnnotations);
        setStatus(`${loadedImages.length} 画像と ${loadedAnnotations.length} 行のCSVを読み込みました。`);
      } else {
        setAnnotations([]);
        setStatus(`${loadedImages.length} 画像を読み込みました。`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "画像の読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function handleDirectorySelect(event: ChangeEvent<HTMLInputElement>) {
    await loadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function handleCsvSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const loadedAnnotations = annotationsFromCsv(await file.text());
    setAnnotations(loadedAnnotations);
    setSelectedId(null);
    setDraft(initialDraft);
    setStatus(`${loadedAnnotations.length} 行のCSVを読み込みました。`);
    event.target.value = "";
  }

  function startDrawing(event: PointerEvent<HTMLDivElement>) {
    if (!currentImage || loading || !imageElementRef.current) {
      return;
    }
    const point = pointerToImagePoint(event, currentImage, imageElementRef.current);
    if (!point) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = point;
    setIsDrawing(true);
    setSelectedId(null);
    setDraft((previous) => ({
      ...previous,
      bbox: { x1: point.x, y1: point.y, x2: point.x, y2: point.y },
    }));
  }

  function moveDrawing(event: PointerEvent<HTMLDivElement>) {
    if (!isDrawing || !currentImage || !dragStartRef.current || !imageElementRef.current) {
      return;
    }
    const point = pointerToImagePoint(event, currentImage, imageElementRef.current);
    if (!point) {
      return;
    }
    const start = dragStartRef.current;
    setDraft((previous) => ({
      ...previous,
      bbox: { x1: start.x, y1: start.y, x2: point.x, y2: point.y },
    }));
  }

  function endDrawing(event: PointerEvent<HTMLDivElement>) {
    if (!isDrawing) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDrawing(false);
    dragStartRef.current = null;
  }

  function selectAnnotation(annotation: Annotation) {
    setSelectedId(annotation.id);
    setDraft({
      propertyKey: annotation.propertyKey,
      value: annotation.value,
      bbox: annotation.bbox,
    });
    setStatus(`${annotation.propertyLabel} を選択しました。`);
  }

  function saveDraft(moveNext = false) {
    if (!currentImage || !normalizedDraftBbox || !draft.value.trim()) {
      setStatus("領域、プロパティ、値を入力してください。");
      return;
    }

    const nextAnnotation: Annotation = {
      id: selectedId ?? crypto.randomUUID(),
      imageFilename: currentImage.name,
      propertyKey: draft.propertyKey,
      propertyLabel: propertyLabel(draft.propertyKey),
      value: draft.value.trim(),
      bbox: normalizedDraftBbox,
    };

    setAnnotations((previous) =>
      selectedId
        ? previous.map((annotation) => (annotation.id === selectedId ? nextAnnotation : annotation))
        : [...previous, nextAnnotation],
    );
    setSelectedId(null);
    setDraft((previous) => ({ ...initialDraft, propertyKey: previous.propertyKey }));
    setStatus(`${nextAnnotation.propertyLabel} を保存しました。`);

    if (moveNext) {
      setCurrentIndex((index) => Math.min(images.length - 1, index + 1));
    }
  }

  function deleteSelected() {
    if (!selectedId) {
      setDraft((previous) => ({ ...previous, bbox: null }));
      setStatus("未保存の領域を削除しました。");
      return;
    }
    setAnnotations((previous) => previous.filter((annotation) => annotation.id !== selectedId));
    setSelectedId(null);
    setDraft(initialDraft);
    setStatus("選択中の行を削除しました。");
  }

  function downloadCsv() {
    const lines = [
      csvColumns.join(","),
      ...annotations.map((annotation) =>
        [
          annotation.imageFilename,
          annotation.propertyKey,
          annotation.propertyLabel,
          annotation.value,
          annotation.bbox.x1,
          annotation.bbox.y1,
          annotation.bbox.x2,
          annotation.bbox.y2,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cut_bag.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("cut_bag.csv を書き出しました。");
  }

  return (
    <div className="grid gap-3 lg:h-[calc(100vh-92px)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 p-2">
          <input
            ref={(node) => {
              directoryInputRef.current = node;
              node?.setAttribute("webkitdirectory", "");
              node?.setAttribute("directory", "");
            }}
            type="file"
            multiple
            accept={imageAccept}
            className="hidden"
            onChange={handleDirectorySelect}
          />
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvSelect} />
          <button className="primary-button" type="button" disabled={loading} onClick={() => directoryInputRef.current?.click()}>
            フォルダを読み込む
          </button>
          <button className="control-button" type="button" onClick={() => csvInputRef.current?.click()}>
            CSVを読み込む
          </button>
          <button className="control-button" type="button" disabled={annotations.length === 0} onClick={downloadCsv}>
            CSVを書き出す
          </button>
          <button className="control-button" type="button" disabled={currentIndex <= 0} onClick={() => setCurrentIndex((index) => index - 1)}>
            前へ
          </button>
          <button
            className="control-button"
            type="button"
            disabled={!currentImage || currentIndex >= images.length - 1}
            onClick={() => setCurrentIndex((index) => index + 1)}
          >
            次へ
          </button>
          <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-zinc-600">
            倍率
            <input
              type="range"
              min="10"
              max="800"
              step="10"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span className="w-10 text-right">{zoom}%</span>
          </label>
          <button className="control-button" type="button" onClick={() => setZoom(100)}>
            全体
          </button>
        </div>

        <div ref={imagePanelRef} className="min-h-0 flex-1 overflow-auto bg-zinc-100 p-3">
          {currentImage ? (
            <div className="mx-auto w-fit">
              <p className="mb-2 text-center text-sm font-semibold text-zinc-700">
                {currentIndex + 1} / {images.length} {currentImage.name}
              </p>
              <div
                className="relative select-none"
                style={{ width: `${currentImage.width * displayScale}px`, maxWidth: "none" }}
                onPointerDown={startDrawing}
                onPointerMove={moveDrawing}
                onPointerUp={endDrawing}
                onPointerCancel={endDrawing}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imageElementRef}
                  src={currentImage.url}
                  alt=""
                  className="block h-auto w-full bg-white shadow-sm"
                  draggable={false}
                />
                {currentAnnotations.map((annotation) => (
                  <button
                    key={annotation.id}
                    type="button"
                    className={classNames(
                      "absolute border-2 bg-blue-500/10 text-left text-[10px] font-bold text-blue-900",
                      selectedId === annotation.id ? "border-red-500 bg-red-500/10" : "border-blue-500",
                    )}
                    style={bboxStyle(annotation.bbox, currentImage)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectAnnotation(annotation);
                    }}
                  >
                    <span className="inline-block max-w-full truncate bg-white/85 px-1">
                      {annotation.propertyLabel}
                    </span>
                  </button>
                ))}
                {normalizedDraftBbox ? (
                  <div
                    className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-500/10"
                    style={bboxStyle(normalizedDraftBbox, currentImage)}
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
              カット袋画像フォルダを読み込んでください。
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span className="field-label">プロパティ</span>
              <select
                className="field-control"
                value={draft.propertyKey}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, propertyKey: event.target.value as CutBagPropertyKey }))
                }
              >
                {cutBagProperties.map((property) => (
                  <option key={property.key} value={property.key}>
                    {property.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="field-label">値</span>
              <input
                className="field-control"
                value={draft.value}
                onChange={(event) => setDraft((previous) => ({ ...previous, value: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.key === "Enter") {
                    event.preventDefault();
                    saveDraft(false);
                  }
                }}
              />
            </label>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-600">
              領域:{" "}
              {normalizedDraftBbox
                ? `${normalizedDraftBbox.x1}, ${normalizedDraftBbox.y1}, ${normalizedDraftBbox.x2}, ${normalizedDraftBbox.y2}`
                : "未指定"}
            </p>
            <button className="primary-button" type="button" disabled={!canSave} onClick={() => saveDraft(false)}>
              保存
            </button>
            <button
              className="control-button"
              type="button"
              disabled={!selectedId && !draft.bbox}
              onClick={deleteSelected}
            >
              削除
            </button>
          </div>
        </section>

        <section className="min-h-0 shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-900">既存行</h2>
          <div className="mt-2 max-h-64 overflow-auto rounded-md border border-zinc-200">
            {currentAnnotations.length > 0 ? (
              currentAnnotations.map((annotation) => (
                <button
                  key={annotation.id}
                  type="button"
                  className={classNames(
                    "grid w-full gap-1 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-zinc-50",
                    selectedId === annotation.id && "bg-blue-50",
                  )}
                  onClick={() => selectAnnotation(annotation)}
                >
                  <span className="font-semibold text-zinc-900">{annotation.propertyLabel}</span>
                  <span className="truncate text-zinc-600">{annotation.value}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-sm text-zinc-500">既存データ: なし</p>
            )}
          </div>
        </section>

        <section className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-900">全体</h2>
          <div className="mt-2 max-h-[34vh] overflow-auto rounded-md border border-zinc-200">
            {annotations.length > 0 ? (
              annotations.map((annotation) => (
                <button
                  key={annotation.id}
                  type="button"
                  className={classNames(
                    "grid w-full gap-1 border-b border-zinc-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-zinc-50",
                    selectedId === annotation.id && "bg-blue-50",
                  )}
                  onClick={() => {
                    const imageIndex = images.findIndex((image) => image.name === annotation.imageFilename);
                    if (imageIndex >= 0) {
                      setCurrentIndex(imageIndex);
                    }
                    selectAnnotation(annotation);
                  }}
                >
                  <span className="truncate font-semibold text-zinc-900">
                    {annotation.imageFilename} / {annotation.propertyLabel}
                  </span>
                  <span className="truncate text-zinc-600">{annotation.value}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-sm text-zinc-500">保存済み行なし</p>
            )}
          </div>
        </section>

        <p className="sticky bottom-0 z-10 max-h-24 shrink-0 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 text-xs leading-5 text-zinc-700 shadow-sm">
          {status}
        </p>
      </aside>
    </div>
  );
}
