const bcrypt = require("bcryptjs");
const express = require("express");
const fs = require("node:fs/promises");
const { pool } = require("./db");
const { versionedAvatarPath } = require("./avatar-url");
const { handleAvatarUpload, removeAvatar, saveAvatar } = require("./avatar-upload");
const {
  clearSessionCookie,
  requirePasswordChangeComplete,
  requireUser,
  setSessionCookie,
} = require("./auth");

const router = express.Router();
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{12,128}$/;

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    departmentId: user.department_id,
    department: user.department,
    role: user.role,
    avatarPath: versionedAvatarPath(user.avatar_path, user.avatar_version),
    mustChangePassword: Boolean(user.must_change_password),
    onboardingCompleted: Boolean(user.onboarding_completed),
    computerSetup: user.computer_setup,
  };
}

router.post("/login", async (request, response) => {
  const username = typeof request.body.username === "string"
    ? request.body.username.trim()
    : "";
  const password = typeof request.body.password === "string"
    ? request.body.password
    : "";

  if (!username || !password || username.length > 80 || password.length > 128) {
    response.status(400).json({ message: "Enter your username and password." });
    return;
  }

  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.email, u.avatar_path,
            DATE_FORMAT(u.updated_at, '%Y%m%d%H%i%s') AS avatar_version, u.department_id,
            u.role, u.password_hash, u.must_change_password, u.session_version,
            u.onboarding_completed, u.computer_setup, d.name AS department
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.username = ? AND u.active = TRUE`,
    [username],
  );
  if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
    response.status(401).json({ message: "Username or password is incorrect." });
    return;
  }

  await pool.execute("UPDATE users SET last_sign_in = NOW() WHERE id = ?", [rows[0].id]);
  setSessionCookie(response, rows[0].id, rows[0].session_version);
  response.json({ user: publicUser(rows[0]) });
});

router.post("/logout", (_request, response) => {
  clearSessionCookie(response);
  response.sendStatus(204);
});

router.get("/me", requireUser, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

router.post("/avatar", requireUser, handleAvatarUpload, async (request, response, next) => {
  let savedAvatar;
  let persisted = false;
  try {
    savedAvatar = await saveAvatar(request.file);
    const [result] = await pool.execute(
      "UPDATE users SET avatar_path = ? WHERE id = ? AND active = TRUE",
      [savedAvatar.avatarPath, request.user.id],
    );
    if (!result.affectedRows) {
      await fs.unlink(savedAvatar.diskPath);
      response.status(404).json({ message: "Account not found." });
      return;
    }
    persisted = true;
    try {
      await removeAvatar(request.user.avatar_path);
    } catch (error) {
      console.error(`Unable to remove previous profile photo: ${error.message}`);
    }
    const [updatedUsers] = await pool.execute(
      `SELECT avatar_path, DATE_FORMAT(updated_at, '%Y%m%d%H%i%s') AS avatar_version
       FROM users WHERE id = ?`,
      [request.user.id],
    );
    if (!updatedUsers.length) {
      response.status(404).json({ message: "Account not found." });
      return;
    }
    response.json({
      message: "Profile photo updated.",
      avatarPath: versionedAvatarPath(updatedUsers[0].avatar_path, updatedUsers[0].avatar_version),
    });
  } catch (error) {
    if (savedAvatar && !persisted) {
      await fs.unlink(savedAvatar.diskPath).catch((cleanupError) => {
        if (cleanupError.code !== "ENOENT") throw cleanupError;
      });
    }
    if (error.statusCode) {
      response.status(error.statusCode).json({ message: error.message });
      return;
    }
    next(error);
  }
});

router.post("/change-password", requireUser, async (request, response) => {
  const currentPassword = typeof request.body.currentPassword === "string"
    ? request.body.currentPassword
    : "";
  const newPassword = typeof request.body.newPassword === "string"
    ? request.body.newPassword
    : "";
  if (!currentPassword || currentPassword.length > 128 || !passwordPattern.test(newPassword)) {
    response.status(400).json({
      message: "Use a new password with 12–128 characters, including at least one letter and one number.",
    });
    return;
  }

  const [rows] = await pool.execute(
    "SELECT password_hash FROM users WHERE id = ? AND active = TRUE",
    [request.user.id],
  );
  if (rows.length === 0 || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    response.status(400).json({ message: "The current password is incorrect." });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.execute(
    `UPDATE users
     SET password_hash = ?, must_change_password = FALSE, session_version = session_version + 1
     WHERE id = ?`,
    [passwordHash, request.user.id],
  );
  setSessionCookie(response, request.user.id, request.user.session_version + 1);
  response.json({ message: "Password updated successfully." });
});

router.get(
  "/computer-setup",
  requireUser,
  requirePasswordChangeComplete,
  async (request, response) => {
    if (request.user.role !== "employee") {
      response.status(403).json({ message: "Only employees can view their computer details." });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT brand, model, ram, motherboard, serial_no,
              DATE_FORMAT(last_serviced, '%Y-%m-%d') AS last_serviced,
              DATE_FORMAT(next_due, '%Y-%m-%d') AS next_due
       FROM devices
       WHERE assigned_user_id = ? AND type = 'PC' AND status = 'Active'
       ORDER BY id
       LIMIT 1`,
      [request.user.id],
    );
    const device = rows[0];
    response.json({
      computer: device
        ? {
            brand: device.brand || "",
            model: device.model || "",
            ram: device.ram || "",
            motherboard: device.motherboard || "",
            serialNo: device.serial_no || "",
            lastServiced: device.last_serviced,
            nextDue: device.next_due,
          }
        : null,
    });
  },
);

router.patch(
  "/computer-setup",
  requireUser,
  requirePasswordChangeComplete,
  async (request, response) => {
    if (request.user.role !== "employee") {
      response.status(403).json({ message: "Only employees can set up a computer here." });
      return;
    }

    const { skip, brand, model, ram, serialNo, motherboard } = request.body;
    if (typeof skip !== "boolean") {
      response.status(400).json({ message: "Choose whether to save the computer details or skip setup." });
      return;
    }
    if (!skip) {
      const fields = {
        brand: { value: brand, maxLength: 100 },
        model: { value: model, maxLength: 100 },
        ram: { value: ram, maxLength: 80 },
        serialNo: { value: serialNo, maxLength: 120 },
        motherboard: { value: motherboard, maxLength: 120 },
      };
      for (const [field, { value, maxLength }] of Object.entries(fields)) {
        if (value !== undefined && (typeof value !== "string" || value.length > maxLength)) {
          response.status(400).json({ message: `Computer ${field} must be ${maxLength} characters or fewer.` });
          return;
        }
      }
      if (!brand?.trim() || !model?.trim()) {
        response.status(400).json({ message: "Enter the computer brand and model, or skip setup." });
        return;
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute(
        "SELECT department_id FROM users WHERE id = ? AND role = 'employee' AND active = TRUE FOR UPDATE",
        [request.user.id],
      );
      if (users.length === 0) {
        await connection.rollback();
        response.status(403).json({ message: "Only active employees can set up a computer." });
        return;
      }

      if (skip) {
        await connection.execute(
          "UPDATE users SET onboarding_completed = TRUE WHERE id = ?",
          [request.user.id],
        );
        await connection.commit();
        response.json({ message: "Setup skipped." });
        return;
      }

      const [devices] = await connection.execute(
        `SELECT id
         FROM devices
         WHERE assigned_user_id = ? AND type = 'PC' AND status = 'Active'
         ORDER BY id
         LIMIT 1
         FOR UPDATE`,
        [request.user.id],
      );
      const [plans] = await connection.execute(
        `SELECT interval_value, interval_unit
         FROM maintenance_plans
         WHERE device_type = 'PC'`,
      );
      if (plans.length === 0) {
        await connection.rollback();
        response.status(409).json({ message: "The PC maintenance plan is not configured. Contact IT." });
        return;
      }

      const intervalUnits = {
        day: "DAY",
        week: "WEEK",
        month: "MONTH",
        year: "YEAR",
      };
      const intervalUnit = intervalUnits[plans[0].interval_unit];
      if (!intervalUnit) {
        throw new Error("The PC maintenance plan has an unsupported interval unit.");
      }
      const [dates] = await connection.execute(
        `SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? ${intervalUnit}), '%Y-%m-%d') AS next_due`,
        [plans[0].interval_value],
      );

      const computerFields = [
        brand.trim(),
        model.trim(),
        ram?.trim() || "",
        motherboard?.trim() || "",
        serialNo?.trim() || "",
      ];
      if (devices.length > 0) {
        await connection.execute(
          `UPDATE devices
           SET brand = ?, model = ?, ram = ?, motherboard = ?, serial_no = ?
           WHERE id = ? AND assigned_user_id = ?`,
          [...computerFields, devices[0].id, request.user.id],
        );
      } else {
        let assetTag = `EMP-PC-${request.user.id}`;
        let suffix = 1;
        while (true) {
          const [matchingTags] = await connection.execute(
            "SELECT id FROM devices WHERE asset_tag = ?",
            [assetTag],
          );
          if (matchingTags.length === 0) break;
          assetTag = `EMP-PC-${request.user.id}-${suffix}`;
          suffix += 1;
        }
        await connection.execute(
          `INSERT INTO devices
            (asset_tag, type, brand, model, ram, motherboard, serial_no,
             department_id, assigned_user_id, status, verification,
             last_serviced, next_due)
           VALUES (?, 'PC', ?, ?, ?, ?, ?, ?, ?, 'Active', 'Needs IT check', NULL, ?)`,
          [
            assetTag,
            ...computerFields,
            users[0].department_id,
            request.user.id,
            dates[0].next_due,
          ],
        );
      }

      await connection.execute(
        "UPDATE users SET onboarding_completed = TRUE WHERE id = ?",
        [request.user.id],
      );
      await connection.commit();
      response.json({ message: "Computer details saved." });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
);

router.use("/", requireUser, requirePasswordChangeComplete);

module.exports = router;
