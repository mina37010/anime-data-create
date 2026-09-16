"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as UTIF from "utif";

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"]);
const imageAccept = "image/*,.tif,.tiff,.csv";
const naturalCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
const csvColumns = [
  "collection_title",
  "image_filename",
  "target_name",
  "target_type",
  "sub_target_variation",
  "material_content",
  "production_status",
  "reference_type",
  "sheet_number",
  "production_date",
] as const;

const targetTypeOptions = ["キャラクター", "衣装", "小物", "背景", "クリーチャー"];
const materialContentOptions = ["全身", "表情", "対比", "頭部"];
const productionStatusOptions = ["ラフ", "決定稿", "未記載"];
const referenceTypeOptions = ["影参考", "ポーズ参考", "ロッド参考", "一般参考"];

type ImageEntry = {
  file: File;
  name: string;
  url: string;
  width: number;
  height: number;
};

type MetadataDraft = {
  targetName: string;
  targetType: string;
  subTargetVariation: string;
  materialContent: string;
  productionStatus: string;
  referenceType: string;
  sheetNumber: string;
  productionDate: string;
};

type MetadataByImage = Record<string, MetadataDraft>;

const emptyMetadata: MetadataDraft = {
  targetName: "",
  targetType: "",
  subTargetVariation: "",
  materialContent: "",
  productionStatus: "",
  referenceType: "",
  sheetNumber: "",
  productionDate: "",
};

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

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function splitMultiValue(value: string) {
  return value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function displayMultiValue(value: string) {
  return splitMultiValue(value).join("\n");
}

function csvMultiValue(value: string) {
  return splitMultiValue(value).join(";");
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

function readMetadataCsv(text: string) {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));
  const nextMetadata: MetadataByImage = {};
  let nextCollectionTitle = "";

  rows.slice(1).forEach((row) => {
    const imageFilename = row[indexes.image_filename]?.trim();
    if (!imageFilename) {
      return;
    }
    nextCollectionTitle ||= row[indexes.collection_title] ?? "";
    nextMetadata[imageFilename] = {
      targetName: displayMultiValue(row[indexes.target_name] ?? ""),
      targetType: row[indexes.target_type] ?? "",
      subTargetVariation: row[indexes.sub_target_variation] ?? "",
      materialContent: row[indexes.material_content] ?? "",
      productionStatus: row[indexes.production_status] ?? "",
      referenceType: row[indexes.reference_type] ?? "",
      sheetNumber: row[indexes.sheet_number] ?? "",
      productionDate: row[indexes.production_date] ?? "",
    };
  });

  return { collectionTitle: nextCollectionTitle, metadata: nextMetadata };
}

function metadataIsFilled(metadata: MetadataDraft) {
  return Object.values(metadata).some((value) => value.trim().length > 0);
}

function metadataForImage(metadataByImage: MetadataByImage, imageName: string) {
  return metadataByImage[imageName] ?? emptyMetadata;
}

function frequentValues(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || naturalCollator.compare(a[0], b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function generatedCollectionTitle(images: ImageEntry[], metadataByImage: MetadataByImage) {
  const metadataList = images.map((image) => metadataForImage(metadataByImage, image.name)).filter(metadataIsFilled);
  if (metadataList.length === 0) {
    return "";
  }

  const targetNames = frequentValues(metadataList.flatMap((metadata) => splitMultiValue(metadata.targetName)), 3);
  const targetTypes = frequentValues(metadataList.map((metadata) => metadata.targetType), 2);
  const variations = frequentValues(metadataList.map((metadata) => metadata.subTargetVariation), 2);
  const materialContents = frequentValues(metadataList.map((metadata) => metadata.materialContent), 3);
  const referenceTypes = frequentValues(metadataList.map((metadata) => metadata.referenceType), 1);
  const sheetNumbers = metadataList.map((metadata) => metadata.sheetNumber.trim()).filter(Boolean);
  const dates = metadataList.map((metadata) => metadata.productionDate.trim()).filter(Boolean);
  const dateRange =
    dates.length > 0
      ? Array.from(new Set(dates)).sort((a, b) => naturalCollator.compare(a, b))
      : [];
  const sheetRange =
    sheetNumbers.length > 0
      ? Array.from(new Set(sheetNumbers)).sort((a, b) => naturalCollator.compare(a, b))
      : [];

  return [
    targetNames.join("・"),
    targetTypes.join("・"),
    variations.join("・"),
    materialContents.join("・"),
    referenceTypes.join("・"),
    sheetRange.length > 0 ? `シート${sheetRange.length === 1 ? sheetRange[0] : `${sheetRange[0]}-${sheetRange.at(-1)}`}` : "",
    dateRange.length > 0 ? (dateRange.length === 1 ? dateRange[0] : `${dateRange[0]}-${dateRange.at(-1)}`) : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

export function ModelSheetMetadataEditor() {
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<ImageEntry[]>([]);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [metadataByImage, setMetadataByImage] = useState<MetadataByImage>({});
  const [status, setStatus] = useState("モデルシート画像を読み込んでください。");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
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
  const currentMetadata = currentImage ? metadataForImage(metadataByImage, currentImage.name) : emptyMetadata;
  const completedCount = useMemo(() => {
    return images.filter((image) => metadataIsFilled(metadataForImage(metadataByImage, image.name))).length;
  }, [images, metadataByImage]);
  const autoCollectionTitle = useMemo(() => generatedCollectionTitle(images, metadataByImage), [images, metadataByImage]);
  const effectiveCollectionTitle = collectionTitle.trim() || autoCollectionTitle;

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

      if (csvFile) {
        const loadedCsv = readMetadataCsv(await csvFile.text());
        setCollectionTitle(loadedCsv.collectionTitle);
        setMetadataByImage(loadedCsv.metadata);
        setStatus(`${loadedImages.length} 画像とCSVを読み込みました。`);
      } else {
        setMetadataByImage({});
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
    const loadedCsv = readMetadataCsv(await file.text());
    setCollectionTitle(loadedCsv.collectionTitle);
    setMetadataByImage(loadedCsv.metadata);
    setStatus("CSVを読み込みました。");
    event.target.value = "";
  }

  function updateCurrentMetadata(key: keyof MetadataDraft, value: string) {
    if (!currentImage) {
      return;
    }
    setMetadataByImage((previous) => ({
      ...previous,
      [currentImage.name]: {
        ...metadataForImage(previous, currentImage.name),
        [key]: value,
      },
    }));
  }

  function copyPrevious() {
    if (!currentImage || currentIndex <= 0) {
      return;
    }
    const previousImage = images[currentIndex - 1];
    const previousMetadata = metadataForImage(metadataByImage, previousImage.name);
    setMetadataByImage((previous) => ({
      ...previous,
      [currentImage.name]: previousMetadata,
    }));
    setStatus("前の画像のメタデータをコピーしました。");
  }

  function downloadCsv() {
    const lines = [
      csvColumns.join(","),
      ...images.map((image) => {
        const metadata = metadataForImage(metadataByImage, image.name);
        return [
          effectiveCollectionTitle,
          image.name,
          csvMultiValue(metadata.targetName),
          metadata.targetType,
          metadata.subTargetVariation,
          metadata.materialContent,
          metadata.productionStatus,
          metadata.referenceType,
          metadata.sheetNumber,
          metadata.productionDate,
        ]
          .map(csvEscape)
          .join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "model_sheet_metadata.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("model_sheet_metadata.csv を書き出しました。");
  }

  return (
    <div className="grid gap-3 lg:h-[calc(100vh-92px)] lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden">
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
          <button className="control-button" type="button" disabled={images.length === 0} onClick={downloadCsv}>
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
              min="20"
              max="300"
              step="10"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span className="w-10 text-right">{zoom}%</span>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-zinc-100 p-3">
          {currentImage ? (
            <div className="mx-auto w-fit">
              <p className="mb-2 text-center text-sm font-semibold text-zinc-700">
                {currentIndex + 1} / {images.length} {currentImage.name}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentImage.url}
                alt=""
                className="block h-auto bg-white shadow-sm"
                style={{ width: `${currentImage.width * (zoom / 100)}px`, maxWidth: "none" }}
                draggable={false}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
              モデルシート画像フォルダを読み込んでください。
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span className="field-label">全体タイトル</span>
              <input
                className="field-control"
                value={collectionTitle}
                onChange={(event) => setCollectionTitle(event.target.value)}
                placeholder={autoCollectionTitle || "入力内容から自動生成"}
              />
            </label>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs leading-5 text-zinc-600">
              自動: {autoCollectionTitle || "未生成"}
              {collectionTitle.trim() ? " / 手入力が優先されます" : ""}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border border-zinc-200 p-1.5">
                <span className="block text-base font-semibold">{images.length}</span>
                画像
              </div>
              <div className="rounded-md border border-zinc-200 p-1.5">
                <span className="block text-base font-semibold">{completedCount}</span>
                入力済
              </div>
              <div className="rounded-md border border-zinc-200 p-1.5">
                <span className="block text-base font-semibold">{currentImage ? currentIndex + 1 : 0}</span>
                現在
              </div>
            </div>
          </div>
        </section>

        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span className="field-label">対象名</span>
              <textarea
                className="field-control h-20 resize-y"
                value={currentMetadata.targetName}
                disabled={!currentImage}
                placeholder={"風見あつこ\nロッテ\n新月の塔"}
                onChange={(event) => updateCurrentMetadata("targetName", event.target.value)}
              />
              <span className="text-xs leading-5 text-zinc-500">1行に1対象。CSVでは ; 区切りで保存します。</span>
            </label>
            <label className="grid gap-1">
              <span className="field-label">対象種別</span>
              <input
                className="field-control"
                list="model-sheet-target-type-options"
                value={currentMetadata.targetType}
                disabled={!currentImage}
                placeholder="キャラクター、衣装、小物、背景、クリーチャー"
                onChange={(event) => updateCurrentMetadata("targetType", event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="field-label">サブ対象・バリエーション</span>
              <input
                className="field-control"
                value={currentMetadata.subTargetVariation}
                disabled={!currentImage}
                placeholder="幼年、第五形態、魔導石の間、制服"
                onChange={(event) => updateCurrentMetadata("subTargetVariation", event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="field-label">資料内容</span>
              <input
                className="field-control"
                list="model-sheet-material-content-options"
                value={currentMetadata.materialContent}
                disabled={!currentImage}
                placeholder="全身、表情、対比、頭部"
                onChange={(event) => updateCurrentMetadata("materialContent", event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="field-label">制作状態</span>
                <input
                  className="field-control"
                  list="model-sheet-production-status-options"
                  value={currentMetadata.productionStatus}
                  disabled={!currentImage}
                  placeholder="ラフ、決定稿、未記載"
                  onChange={(event) => updateCurrentMetadata("productionStatus", event.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="field-label">参考種別</span>
                <input
                  className="field-control"
                  list="model-sheet-reference-type-options"
                  value={currentMetadata.referenceType}
                  disabled={!currentImage}
                  placeholder="影参考、ポーズ参考、ロッド参考、一般参考"
                  onChange={(event) => updateCurrentMetadata("referenceType", event.target.value)}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="field-label">シート番号等</span>
                <input
                  className="field-control"
                  value={currentMetadata.sheetNumber}
                  disabled={!currentImage}
                  placeholder="1、2、3、4"
                  onChange={(event) => updateCurrentMetadata("sheetNumber", event.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="field-label">制作日</span>
                <input
                  className="field-control"
                  type="date"
                  value={currentMetadata.productionDate}
                  disabled={!currentImage}
                  onChange={(event) => updateCurrentMetadata("productionDate", event.target.value)}
                />
              </label>
            </div>
            <button className="control-button" type="button" disabled={!currentImage || currentIndex <= 0} onClick={copyPrevious}>
              前の画像からコピー
            </button>
          </div>

          <datalist id="model-sheet-target-type-options">
            {targetTypeOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <datalist id="model-sheet-material-content-options">
            {materialContentOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <datalist id="model-sheet-production-status-options">
            {productionStatusOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <datalist id="model-sheet-reference-type-options">
            {referenceTypeOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </section>

        <section className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-900">画像一覧</h2>
          <div className="mt-2 max-h-[34vh] overflow-auto rounded-md border border-zinc-200">
            {images.length > 0 ? (
              images.map((image, index) => {
                const metadata = metadataForImage(metadataByImage, image.name);
                const targetNameSummary = splitMultiValue(metadata.targetName).join("・");
                return (
                  <button
                    key={image.name}
                    type="button"
                    className={`grid w-full gap-1 border-b border-zinc-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-zinc-50 ${
                      index === currentIndex ? "bg-blue-50" : ""
                    }`}
                    onClick={() => setCurrentIndex(index)}
                  >
                    <span className="truncate font-semibold text-zinc-900">{image.name}</span>
                    <span className="truncate text-zinc-600">
                      {metadataIsFilled(metadata)
                        ? [targetNameSummary, metadata.targetType, metadata.subTargetVariation, metadata.materialContent]
                            .filter(Boolean)
                            .join(" / ")
                        : "未入力"}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-4 text-sm text-zinc-500">画像未読み込み</p>
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
