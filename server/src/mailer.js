const nodemailer = require("nodemailer");
const { pool } = require("./db");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let cachedTransport;
let cachedTransportKey;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getMailConfiguration() {
  const host = process.env.SMTP_HOST?.trim() || "";
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.MAIL_FROM?.trim() || "";
  const username = process.env.SMTP_USER?.trim() || "";
  const password = process.env.SMTP_PASSWORD || "";
  const secure = process.env.SMTP_SECURE === undefined
    ? port === 465
    : process.env.SMTP_SECURE.trim().toLowerCase() === "true";
  return {
    host,
    port,
    secure,
    from,
    username,
    password,
    configured: Boolean(host && Number.isInteger(port) && port > 0 && port <= 65535 && from),
    authValid: Boolean(username) === Boolean(password),
  };
}

function getAppBaseUrl() {
  const configured = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
    return url.toString().replace(/\/+$/, "");
  } catch {
    console.error("APP_BASE_URL must be a valid HTTP or HTTPS URL; using http://localhost:3000.");
    return "http://localhost:3000";
  }
}

function getTicketStatusUrl(ticketNo) {
  return `${getAppBaseUrl()}/ticket-status?ticketNo=${encodeURIComponent(ticketNo)}`;
}

function buildEmail({ type, ticket, notes = [] }) {
  const ticketUrl = getTicketStatusUrl(ticket.ticketNo);
  const escapedUrl = escapeHtml(ticketUrl);
  const ticketLinkText = `Check ticket status: ${ticketUrl}`;
  const noteText = notes.filter((note) => typeof note === "string" && note.trim());
  const noteHtml = noteText.length
    ? `<section style="margin:24px 0;padding:16px;border-left:4px solid #1e40af;background:#eff6ff"><h2 style="margin:0 0 10px;font-size:16px;color:#1e3a8a">Message from IT Support</h2>${noteText.map((note) => `<p style="margin:8px 0;white-space:pre-wrap">${escapeHtml(note)}</p>`).join("")}</section>`
    : "";
  const summaryHtml = escapeHtml(ticket.summary);
  const numberHtml = escapeHtml(ticket.ticketNo);
  const assignedText = ticket.assignedName
    ? `Technician: ${ticket.assignedName}`
    : "";
  const assignedHtml = ticket.assignedName
    ? `<p><strong>Technician:</strong> ${escapeHtml(ticket.assignedName)}</p>`
    : "";
  let heading;
  let subject;
  let intro;
  const detailLines = [];

  if (type === "received") {
    heading = "Ticket received";
    subject = `Ticket received: ${ticket.ticketNo} · ${ticket.summary}`;
    intro = "The BMC IT Service Desk has received your ticket.";
    detailLines.push(
      "The BMC IT Service Desk has received your ticket.",
      `Ticket number: ${ticket.ticketNo}`,
      `Source: ${ticket.source}`,
      `Summary: ${ticket.summary}`,
      ticketLinkText,
      "If you did not submit this ticket, you can ignore this email.",
    );
  } else if (type === "resolved") {
    heading = "Your ticket has been resolved";
    subject = `Ticket resolved: ${ticket.ticketNo} · ${ticket.summary}`;
    intro = "Your support ticket has been marked as resolved.";
    detailLines.push(
      "Your support ticket has been marked as resolved.",
      `Ticket number: ${ticket.ticketNo}`,
      `Source: ${ticket.source}`,
      `Summary: ${ticket.summary}`,
      "Status: Resolved",
      ...(assignedText ? [assignedText] : []),
      ...(noteText.length ? ["Message from IT Support:", ...noteText] : []),
      ticketLinkText,
      "If the issue continues or returns, please contact IT Support again.",
    );
  } else {
    heading = type === "message" ? "Message from IT Support" : "Ticket update";
    subject = `${type === "message" ? "Message from IT Support" : "Ticket update"}: ${ticket.ticketNo} · ${ticket.summary}`;
    intro = type === "message"
      ? "IT Support has sent you a message about your ticket."
      : "There is an update to your support ticket.";
    detailLines.push(
      intro,
      `Ticket number: ${ticket.ticketNo}`,
      `Summary: ${ticket.summary}`,
      `Status: ${ticket.status}`,
      ...(assignedText ? [assignedText] : []),
      ...(noteText.length ? ["Message from IT Support:", ...noteText] : []),
      ticketLinkText,
    );
  }

  const text = [
    `Hello${ticket.requesterName ? ` ${ticket.requesterName}` : ""},`,
    "",
    ...detailLines,
    "",
    "BMC IT Service Desk",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#182744"><div style="max-width:640px;margin:24px auto;padding:0 16px"><div style="background:#182744;padding:20px 24px;border-radius:8px 8px 0 0"><div style="color:#fff;font-size:18px;font-weight:700">BMC IT Service Desk</div></div><main style="background:#fff;padding:28px 24px;border:1px solid #dce4ef;border-top:0;border-radius:0 0 8px 8px"><p>Hello${ticket.requesterName ? ` ${escapeHtml(ticket.requesterName)}` : ""},</p><h1 style="font-size:22px;margin:20px 0 12px;color:#182744">${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p><p><strong>Ticket number:</strong> ${numberHtml}<br><strong>Source:</strong> ${escapeHtml(ticket.source)}<br><strong>Summary:</strong> ${summaryHtml}${type === "received" ? "" : `<br><strong>Status:</strong> ${escapeHtml(type === "resolved" ? "Resolved" : ticket.status)}`}</p>${assignedHtml}${noteHtml}<p style="margin:24px 0"><a href="${escapedUrl}" style="display:inline-block;background:#1e40af;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px">Check ticket status</a></p>${type === "received" ? `<p style="color:#475569">${escapeHtml("If you did not submit this ticket, you can ignore this email.")}</p>` : ""}${type === "resolved" ? `<p>If the issue continues or returns, please contact IT Support again.</p>` : ""}<p style="margin-top:28px">Regards,<br>BMC IT Service Desk</p></main></div></body></html>`;
  return { subject, text, html };
}

function buildTestEmail(to) {
  const subject = "BMC IT Service Desk email configuration test";
  const text = [
    "This is a test email from the BMC IT Service Desk.",
    "",
    `Status page example: ${getAppBaseUrl()}/ticket-status`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#182744"><h1 style="font-size:20px">Email configuration test</h1><p>This is a test email from the BMC IT Service Desk.</p><p>Recipient: ${escapeHtml(to)}</p></body></html>`;
  return { subject, text, html };
}

function getTransport(configuration) {
  const key = JSON.stringify({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    username: configuration.username,
    password: configuration.password,
  });
  if (!cachedTransport || cachedTransportKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      ...(configuration.username
        ? { auth: { user: configuration.username, pass: configuration.password } }
        : {}),
    });
    cachedTransportKey = key;
  }
  return cachedTransport;
}

function redactMailCredentials(message) {
  let safeMessage = String(message ?? "");
  for (const secret of [process.env.SMTP_PASSWORD, process.env.SMTP_USER]) {
    if (secret) safeMessage = safeMessage.split(secret).join("[redacted]");
  }
  return safeMessage;
}

async function writeMailLog({ ticketId = null, to, subject, status, error = null }) {
  try {
    await pool.execute(
      `INSERT INTO mail_log (ticket_id, to_email, subject, status, error)
       VALUES (?, ?, ?, ?, ?)`,
      [ticketId, to, subject, status, error ? redactMailCredentials(error).slice(0, 5000) : null],
    );
  } catch (logError) {
    console.error(`Unable to record mail attempt: ${redactMailCredentials(logError.message)}`);
  }
}

async function deliverMail({ ticketId = null, to, type, ticket, notes = [] }) {
  const email = buildEmail({ type, ticket, notes });
  return sendMail({ ticketId, to, ...email });
}

async function sendMail({ ticketId = null, to, subject, text, html }) {
  const configuration = getMailConfiguration();
  if (!configuration.configured) {
    console.log([
      "[Email fallback: SMTP is not configured]",
      `To: ${to}`,
      `Subject: ${subject}`,
      "Plain-text body:",
      text,
      "HTML body:",
      html,
    ].join("\n"));
    await writeMailLog({ ticketId, to, subject, status: "logged" });
    return { status: "logged" };
  }

  if (!configuration.authValid) {
    const error = "SMTP_USER and SMTP_PASSWORD must either both be configured or both be empty.";
    console.error(error);
    await writeMailLog({ ticketId, to, subject, status: "failed", error });
    return { status: "failed", error };
  }

  try {
    await getTransport(configuration).sendMail({
      from: configuration.from,
      to,
      subject,
      text,
      html,
    });
    await writeMailLog({ ticketId, to, subject, status: "sent" });
    return { status: "sent" };
  } catch (error) {
    const message = redactMailCredentials(error.message);
    console.error(`Email delivery failed for ${to}: ${message}`);
    await writeMailLog({ ticketId, to, subject, status: "failed", error: message });
    return { status: "failed", error: message };
  }
}

async function sendTestEmail(to) {
  if (!emailPattern.test(to)) throw new Error("Enter a valid recipient email address.");
  const email = buildTestEmail(to);
  return sendMail({ to, ...email });
}

module.exports = {
  deliverMail,
  getMailConfiguration,
  sendMail,
  sendTestEmail,
};
