const WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS = 5;
const ipAttempts = new Map();
const emailAttempts = new Map();

function pruneExpired(entries, now) {
  for (const [key, timestamps] of entries) {
    const retained = timestamps.filter((timestamp) => now - timestamp < WINDOW_MS);
    if (retained.length) entries.set(key, retained);
    else entries.delete(key);
  }
}

function getRecentAttempts(entries, key, now) {
  const recent = (entries.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length) entries.set(key, recent);
  else entries.delete(key);
  return recent;
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  pruneExpired(ipAttempts, now);
  pruneExpired(emailAttempts, now);
}, 10 * 60 * 1000);
cleanupTimer.unref();

function checkPublicSubmissionLimit({ ip, email }) {
  const now = Date.now();
  const normalizedEmail = email.trim().toLowerCase();
  const ipHistory = getRecentAttempts(ipAttempts, ip, now);
  const emailHistory = getRecentAttempts(emailAttempts, normalizedEmail, now);

  if (ipHistory.length >= MAX_SUBMISSIONS || emailHistory.length >= MAX_SUBMISSIONS) {
    return "Too many ticket submissions. Please try again later.";
  }

  ipAttempts.set(ip, [...ipHistory, now]);
  emailAttempts.set(normalizedEmail, [...emailHistory, now]);
  return null;
}

module.exports = { checkPublicSubmissionLimit };
