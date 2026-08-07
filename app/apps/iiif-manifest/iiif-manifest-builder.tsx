"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import * as UTIF from "utif";

const semanticLabels = ["background", "book", "frame"] as const;
const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff"]);
const imageAccept = "image/*,.tif,.tiff";
const naturalCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

type SemanticLabel = (typeof semanticLabels)[number];
type LabelOverride = "auto" | "name" | SemanticLabel;
type ManifestImageKind = SemanticLabel | "other";

type ImageRecord = {
  id: string;
  file: File;
  fileName: string;
  relativePath: string;
  pathInFolder: string;
  folderKey: string;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: string;
  labelOverride: LabelOverride;
};

type FolderRecord = {
  key: string;
  label: string;
};

type RegexSettings = Record<SemanticLabel, string>;

type CompiledRegex = {
  label: SemanticLabel;
  pattern: string;
  regex: RegExp | null;
  error: string | null;
};

type ImageWithLabel = ImageRecord & {
  effectiveLabel: SemanticLabel | null;
  displayLabel: string;
};

type FolderSummary = {
  folder: FolderRecord;
  imageCount: number;
  backgroundCount: number;
  bookCount: number;
  frameCount: number;
  otherCount: number;
};

type SourceImageFile = {
  file: File;
  relativePath: string;
};

type FileSystemEntryLike = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

type ZipEntry = {
  path: string;
  content: string;
};

const labelText: Record<SemanticLabel, string> = {
  background: "background",
  book: "book",
  frame: "frame",
};

const labelChipClass: Record<SemanticLabel, string> = {
  background: "border-emerald-300 bg-emerald-50 text-emerald-700",
  book: "border-sky-300 bg-sky-50 text-sky-700",
  frame: "border-amber-300 bg-amber-50 text-amber-800",
};

const defaultRegexSettings: RegexSettings = {
  background: "(^|[/_.\\s-])(bg|background|背景)[0-9０-９]*([/_.\\s-]|$)",
  book: "(^|[/_.\\s-])book[0-9０-９]*([/_.\\s-]|$)",
  frame: "(^|[/_.\\s-])(f|frame|fr|フレーム|枠)[0-9０-９]*([/_.\\s-]|$)",
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

function isTiffFile(file: File) {
  const extension = fileExtension(file);
  return extension === "tif" || extension === "tiff";
}

function fileDisplayPath(file: File) {
  return file.webkitRelativePath || file.name;
}

function fileMimeType(file: File) {
  if (file.type) {
    return file.type;
  }

  switch (fileExtension(file)) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "image/*";
  }
}

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

function folderKeyForPath(path: string) {
  const parts = splitPath(path);
  if (parts.length <= 1) {
    return "root";
  }
  return parts[0];
}

function pathInFolder(path: string) {
  const parts = splitPath(path);
  if (parts.length <= 1) {
    return parts[0] || path;
  }
  return parts.slice(1).join("/");
}

function stem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function encodePath(path: string) {
  return splitPath(path).map(encodeURIComponent).join("/");
}

function joinUrl(baseUrl: string, path: string) {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const encodedPath = encodePath(path);
  return encodedPath ? `${trimmedBase}/${encodedPath}` : trimmedBase;
}

function iiifImageServiceId(imageApiBaseUrl: string, image: ImageWithLabel) {
  const trimmedBase = imageApiBaseUrl.trim().replace(/!+$/, "");
  const parts = splitPath(image.relativePath);
  const serviceParts = parts.map((part, index) => {
    const value = index === parts.length - 1 ? stem(part) : part;
    return encodeURIComponent(value);
  });
  return serviceParts.length > 0 ? `${trimmedBase}!${serviceParts.join("!")}` : trimmedBase;
}

function iiifImageRequestUrl(imageApiBaseUrl: string, image: ImageWithLabel) {
  return `${iiifImageServiceId(imageApiBaseUrl, image)}/full/max/0/default.png`;
}

function labelMap(label: string) {
  return { ja: [label] };
}

function valueMap(value: string | string[]) {
  return { none: Array.isArray(value) ? value : [value] };
}

function imageManifestLabel(kind: ManifestImageKind, image: ImageWithLabel, prefix?: string) {
  const prefixText = prefix ? `${prefix}: ` : "";
  return `${kind}: ${prefixText}${image.fileName}`;
}

function imageMetadata(kind: ManifestImageKind, image: ImageWithLabel) {
  return [
    {
      label: labelMap("種別"),
      value: valueMap(kind),
    },
    {
      label: labelMap("ファイル名"),
      value: valueMap(image.fileName),
    },
  ];
}

function compileRegexSettings(settings: RegexSettings): CompiledRegex[] {
  return semanticLabels.map((label) => {
    const pattern = settings[label].trim();
    if (!pattern) {
      return { label, pattern, regex: null, error: null };
    }

    try {
      return { label, pattern, regex: new RegExp(pattern, "i"), error: null };
    } catch (error) {
      return {
        label,
        pattern,
        regex: null,
        error: error instanceof Error ? error.message : "正規表現が不正です。",
      };
    }
  });
}

function mappedLabelForImage(image: ImageRecord, compiledRegexes: CompiledRegex[]) {
  if (image.labelOverride !== "auto") {
    return image.labelOverride === "name" ? null : image.labelOverride;
  }

  const targetText = `${image.pathInFolder}\n${image.fileName}`;
  for (const item of compiledRegexes) {
    if (item.regex?.test(targetText)) {
      return item.label;
    }
  }
  return null;
}

function imageDisplayLabel(image: ImageRecord, effectiveLabel: SemanticLabel | null) {
  if (!effectiveLabel) {
    return stem(image.fileName);
  }
  return labelText[effectiveLabel];
}

async function loadImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => reject(new Error("画像サイズを取得できませんでした。"));
    image.src = url;
  });
}

async function previewForImage(file: File) {
  if (!isTiffFile(file)) {
    const url = URL.createObjectURL(file);
    const size = await loadImageSize(url);
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

async function createImageRecord(source: SourceImageFile): Promise<ImageRecord> {
  const { file, relativePath } = source;
  const preview = await previewForImage(file);
  return {
    id: `${relativePath}:${file.size}:${file.lastModified}`,
    file,
    fileName: file.name,
    relativePath,
    pathInFolder: pathInFolder(relativePath),
    folderKey: folderKeyForPath(relativePath),
    previewUrl: preview.url,
    width: preview.width,
    height: preview.height,
    mimeType: fileMimeType(file),
    labelOverride: "auto",
  };
}

function sourceFileFromInput(file: File): SourceImageFile {
  return {
    file,
    relativePath: fileDisplayPath(file),
  };
}

function looksLikeLayerFolderName(value: string) {
  return /^(bg|background|book|frame|fr|f|背景|フレーム|枠)[0-9０-９]*$/i.test(value);
}

function normalizeSourceFiles(sourceFiles: SourceImageFile[]) {
  const pathParts = sourceFiles.map((source) => splitPath(source.relativePath));
  const firstSegments = new Set(pathParts.map((parts) => parts[0]).filter(Boolean));
  if (firstSegments.size !== 1) {
    return sourceFiles;
  }

  const hasDirectImage = pathParts.some((parts) => parts.length <= 2);
  const secondSegments = Array.from(new Set(pathParts.map((parts) => parts[1]).filter(Boolean)));
  const looksLikeSingleCutWithLayerFolders =
    secondSegments.length > 0 && secondSegments.every((segment) => looksLikeLayerFolderName(segment));

  if (hasDirectImage || secondSegments.length <= 1 || looksLikeSingleCutWithLayerFolders) {
    return sourceFiles;
  }

  return sourceFiles.map((source) => {
    const parts = splitPath(source.relativePath);
    return {
      ...source,
      relativePath: parts.slice(1).join("/") || source.relativePath,
    };
  });
}

async function readFileEntry(entry: FileSystemFileEntryLike, relativePath: string) {
  return new Promise<SourceImageFile>((resolve, reject) => {
    entry.file(
      (file) => resolve({ file, relativePath }),
      (error) => reject(error),
    );
  });
}

async function readDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  const entries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

async function readEntryFiles(entry: FileSystemEntryLike, parentPath = ""): Promise<SourceImageFile[]> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const source = await readFileEntry(entry as FileSystemFileEntryLike, relativePath);
    return isImageFile(source.file) ? [source] : [];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const entries = await readDirectoryEntries(reader);
  const nestedFiles = await Promise.all(entries.map((child) => readEntryFiles(child, relativePath)));
  return nestedFiles.flat();
}

function sortImages<T extends { relativePath: string }>(images: T[]) {
  return [...images].sort((a, b) => naturalCollator.compare(a.relativePath, b.relativePath));
}

function bodyForImage(imageApiBaseUrl: string, image: ImageWithLabel, kind: ManifestImageKind, prefix?: string) {
  const serviceId = iiifImageServiceId(imageApiBaseUrl, image);
  return {
    id: `${serviceId}/full/max/0/default.png`,
    type: "Image",
    format: "image/png",
    label: labelMap(imageManifestLabel(kind, image, prefix)),
    metadata: imageMetadata(kind, image),
    width: image.width,
    height: image.height,
    service: [
      {
        id: serviceId,
        type: "ImageService3",
        profile: "level2",
      },
    ],
  };
}

function annotationForImage(
  imageApiBaseUrl: string,
  canvasId: string,
  image: ImageWithLabel,
  index: number,
  pageKind: ManifestImageKind,
) {
  return {
    id: `${canvasId}/annotation/${pageKind}/${index + 1}`,
    type: "Annotation",
    motivation: "painting",
    ...(pageKind !== "background" ? { behavior: ["hidden"] } : {}),
    body: bodyForImage(imageApiBaseUrl, image, pageKind),
    target: canvasId,
  };
}

function annotationPage(canvasId: string, label: string, items: Record<string, unknown>[]) {
  return {
    id: `${canvasId}/page/${encodeURIComponent(label)}`,
    type: "AnnotationPage",
    label: labelMap(label),
    items,
  };
}

function buildManifest(manifestBaseUrl: string, imageApiBaseUrl: string, folder: FolderRecord, folderImages: ImageWithLabel[]) {
  const sortedImages = sortImages(folderImages);
  const backgrounds = sortedImages.filter((image) => image.effectiveLabel === "background");
  const books = sortedImages.filter((image) => image.effectiveLabel === "book");
  const frames = sortedImages.filter((image) => image.effectiveLabel === "frame");
  const others = sortedImages.filter((image) => image.effectiveLabel === null);
  const canvasWidth = Math.max(...sortedImages.map((image) => image.width), 1);
  const canvasHeight = Math.max(...sortedImages.map((image) => image.height), 1);
  const manifestId = joinUrl(manifestBaseUrl, `${folder.key}/manifest.json`);
  const canvasId = joinUrl(manifestBaseUrl, `${folder.key}/canvas`);
  const backgroundChoiceItems = backgrounds.map((image, index) =>
    bodyForImage(imageApiBaseUrl, image, "background", `BG${index + 1}`),
  );
  const backgroundAnnotations =
    backgroundChoiceItems.length > 1
      ? [
          {
            id: `${canvasId}/annotation/background-choice`,
            type: "Annotation",
            motivation: "painting",
            body: {
              type: "Choice",
              items: backgroundChoiceItems,
            },
            target: canvasId,
          },
        ]
      : backgrounds.map((image, index) => annotationForImage(imageApiBaseUrl, canvasId, image, index, "background"));
  const annotations = [
    ...backgroundAnnotations,
    ...books.map((image, index) => annotationForImage(imageApiBaseUrl, canvasId, image, index, "book")),
    ...frames.map((image, index) => annotationForImage(imageApiBaseUrl, canvasId, image, index, "frame")),
    ...others.map((image, index) => annotationForImage(imageApiBaseUrl, canvasId, image, index, "other")),
  ];
  const pages = [annotationPage(canvasId, "レイヤー", annotations)];
  const thumbnailSource = backgrounds[0];

  return {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: manifestId,
    type: "Manifest",
    label: labelMap(folder.label),
    ...(thumbnailSource
      ? {
          thumbnail: [
            {
              id: iiifImageRequestUrl(imageApiBaseUrl, thumbnailSource),
              type: "Image",
              format: "image/png",
              width: thumbnailSource.width,
              height: thumbnailSource.height,
              service: [
                {
                  id: iiifImageServiceId(imageApiBaseUrl, thumbnailSource),
                  type: "ImageService3",
                  profile: "level2",
                },
              ],
            },
          ],
        }
      : {}),
    items: [
      {
        id: canvasId,
        type: "Canvas",
        label: labelMap("カットの空間"),
        width: canvasWidth,
        height: canvasHeight,
        items: pages,
      },
    ],
  };
}

function downloadJson(fileName: string, data: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(fileName, blob);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function zipPathSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_") || "folder";
}

function createZipBlob(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  entries.forEach((entry) => {
    const fileNameBytes = encoder.encode(entry.path);
    const contentBytes = encoder.encode(entry.content);
    const checksum = crc32(contentBytes);
    const localHeader = new Uint8Array(30);

    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0x0800);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, 0);
    writeUint16(localHeader, 12, 0);
    writeUint32(localHeader, 14, checksum);
    writeUint32(localHeader, 18, contentBytes.length);
    writeUint32(localHeader, 22, contentBytes.length);
    writeUint16(localHeader, 26, fileNameBytes.length);
    writeUint16(localHeader, 28, 0);
    localParts.push(localHeader, fileNameBytes, contentBytes);

    const centralHeader = new Uint8Array(46);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0x0800);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, 0);
    writeUint16(centralHeader, 14, 0);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, contentBytes.length);
    writeUint32(centralHeader, 24, contentBytes.length);
    writeUint16(centralHeader, 28, fileNameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, localOffset);
    centralParts.push(centralHeader, fileNameBytes);

    localOffset += localHeader.length + fileNameBytes.length + contentBytes.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const endRecord = new Uint8Array(22);
  writeUint32(endRecord, 0, 0x06054b50);
  writeUint16(endRecord, 8, entries.length);
  writeUint16(endRecord, 10, entries.length);
  writeUint32(endRecord, 12, centralDirectory.length);
  writeUint32(endRecord, 16, localOffset);
  writeUint16(endRecord, 20, 0);

  return new Blob([concatBytes([...localParts, centralDirectory, endRecord])], { type: "application/zip" });
}

export function IiifManifestBuilder() {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<ImageRecord[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [imageApiBaseUrl, setImageApiBaseUrl] = useState("");
  const [regexSettings, setRegexSettings] = useState<RegexSettings>(defaultRegexSettings);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [selectedFolderKey, setSelectedFolderKey] = useState("");
  const [status, setStatus] = useState("背景フォルダを読み込んでください。");
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  const compiledRegexes = useMemo(() => compileRegexSettings(regexSettings), [regexSettings]);
  const hasRegexError = compiledRegexes.some((item) => item.error);

  const imagesWithLabels = useMemo<ImageWithLabel[]>(() => {
    return images.map((image) => {
      const effectiveLabel = mappedLabelForImage(image, compiledRegexes);
      return {
        ...image,
        effectiveLabel,
        displayLabel: imageDisplayLabel(image, effectiveLabel),
      };
    });
  }, [compiledRegexes, images]);

  const summaries = useMemo<FolderSummary[]>(() => {
    return folders.map((folder) => {
      const folderImages = imagesWithLabels.filter((image) => image.folderKey === folder.key);
      return {
        folder,
        imageCount: folderImages.length,
        backgroundCount: folderImages.filter((image) => image.effectiveLabel === "background").length,
        bookCount: folderImages.filter((image) => image.effectiveLabel === "book").length,
        frameCount: folderImages.filter((image) => image.effectiveLabel === "frame").length,
        otherCount: folderImages.filter((image) => image.effectiveLabel === null).length,
      };
    });
  }, [folders, imagesWithLabels]);

  const selectedFolder = folders.find((folder) => folder.key === selectedFolderKey) ?? folders[0] ?? null;
  const selectedImages = selectedFolder
    ? imagesWithLabels.filter((image) => image.folderKey === selectedFolder.key)
    : [];
  const selectedSummary = summaries.find((summary) => summary.folder.key === selectedFolder?.key) ?? null;
  const baseUrlReady = baseUrl.trim().length > 0;
  const imageApiBaseUrlReady = imageApiBaseUrl.trim().length > 0;
  const manifestReady = baseUrlReady && imageApiBaseUrlReady;
  const selectedManifest = selectedFolder && manifestReady ? buildManifest(baseUrl, imageApiBaseUrl, selectedFolder, selectedImages) : null;

  async function replaceWithSourceFiles(sourceFiles: SourceImageFile[]) {
    const imageFiles = normalizeSourceFiles(sourceFiles).filter((source) => isImageFile(source.file));
    if (imageFiles.length === 0) {
      setStatus("画像ファイルが見つかりませんでした。");
      return;
    }

    setLoading(true);
    setStatus("画像を読み込んでいます。");
    try {
      const loadedImages = sortImages(await Promise.all(imageFiles.map(createImageRecord)));
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      const folderKeys = Array.from(new Set(loadedImages.map((image) => image.folderKey))).sort((a, b) =>
        naturalCollator.compare(a, b),
      );
      const nextFolders = folderKeys.map((key) => ({ key, label: key }));

      setImages(loadedImages);
      setFolders(nextFolders);
      setSelectedFolderKey(nextFolders[0]?.key ?? "");
      setStatus(`${nextFolders.length} フォルダ / ${loadedImages.length} 画像を読み込みました。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "画像の読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function handleFolderSelect(event: ChangeEvent<HTMLInputElement>) {
    const sourceFiles = Array.from(event.target.files ?? []).map(sourceFileFromInput);
    await replaceWithSourceFiles(sourceFiles);
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const items = Array.from(event.dataTransfer.items ?? []) as DataTransferItemWithEntry[];
    const entries: FileSystemEntryLike[] = [];
    items.forEach((item) => {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry as unknown as FileSystemEntryLike);
      }
    });

    if (entries.length > 0) {
      const nestedFiles = await Promise.all(entries.map((entry) => readEntryFiles(entry)));
      await replaceWithSourceFiles(nestedFiles.flat());
      return;
    }

    await replaceWithSourceFiles(Array.from(event.dataTransfer.files ?? []).map(sourceFileFromInput));
  }

  function updateRegex(label: SemanticLabel, value: string) {
    setRegexSettings((previous) => ({ ...previous, [label]: value }));
  }

  function updateFolderLabel(folderKey: string, value: string) {
    setFolders((previous) =>
      previous.map((folder) => (folder.key === folderKey ? { ...folder, label: value } : folder)),
    );
  }

  function updateImageLabel(imageId: string, value: LabelOverride) {
    setImages((previous) =>
      previous.map((image) => (image.id === imageId ? { ...image, labelOverride: value } : image)),
    );
  }

  function downloadSelectedManifest() {
    if (!selectedFolder || !selectedManifest) {
      setStatus("基底URL、IIIF Image API URL、フォルダを確認してください。");
      return;
    }
    downloadJson("manifest.json", selectedManifest);
    setStatus(`${selectedFolder.key} の manifest を書き出しました。`);
  }

  function downloadAllManifests() {
    if (!manifestReady || folders.length === 0) {
      setStatus("基底URL、IIIF Image API URL、フォルダを確認してください。");
      return;
    }
    const zipEntries = folders.map((folder) => {
      const folderImages = imagesWithLabels.filter((image) => image.folderKey === folder.key);
      return {
        path: `${zipPathSegment(folder.key)}/manifest.json`,
        content: JSON.stringify(buildManifest(baseUrl, imageApiBaseUrl, folder, folderImages), null, 2),
      };
    });
    downloadBlob("manifests.zip", createZipBlob(zipEntries));
    setStatus(`${folders.length} 件の manifest を manifests.zip に書き出しました。`);
  }

  return (
    <div
      className={classNames(
        "grid min-h-[calc(100vh-6.5rem)] gap-3 rounded-lg lg:grid-cols-[340px_minmax(0,1fr)]",
        dragActive && "ring-2 ring-blue-400 ring-offset-2",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        const relatedTarget = event.relatedTarget as Node | null;
        if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
          setDragActive(false);
        }
      }}
      onDrop={handleDrop}
    >
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <input
            ref={(node) => {
              folderInputRef.current = node;
              node?.setAttribute("webkitdirectory", "");
              node?.setAttribute("directory", "");
            }}
            type="file"
            multiple
            accept={imageAccept}
            className="hidden"
            onChange={handleFolderSelect}
          />
          <div className="grid gap-2">
            <button className="primary-button" type="button" disabled={loading} onClick={() => folderInputRef.current?.click()}>
              背景フォルダを読み込む
            </button>
            <div
              className={classNames(
                "flex min-h-16 items-center justify-center rounded-md border border-dashed px-3 py-2 text-center text-sm font-semibold",
                dragActive ? "border-blue-400 bg-blue-50 text-blue-700" : "border-zinc-300 bg-zinc-50 text-zinc-500",
              )}
            >
              複数フォルダをドロップ
            </div>
            <div className="grid gap-1">
              <label className="field-label" htmlFor="iiif-base-url">
                基底URL
              </label>
              <input
                id="iiif-base-url"
                className="field-control"
                value={baseUrl}
                placeholder="https://example.com/iiif/manifests"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label className="field-label" htmlFor="iiif-image-api-base-url">
                IIIF Image API URL
              </label>
              <input
                id="iiif-image-api-base-url"
                className="field-control"
                value={imageApiBaseUrl}
                placeholder="http://localhost/tomcat/digilib/Scaler/IIIF/iiifimages"
                onChange={(event) => setImageApiBaseUrl(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="control-button" type="button" disabled={!selectedManifest || hasRegexError} onClick={downloadSelectedManifest}>
                選択を書き出す
              </button>
              <button className="control-button" type="button" disabled={!manifestReady || folders.length === 0 || hasRegexError} onClick={downloadAllManifests}>
                全件を書き出す
              </button>
            </div>
          </div>
        </section>

        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-900">正規表現マッピング</h2>
          <div className="mt-2 grid gap-2">
            {compiledRegexes.map((item) => (
              <label key={item.label} className="grid gap-1">
                <span className="field-label">{labelText[item.label]}</span>
                <input
                  className={classNames("field-control", item.error && "border-red-400")}
                  value={regexSettings[item.label]}
                  onChange={(event) => updateRegex(item.label, event.target.value)}
                />
                {item.error ? <span className="text-xs text-red-600">{item.error}</span> : null}
              </label>
            ))}
          </div>
        </section>

        <section className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-900">フォルダ</h2>
          <div className="mt-2 grid max-h-[42vh] gap-2 overflow-auto pr-1">
            {summaries.length > 0 ? (
              summaries.map((summary) => (
                <button
                  key={summary.folder.key}
                  type="button"
                  className={classNames(
                    "grid gap-2 rounded-md border p-2 text-left text-sm",
                    selectedFolder?.key === summary.folder.key ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white",
                  )}
                  onClick={() => setSelectedFolderKey(summary.folder.key)}
                >
                  <span className="font-semibold text-zinc-900">{summary.folder.label}</span>
                  <span className="flex flex-wrap gap-1 text-xs">
                    <span className={classNames("rounded border px-1.5 py-0.5", summary.backgroundCount > 0 ? labelChipClass.background : "border-red-200 bg-red-50 text-red-700")}>
                      {summary.backgroundCount > 0 ? "BG OK" : "BG未設定"}
                    </span>
                    <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-sky-700">book {summary.bookCount}</span>
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">frame {summary.frameCount}</span>
                    <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-600">名称 {summary.otherCount}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500">
                フォルダ未読み込み
              </p>
            )}
          </div>
        </section>

        <p className="sticky bottom-0 z-10 max-h-24 shrink-0 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 text-xs leading-5 text-zinc-700 shadow-sm">
          {status}
        </p>
      </aside>

      <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
        {selectedFolder ? (
          <>
            <div className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className="field-label">Manifestラベル</span>
                  <input
                    className="field-control"
                    value={selectedFolder.label}
                    onChange={(event) => updateFolderLabel(selectedFolder.key, event.target.value)}
                  />
                </label>
              </div>
              {selectedSummary ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                    画像 {selectedSummary.imageCount}
                  </span>
                  <span className={classNames("rounded border px-2 py-1", selectedSummary.backgroundCount > 0 ? labelChipClass.background : "border-red-200 bg-red-50 text-red-700")}>
                    background {selectedSummary.backgroundCount}
                  </span>
                  <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
                    book {selectedSummary.bookCount}
                  </span>
                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                    frame {selectedSummary.frameCount}
                  </span>
                  <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-600">
                    画像名 {selectedSummary.otherCount}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-h-0 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-xs text-zinc-500">
                    <tr>
                      <th className="border-b border-zinc-200 px-2 py-2 font-semibold">画像</th>
                      <th className="border-b border-zinc-200 px-2 py-2 font-semibold">パス</th>
                      <th className="border-b border-zinc-200 px-2 py-2 font-semibold">ラベル</th>
                      <th className="border-b border-zinc-200 px-2 py-2 font-semibold">設定</th>
                      <th className="border-b border-zinc-200 px-2 py-2 font-semibold">サイズ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedImages.map((image) => (
                      <tr key={image.id} className="border-b border-zinc-100 last:border-b-0">
                        <td className="w-20 px-2 py-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.previewUrl}
                            alt=""
                            className="h-14 w-16 rounded border border-zinc-200 object-contain"
                          />
                        </td>
                        <td className="max-w-0 px-2 py-2">
                          <p className="truncate font-medium text-zinc-900">{image.fileName}</p>
                          <p className="truncate text-xs text-zinc-500">{image.pathInFolder}</p>
                        </td>
                        <td className="px-2 py-2">
                          {image.effectiveLabel ? (
                            <span className={classNames("inline-flex rounded border px-2 py-1 text-xs font-semibold", labelChipClass[image.effectiveLabel])}>
                              OK {labelText[image.effectiveLabel]}
                            </span>
                          ) : (
                            <span className="inline-flex rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                              画像名
                            </span>
                          )}
                        </td>
                        <td className="w-36 px-2 py-2">
                          <select
                            className="field-control min-h-8 py-1 text-sm"
                            value={image.labelOverride}
                            onChange={(event) => updateImageLabel(image.id, event.target.value as LabelOverride)}
                          >
                            <option value="auto">自動</option>
                            <option value="background">background</option>
                            <option value="book">book</option>
                            <option value="frame">frame</option>
                            <option value="name">画像名</option>
                          </select>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs text-zinc-500">
                          {image.width} x {image.height}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="min-h-0 overflow-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <h2 className="text-sm font-semibold tracking-normal text-zinc-900">Manifest確認</h2>
                <pre className="mt-2 max-h-[calc(100vh-15rem)] overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-50">
                  {selectedManifest ? JSON.stringify(selectedManifest, null, 2) : "基底URLとIIIF Image API URLを入力してください。"}
                </pre>
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
            背景フォルダを読み込むと、フォルダごとの設定と画像一覧が表示されます。
          </div>
        )}
      </section>
    </div>
  );
}
