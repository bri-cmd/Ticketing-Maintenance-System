const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const migrationDirectory = path.resolve(__dirname, "../../database/migrations");
const baseline = process.argv.slice(2).includes("--baseline");

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const password = process.env.DB_PASSWORD;
  return password ? message.split(password).join("[redacted]") : message;
}

async function getMigrationFiles() {
  const entries = await fs.readdir(migrationDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function migrate() {
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== "--baseline");
  if (unknownArguments.length > 0) {
    throw new Error("Unknown command-line argument.");
  }

  const migrationFiles = await getMigrationFiles();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "it_service_desk",
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await connection.query(
      "SELECT filename FROM schema_migrations"
    );
    const appliedFiles = new Set(rows.map((row) => row.filename));

    if (baseline) {
      for (const filename of migrationFiles) {
        if (!appliedFiles.has(filename)) {
          await connection.execute(
            "INSERT INTO schema_migrations (filename) VALUES (?)",
            [filename]
          );
        }
      }
      console.log(
        `Baseline recorded for ${migrationFiles.length} migration file(s).`
      );
      return;
    }

    let appliedCount = 0;
    for (const filename of migrationFiles) {
      if (appliedFiles.has(filename)) {
        continue;
      }

      try {
        const sql = await fs.readFile(
          path.join(migrationDirectory, filename),
          "utf8"
        );
        await connection.query(sql);
        await connection.execute(
          "INSERT INTO schema_migrations (filename) VALUES (?)",
          [filename]
        );
      } catch (error) {
        throw new Error(
          `Migration ${filename} failed: ${safeErrorMessage(error)}`
        );
      }

      appliedCount += 1;
      console.log(`Applied ${filename}`);
    }

    console.log(
      appliedCount === 0
        ? "Database is up to date."
        : `Applied ${appliedCount} migration file(s).`
    );
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error(`[db:migrate] ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
