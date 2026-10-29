const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const multer = require("multer");

const avatarDirectory = path.resolve(__dirname, "../uploads/avatars");
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
}).single("avatar");

const allowedTypes = new Map([
  ["image/jpeg", { extension: "jpg", signature: (buffer) => buffer.length >= 3
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: "png", signature: (buffer) => buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: "webp", signature: (buffer) => buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP" }],
]);

function handleAvatarUpload(request, response, next) {
  uploadAvatar(request, response, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ message: "Profile photos must be 2 MB or smaller." });
      return;
    }
    if (error instanceof multer.MulterError) {
      response.status(400).json({ message: "Upload one profile photo at a time." });
      return;
    }
    next(error);
  });
}

async function saveAvatar(file) {
  if (!file) {
    const error = new Error("Choose a JPG, PNG, or WebP profile photo.");
    error.statusCode = 400;
    throw error;
  }
  const type = allowedTypes.get(file.mimetype);
  if (!type || !type.signature(file.buffer)) {
    const error = new Error("Profile photos must be valid JPG, PNG, or WebP images.");
    error.statusCode = 400;
    throw error;
  }
  await fs.mkdir(avatarDirectory, { recursive: true });
  const filename = `${crypto.randomBytes(24).toString("hex")}.${type.extension}`;
  const diskPath = path.join(avatarDirectory, filename);
  await fs.writeFile(diskPath, file.buffer, { flag: "wx", mode: 0o600 });
  return {
    avatarPath: `/uploads/avatars/${filename}`,
    diskPath,
  };
}

async function removeAvatar(avatarPath) {
  if (typeof avatarPath !== "string") return;
  const match = avatarPath.match(/^\/uploads\/avatars\/([a-f0-9]{48})\.(?:jpg|png|webp)$/);
  if (!match) return;
  const filename = path.basename(avatarPath);
  await fs.unlink(path.join(avatarDirectory, filename)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

module.exports = {
  handleAvatarUpload,
  removeAvatar,
  saveAvatar,
};
