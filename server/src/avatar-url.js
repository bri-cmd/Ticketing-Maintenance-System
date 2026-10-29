function versionedAvatarPath(avatarPath, version) {
  if (typeof avatarPath !== "string" || !avatarPath) return null;
  const cacheVersion = typeof version === "string" || typeof version === "number"
    ? String(version)
    : "0";
  return `${avatarPath}?v=${encodeURIComponent(cacheVersion)}`;
}

module.exports = { versionedAvatarPath };
