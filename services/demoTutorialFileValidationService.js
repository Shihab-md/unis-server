import path from "path";

const DEFAULT_MAX_MB = 100;
const configuredMaxMb = Number(process.env.DEMO_TUTORIAL_MAX_FILE_MB || DEFAULT_MAX_MB);

export const DEMO_TUTORIAL_MAX_FILE_MB =
  Number.isFinite(configuredMaxMb) && configuredMaxMb > 0
    ? configuredMaxMb
    : DEFAULT_MAX_MB;

const EXTENSION_CONFIG = Object.freeze({
  ".pdf": {
    fileKind: "PDF",
    mimeType: "application/pdf",
    acceptedMimeTypes: new Set(["", "application/pdf", "application/octet-stream"]),
  },
  ".mp4": {
    fileKind: "VIDEO",
    mimeType: "video/mp4",
    acceptedMimeTypes: new Set(["", "video/mp4", "application/octet-stream"]),
  },
  ".webm": {
    fileKind: "VIDEO",
    mimeType: "video/webm",
    acceptedMimeTypes: new Set(["", "video/webm", "application/octet-stream"]),
  },
  ".mov": {
    fileKind: "VIDEO",
    mimeType: "video/quicktime",
    acceptedMimeTypes: new Set(["", "video/quicktime", "video/mp4", "application/octet-stream"]),
  },
  ".m4v": {
    fileKind: "VIDEO",
    mimeType: "video/x-m4v",
    acceptedMimeTypes: new Set(["", "video/x-m4v", "video/mp4", "application/octet-stream"]),
  },
});

const clean = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const badRequest = (message) =>
  Object.assign(new Error(message), { status: 400 });

const getConfigForName = (fileName) => {
  const extension = path.extname(clean(fileName)).toLowerCase();
  const config = EXTENSION_CONFIG[extension];
  if (!config) {
    throw badRequest("Only PDF, MP4, WEBM, MOV and M4V files are allowed.");
  }
  return { extension, config };
};

export const validateDemoTutorialSignatureBytes = ({ fileName, bytes }) => {
  const { extension, config } = getConfigForName(fileName);
  const head = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);

  if (extension === ".pdf") {
    if (head.length < 5 || head.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw badRequest("The uploaded PDF file is invalid.");
    }
    return config.fileKind;
  }

  if (extension === ".webm") {
    const isWebm =
      head.length >= 4 &&
      head[0] === 0x1a &&
      head[1] === 0x45 &&
      head[2] === 0xdf &&
      head[3] === 0xa3;
    if (!isWebm) {
      throw badRequest("The uploaded WEBM video file is invalid.");
    }
    return config.fileKind;
  }

  const isIsoVideo =
    head.length >= 8 && head.subarray(4, 8).toString("ascii") === "ftyp";
  if (!isIsoVideo) {
    throw badRequest("The uploaded video file is invalid or unsupported.");
  }
  return config.fileKind;
};

const decodeSignature = (signatureBase64) => {
  const encoded = clean(signatureBase64);
  if (!encoded || encoded.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw badRequest("The uploaded file is invalid or unsupported.");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length || decoded.length > 64) {
    throw badRequest("The uploaded file is invalid or unsupported.");
  }
  return decoded;
};

export const validateDemoTutorialUploadMetadata = ({
  fileName,
  mimeType,
  fileSize,
  signatureBase64,
}) => {
  const originalFileName = clean(fileName);
  if (!originalFileName) throw badRequest("File is required.");
  if (originalFileName.length > 255) {
    throw badRequest("File name is too long.");
  }

  const numericSize = Number(fileSize);
  const maxBytes = Math.floor(DEMO_TUTORIAL_MAX_FILE_MB * 1024 * 1024);
  if (!Number.isSafeInteger(numericSize) || numericSize <= 0) {
    throw badRequest("The uploaded file is invalid or unsupported.");
  }
  if (numericSize > maxBytes) {
    throw badRequest(
      `File is too large. Maximum allowed size is ${DEMO_TUTORIAL_MAX_FILE_MB} MB.`
    );
  }

  const { config } = getConfigForName(originalFileName);
  const incomingMimeType = clean(mimeType).toLowerCase();
  if (!config.acceptedMimeTypes.has(incomingMimeType)) {
    throw badRequest("Only PDF, MP4, WEBM, MOV and M4V files are allowed.");
  }

  const signatureBytes = decodeSignature(signatureBase64);
  validateDemoTutorialSignatureBytes({ fileName: originalFileName, bytes: signatureBytes });

  return {
    originalFileName,
    fileSize: numericSize,
    mimeType: config.mimeType,
    fileKind: config.fileKind,
  };
};
