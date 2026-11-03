const { pool } = require("./db");
const { getMailConfiguration, sendTestEmail } = require("./mailer");

async function main() {
  const recipient = process.argv[2]?.trim();
  if (!recipient) {
    console.error("Usage: npm.cmd run mail:test -- recipient@example.com");
    process.exitCode = 1;
    return;
  }

  const configuration = getMailConfiguration();
  if (!configuration.configured) {
    console.log("SMTP is not configured; the test email will be written to the mail log and console.");
  }
  const result = await sendTestEmail(recipient);
  if (result.status === "sent") {
    console.log(`Test email sent to ${recipient}.`);
    return;
  }
  if (result.status === "logged") {
    console.log(`Test email logged for ${recipient}; no SMTP delivery was attempted.`);
    return;
  }
  console.error(`Test email failed for ${recipient}.`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Mail test failed: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await pool.end();
  } catch (error) {
    console.error(`Unable to close the database pool: ${error.message}`);
    process.exitCode = 1;
  }
});
