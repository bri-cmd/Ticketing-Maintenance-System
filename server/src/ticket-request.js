const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textField(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function parseTicketRequest(body) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = textField(body.fullName, 150);
  const deviceText = typeof body.device === "string" ? body.device.trim() : "";
  const selectedDeviceId = body.deviceId === undefined || body.deviceId === null || body.deviceId === ""
    ? null
    : Number(body.deviceId);
  const departmentId = Number(body.departmentId);
  const helpTopic = textField(body.helpTopic, 100);
  const summary = textField(body.summary, 200);
  const details = textField(body.details, 10000);

  if (!validEmail.test(email) || email.length > 254) {
    return { error: "Enter a valid email address." };
  }
  if (!fullName || !Number.isInteger(departmentId) || departmentId < 1) {
    return { error: "Enter your name and choose a department." };
  }
  if (deviceText.length > 255) {
    return { error: "Device details must be 255 characters or fewer." };
  }
  if (selectedDeviceId !== null && (!Number.isInteger(selectedDeviceId) || selectedDeviceId < 1)) {
    return { error: "Choose a valid registered device." };
  }
  if (!helpTopic || !summary || !details) {
    return { error: "Complete the help topic, issue summary, and details." };
  }

  return {
    fields: {
      email,
      fullName,
      deviceText,
      selectedDeviceId,
      departmentId,
      helpTopic,
      summary,
      details,
    },
  };
}

async function resolveTicketDevice(pool, fields) {
  const [departments] = await pool.execute(
    "SELECT id FROM departments WHERE id = ? AND active = TRUE",
    [fields.departmentId],
  );
  if (!departments.length) {
    return { error: "Choose an active department." };
  }

  let deviceId = null;
  let unmatchedDeviceText = fields.deviceText || null;
  if (fields.selectedDeviceId !== null) {
    const [devices] = await pool.execute(
      "SELECT id FROM devices WHERE id = ? AND status = 'Active' LIMIT 1",
      [fields.selectedDeviceId],
    );
    if (!devices.length) {
      return { error: "Choose an active registered device." };
    }
    deviceId = devices[0].id;
    unmatchedDeviceText = null;
  } else if (fields.deviceText) {
    const [devices] = await pool.execute(
      "SELECT id FROM devices WHERE LOWER(asset_tag) = LOWER(?) LIMIT 1",
      [fields.deviceText],
    );
    if (devices.length) {
      deviceId = devices[0].id;
      unmatchedDeviceText = null;
    }
  }

  return { deviceId, deviceText: unmatchedDeviceText };
}

module.exports = {
  parseTicketRequest,
  resolveTicketDevice,
  validEmail,
};
