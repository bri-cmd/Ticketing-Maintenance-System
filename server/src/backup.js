const { spawn } = require("node:child_process");
const { createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const backupDirectory = path.resolve(__dirname, "../backups");
const backupFilePattern = /^it_service_desk_\d{4}-\d{2}-\d{2}(?:_\d{6})?\.sql$/;
const dailyBackupHour = 2;

function getMysqldumpPath() {
  return process.env.MYSQLDUMP_PATH?.trim() || "mysqldump";
}

function escapeOptionFileValue(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}"`;
}

function localDateStamp(date = new Date(), includeTime = false) {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  if (!includeTime) return datePart;
  return `${datePart}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  const password = process.env.DB_PASSWORD;
  if (password) message = message.split(password).join("[redacted]");
  return message;
}

async function checkMysqldump() {
  const executable = getMysqldumpPath();
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn(executable, ["--version"], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2048) stderr += chunk.toString();
    });
    child.once("error", (error) => {
      resolve({
        available: false,
        message: error.code === "ENOENT"
          ? `mysqldump was not found at "${executable}". Set MYSQLDUMP_PATH in server/.env to its full path.`
          : `Unable to run mysqldump at "${executable}": ${safeErrorMessage(error)}`,
      });
    });
    child.once("close", (code) => {
      resolve({
        available: code === 0,
        message: code === 0
          ? ""
          : `mysqldump at "${executable}" could not run successfully. ${safeErrorMessage(new Error(stderr.trim() || `Exit code ${code}`))}`,
      });
    });
  });
}

async function keepLatestBackups() {
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const backups = entries
    .filter((entry) => entry.isFile() && backupFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  await Promise.all(backups.slice(14).map((filename) => fs.unlink(path.join(backupDirectory, filename))));
}

async function backupNow() {
  const executable = getMysqldumpPath();
  const database = process.env.DB_NAME || "it_service_desk";
  const stamp = localDateStamp(new Date(), true);
  const filename = `it_service_desk_${stamp}.sql`;
  const finalPath = path.join(backupDirectory, filename);
  const temporaryOutputPath = `${finalPath}.${process.pid}.tmp`;
  let temporaryDirectory;

  await fs.mkdir(backupDirectory, { recursive: true });
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bmc-mysqldump-"));
    const optionFile = path.join(temporaryDirectory, "client.cnf");
    const optionContents = [
      "[client]",
      `host=${escapeOptionFileValue(process.env.DB_HOST || "127.0.0.1")}`,
      `port=${Number(process.env.DB_PORT || 3306)}`,
      `user=${escapeOptionFileValue(process.env.DB_USER || "")}`,
      `password=${escapeOptionFileValue(process.env.DB_PASSWORD || "")}`,
      "",
    ].join("\n");
    await fs.writeFile(optionFile, optionContents, { encoding: "utf8", mode: 0o600, flag: "wx" });

    const child = spawn(executable, [
      `--defaults-extra-file=${optionFile}`,
      "--single-transaction",
      "--quick",
      "--no-tablespaces",
      "--routines",
      "--triggers",
      "--hex-blob",
      database,
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8192) stderr += chunk.toString();
    });

    const exitPromise = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const outputPromise = pipeline(child.stdout, createWriteStream(temporaryOutputPath, { flags: "wx" }));
    const [exit] = await Promise.all([exitPromise, outputPromise]);
    if (exit.code !== 0) {
      const detail = stderr.trim() || `mysqldump exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ""}.`;
      throw new Error(safeErrorMessage(new Error(detail)));
    }

    const { size } = await fs.stat(temporaryOutputPath);
    if (size === 0) throw new Error("mysqldump completed but produced an empty file.");
    await fs.rename(temporaryOutputPath, finalPath);
    await keepLatestBackups();
    return { filename, size };
  } catch (error) {
    await fs.unlink(temporaryOutputPath).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    if (error.code === "ENOENT") {
      throw new Error(`mysqldump was not found at "${executable}". Set MYSQLDUMP_PATH in server/.env to its full path.`);
    }
    throw new Error(`Database backup failed: ${safeErrorMessage(error)}`);
  } finally {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function scheduleDailyBackup() {
  let timer;
  function scheduleNext() {
    const nextRun = new Date();
    nextRun.setHours(dailyBackupHour, 0, 0, 0);
    if (nextRun <= new Date()) nextRun.setDate(nextRun.getDate() + 1);
    timer = setTimeout(async () => {
      try {
        const result = await backupNow();
        console.log(`Daily MySQL backup created: ${result.filename}`);
      } catch (error) {
        console.error(error.message);
      } finally {
        scheduleNext();
      }
    }, Math.max(1000, nextRun.getTime() - Date.now()));
    timer.unref();
  }
  scheduleNext();
  return () => clearTimeout(timer);
}

module.exports = {
  backupNow,
  checkMysqldump,
  getMysqldumpPath,
  scheduleDailyBackup,
};
