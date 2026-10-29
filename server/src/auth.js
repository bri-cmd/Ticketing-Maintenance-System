const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const cookieName = "bmc_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  return secret;
}

function setSessionCookie(response, userId, sessionVersion) {
  const token = jwt.sign(
    { sub: String(userId), sessionVersion },
    getJwtSecret(),
    {
    expiresIn: "8h",
    },
  );
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDurationMs,
  });
}

function clearSessionCookie(response) {
  response.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
  });
}

async function requireUser(request, response, next) {
  const token = request.cookies[cookieName];
  if (!token) {
    response.status(401).json({ message: "Sign in to continue." });
    return;
  }

  let claims;
  try {
    claims = jwt.verify(token, getJwtSecret());
  } catch {
    clearSessionCookie(response);
    response.status(401).json({ message: "Your sign-in has expired. Please sign in again." });
    return;
  }

  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.email, u.avatar_path, u.department_id,
            u.role, u.must_change_password, u.onboarding_completed, u.computer_setup,
            u.session_version,
            d.name AS department
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ? AND u.active = TRUE`,
    [claims.sub],
  );
  if (rows.length === 0) {
    clearSessionCookie(response);
    response.status(401).json({ message: "This account is disabled or no longer exists." });
    return;
  }

  if (claims.sessionVersion !== rows[0].session_version) {
    clearSessionCookie(response);
    response.status(401).json({ message: "Your sign-in has expired. Please sign in again." });
    return;
  }
  request.user = rows[0];
  next();
}

function requirePasswordChangeComplete(request, response, next) {
  if (request.user.must_change_password) {
    response.status(403).json({
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "Change your temporary password before continuing.",
    });
    return;
  }
  next();
}

function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.user.role)) {
      response.status(403).json({ message: "You do not have permission to do that." });
      return;
    }
    next();
  };
}

module.exports = {
  clearSessionCookie,
  getJwtSecret,
  requirePasswordChangeComplete,
  requireRole,
  requireUser,
  setSessionCookie,
};
