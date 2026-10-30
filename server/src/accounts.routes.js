const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const express = require("express");
const { pool } = require("./db");
const { requirePasswordChangeComplete, requireRole, requireUser } = require("./auth");

const router = express.Router();
const validUsername = /^[a-zA-Z0-9._-]{3,80}$/;
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedItRoles = new Set(["technician", "admin"]);

function createTemporaryPassword() {
  return `${randomBytes(12).toString("hex")}a7`;
}

function accountValidation(body, includeRole) {
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const departmentId = Number(body.departmentId);
  const role = body.role;
  if (!fullName || fullName.length > 150) {
    return { message: "Enter a full name of 1–150 characters." };
  }
  if (!validUsername.test(username)) {
    return { message: "Username must be 3–80 characters and use letters, numbers, dots, dashes, or underscores." };
  }
  if (!validEmail.test(email) || email.length > 254) {
    return { message: "Enter a valid email address." };
  }
  if (!Number.isInteger(departmentId) || departmentId < 1) {
    return { message: "Choose a department." };
  }
  if (includeRole && !allowedItRoles.has(role)) {
    return { message: "IT accounts must be an admin or IT staff member." };
  }
  return { fullName, username, email, departmentId, role };
}

function handleDuplicate(error, response) {
  if (error.code !== "ER_DUP_ENTRY") return false;
  response.status(409).json({ message: "That username or email address is already in use." });
  return true;
}

async function listAccounts(roleFilter) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.email, u.role, u.active,
            u.must_change_password, u.last_sign_in, u.department_id, d.name AS department
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE ${roleFilter}
     ORDER BY u.full_name, u.username`,
  );
  return rows.map((user) => ({
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    role: user.role,
    active: Boolean(user.active),
    mustChangePassword: Boolean(user.must_change_password),
    lastSignIn: user.last_sign_in,
    departmentId: user.department_id,
    department: user.department,
  }));
}

async function addAccount(request, response, role) {
  const account = accountValidation(request.body, role === "it");
  if (account.message) {
    response.status(400).json({ message: account.message });
    return;
  }

  const [departments] = await pool.execute(
    "SELECT id FROM departments WHERE id = ? AND active = TRUE",
    [account.departmentId],
  );
  if (departments.length === 0) {
    response.status(400).json({ message: "Choose an active department." });
    return;
  }

  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  try {
    await pool.execute(
      `INSERT INTO users
        (full_name, username, email, department_id, role, password_hash,
         must_change_password, active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE)`,
      [
        account.fullName,
        account.username,
        account.email,
        account.departmentId,
        role === "it" ? account.role : "employee",
        passwordHash,
      ],
    );
  } catch (error) {
    if (handleDuplicate(error, response)) return;
    throw error;
  }

  response.status(201).json({
    message: "Account created. Share the temporary password with the account holder.",
    account: {
      fullName: account.fullName,
      username: account.username,
      email: account.email,
      role: role === "it" ? account.role : "employee",
      departmentId: account.departmentId,
    },
    temporaryPassword,
  });
}

async function updateAccount(request, response, accountType, isItAccount = false) {
  const userId = Number(request.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    response.status(400).json({ message: "Invalid account ID." });
    return;
  }
  const account = accountValidation(request.body, isItAccount);
  if (account.message) {
    response.status(400).json({ message: account.message });
    return;
  }
  const [accounts] = await pool.execute(
    `SELECT id, role, active, department_id
     FROM users WHERE id = ? AND ${accountType}`,
    [userId],
  );
  if (!accounts.length) {
    response.status(404).json({ message: "Account not found." });
    return;
  }
  const current = accounts[0];
  const [departments] = await pool.execute(
    `SELECT id FROM departments
     WHERE id = ? AND (active = TRUE OR id = ?)`,
    [account.departmentId, current.department_id],
  );
  if (!departments.length) {
    response.status(400).json({ message: "Choose an active department." });
    return;
  }
  const nextRole = isItAccount ? account.role : "employee";
  if (userId === request.user.id && nextRole !== current.role) {
    response.status(400).json({ message: "You cannot change your own IT role." });
    return;
  }
  if (current.active && current.role === "admin" && nextRole !== "admin") {
    const [admins] = await pool.execute(
      "SELECT COUNT(*) AS active_admins FROM users WHERE role = 'admin' AND active = TRUE",
    );
    if (admins[0].active_admins <= 1) {
      response.status(400).json({ message: "The last active admin account cannot be changed to another role." });
      return;
    }
  }

  try {
    await pool.execute(
      `UPDATE users
       SET full_name = ?, username = ?, email = ?, department_id = ?, role = ?,
           session_version = session_version + ?
       WHERE id = ?`,
      [
        account.fullName,
        account.username,
        account.email,
        account.departmentId,
        nextRole,
        nextRole === current.role ? 0 : 1,
        userId,
      ],
    );
  } catch (error) {
    if (handleDuplicate(error, response)) return;
    throw error;
  }
  const [updatedRows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.email, u.role, u.active,
            u.department_id, d.name AS department
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?`,
    [userId],
  );
  const updated = updatedRows[0];
  response.json({
    message: "Account updated.",
    account: {
      id: updated.id,
      fullName: updated.full_name,
      username: updated.username,
      email: updated.email,
      role: updated.role,
      active: Boolean(updated.active),
      departmentId: updated.department_id,
      department: updated.department,
    },
  });
}

async function resetPassword(request, response, accountType) {
  const userId = Number(request.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    response.status(400).json({ message: "Invalid account ID." });
    return;
  }
  if (userId === request.user.id) {
    response.status(400).json({ message: "Use Change password to update your own account." });
    return;
  }
  const [rows] = await pool.execute(
    `SELECT id FROM users WHERE id = ? AND ${accountType}`,
    [userId],
  );
  if (rows.length === 0) {
    response.status(404).json({ message: "Account not found." });
    return;
  }

  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await pool.execute(
    `UPDATE users
     SET password_hash = ?, must_change_password = TRUE, session_version = session_version + 1
     WHERE id = ?`,
    [passwordHash, userId],
  );
  response.json({
    message: "Password reset. Share this temporary password with the account holder.",
    temporaryPassword,
  });
}

async function updateAccountStatus(request, response, accountType) {
  const userId = Number(request.params.id);
  const { active } = request.body;
  if (!Number.isInteger(userId) || userId < 1 || typeof active !== "boolean") {
    response.status(400).json({ message: "Provide a valid account and an enabled or disabled status." });
    return;
  }
  if (userId === Number(request.user.id) && !active) {
    response.status(400).json({ message: "You cannot disable your own account." });
    return;
  }

  const [rows] = await pool.execute(
    `SELECT id, role, active FROM users WHERE id = ? AND ${accountType}`,
    [userId],
  );
  if (rows.length === 0) {
    response.status(404).json({ message: "Account not found." });
    return;
  }
  if (!active && rows[0].role === "admin" && rows[0].active) {
    const [admins] = await pool.execute(
      "SELECT COUNT(*) AS active_admins FROM users WHERE role = 'admin' AND active = TRUE",
    );
    if (admins[0].active_admins <= 1) {
      response.status(400).json({ message: "The last active admin account cannot be disabled." });
      return;
    }
  }
  await pool.execute(
    "UPDATE users SET active = ?, session_version = session_version + 1 WHERE id = ?",
    [active, userId],
  );
  response.json({ message: active ? "Account enabled." : "Account disabled." });
}

router.use(requireUser, requirePasswordChangeComplete, requireRole("admin"));

router.get("/departments", async (_request, response) => {
  const [departments] = await pool.execute(
    "SELECT id, name FROM departments WHERE active = TRUE ORDER BY sort_order, id",
  );
  response.json({ departments });
});

router.get("/employees", async (_request, response) => {
  response.json({ accounts: await listAccounts("u.role = 'employee'") });
});

router.post("/employees", (request, response, next) => {
  addAccount(request, response, "employee").catch(next);
});

router.patch("/employees/:id", (request, response, next) => {
  updateAccount(request, response, "role = 'employee'").catch(next);
});

router.post("/employees/:id/reset-password", (request, response, next) => {
  resetPassword(request, response, "role = 'employee'").catch(next);
});

router.patch("/employees/:id/status", (request, response, next) => {
  updateAccountStatus(request, response, "role = 'employee'").catch(next);
});

router.get("/it", async (_request, response) => {
  response.json({ accounts: await listAccounts("u.role IN ('technician', 'admin')") });
});

router.post("/it", (request, response, next) => {
  addAccount(request, response, "it").catch(next);
});

router.patch("/it/:id", (request, response, next) => {
  updateAccount(request, response, "role IN ('technician', 'admin')", true).catch(next);
});

router.post("/it/:id/reset-password", (request, response, next) => {
  resetPassword(request, response, "role IN ('technician', 'admin')").catch(next);
});

router.patch("/it/:id/status", (request, response, next) => {
  updateAccountStatus(request, response, "role IN ('technician', 'admin')").catch(next);
});

module.exports = router;
