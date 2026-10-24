const { pool, testConnection } = require("./db");

async function main() {
  try {
    await testConnection();
    console.log("MySQL connection successful.");
  } catch (error) {
    console.error(
      `MySQL connection failed: ${error.message}\nCheck server/.env and confirm the MySQL server is running.`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
