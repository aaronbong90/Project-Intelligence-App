import {
  formatBytes,
  FREE_PILOT_IMAGE_TARGET_BYTES,
  FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD,
  FREE_PILOT_MAX_DOCUMENT_BYTES,
  FREE_PILOT_MAX_IMAGE_BYTES,
  FREE_PILOT_MAX_IMAGE_DIMENSION,
  type FreePilotUploadMode
} from "@/lib/free-pilot";

const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
const NON_COMPRESSIBLE_IMAGE_EXTENSIONS = new Set(["gif", "svg"]);

function getFileExtension(name: string) {
  const trimmedName = name.trim().toLowerCase();
  const lastDotIndex = trimmedName.lastIndexOf(".");
  return lastDotIndex === -1 ? "" : trimmedName.slice(lastDotIndex + 1);
}

function replaceFileExtension(name: string, nextExtension: string) {
  const trimmedName = name.trim();
  const lastDotIndex = trimmedName.lastIndexOf(".");
  const baseName = lastDotIndex === -1 ? trimmedName : trimmedName.slice(0, lastDotIndex);
  return `${baseName || "upload"}.${nextExtension}`;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

function isAllowedDocumentFile(file: File) {
  return DOCUMENT_EXTENSIONS.has(getFileExtension(file.name));
}

function isCompressibleImage(file: File) {
  return isImageFile(file) && !NON_COMPRESSIBLE_IMAGE_EXTENSIONS.has(getFileExtension(file.name));
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to read "${file.name}" as an image.`));
    };

    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to optimize this image."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

async function optimizeImageForFreePilot(file: File) {
  if (!isCompressibleImage(file)) {
    if (file.size > FREE_PILOT_MAX_IMAGE_BYTES) {
      throw new Error(`"${file.name}" is too large. Use JPG, PNG, or WEBP under ${formatBytes(FREE_PILOT_MAX_IMAGE_BYTES)}.`);
    }

    return file;
  }

  if (file.size <= FREE_PILOT_IMAGE_TARGET_BYTES) {
    return file;
  }

  const image = await loadImage(file);
  const maxSide = Math.max(image.width, image.height);
  const dimensionCaps = [FREE_PILOT_MAX_IMAGE_DIMENSION, 1280, 1024];
  const qualitySteps = [0.82, 0.72, 0.62, 0.52];
  let smallestBlob: Blob | null = null;

  for (const dimensionCap of dimensionCaps) {
    const scale = maxSide > dimensionCap ? dimensionCap / maxSide : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to optimize this image on your browser.");
    }

    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualitySteps) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!smallestBlob || blob.size < smallestBlob.size) {
        smallestBlob = blob;
      }

      if (blob.size <= FREE_PILOT_IMAGE_TARGET_BYTES) {
        return new File([blob], replaceFileExtension(file.name, "jpg"), {
          type: "image/jpeg",
          lastModified: file.lastModified
        });
      }
    }
  }

  if (!smallestBlob || smallestBlob.size > FREE_PILOT_MAX_IMAGE_BYTES) {
    throw new Error(`"${file.name}" is still too large after optimization. Try a smaller photo under ${formatBytes(FREE_PILOT_MAX_IMAGE_BYTES)}.`);
  }

  return new File([smallestBlob], replaceFileExtension(file.name, "jpg"), {
    type: "image/jpeg",
    lastModified: file.lastModified
  });
}

export async function prepareFreePilotFiles(files: File[], mode: FreePilotUploadMode) {
  if (files.length > FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD) {
    throw new Error(`Upload up to ${FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD} files at a time during the free pilot.`);
  }

  const preparedFiles: File[] = [];

  for (const file of files) {
    if (isVideoFile(file)) {
      throw new Error("Video uploads are disabled in the free pilot. Use photos or documents instead.");
    }

    if (isImageFile(file)) {
      preparedFiles.push(await optimizeImageForFreePilot(file));
      continue;
    }

    if (mode === "mixed" && isAllowedDocumentFile(file)) {
      if (file.size > FREE_PILOT_MAX_DOCUMENT_BYTES) {
        throw new Error(`"${file.name}" is too large. Keep documents under ${formatBytes(FREE_PILOT_MAX_DOCUMENT_BYTES)}.`);
      }

      preparedFiles.push(file);
      continue;
    }

    if (mode === "image-only") {
      throw new Error(`"${file.name}" is not allowed here. This section is photo-only during the free pilot.`);
    }

    throw new Error(`"${file.name}" is not a supported upload type. Use photos, PDF, Word, Excel, or PowerPoint files.`);
  }

  return preparedFiles;
}
