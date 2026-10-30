const bcrypt = require("bcryptjs");
const { pool } = require("../server/src/db");

const departmentNames = [
  "Hospital Systems (HS)",
  "IT",
  "Accounting",
  "HR/Admin",
  "Marketing",
  "Training Center",
  "Purchasing",
  "Warehouse",
];

async function insertUser(connection, user, departments) {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  await connection.execute(
    `INSERT INTO users
      (full_name, username, email, department_id, role, password_hash, must_change_password, active)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE)
     ON DUPLICATE KEY UPDATE
       full_name = VALUES(full_name),
       email = VALUES(email),
       department_id = VALUES(department_id),
       role = VALUES(role),
       password_hash = VALUES(password_hash),
       must_change_password = TRUE,
       active = TRUE`,
    [
      user.fullName,
      user.username,
      user.email,
      departments[user.department],
      user.role,
      passwordHash,
    ],
  );
  const [rows] = await connection.execute(
    "SELECT id FROM users WHERE username = ?",
    [user.username],
  );
  return rows[0].id;
}

async function main() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const [index, name] of departmentNames.entries()) {
      await connection.execute(
        `INSERT INTO departments (name, sort_order, active) VALUES (?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
           sort_order = VALUES(sort_order),
           active = TRUE`,
        [name, index + 1],
      );
    }
    const [departmentRows] = await connection.query(
      "SELECT id, name FROM departments",
    );
    const departments = Object.fromEntries(
      departmentRows.map((department) => [department.name, department.id]),
    );

    const plans = [
      {
        name: "PC check up",
        type: "PC",
        interval: 1,
        unit: "month",
        checklist: ["Clean exterior and vents", "Check system health", "Verify updates"],
      },
      {
        name: "Printer service",
        type: "Printer",
        interval: 1,
        unit: "week",
        checklist: ["Check paper path", "Clean accessible rollers", "Print test page"],
      },
    ];
    for (const plan of plans) {
      await connection.execute(
        `INSERT INTO maintenance_plans (name, device_type, interval_value, interval_unit, checklist)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           interval_value = VALUES(interval_value),
           interval_unit = VALUES(interval_unit),
           checklist = VALUES(checklist)`,
        [plan.name, plan.type, plan.interval, plan.unit, JSON.stringify(plan.checklist)],
      );
    }

    const [dates] = await connection.query(
      `SELECT
         DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-%d') AS pcNextDue,
         DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '%Y-%m-%d') AS printerLastServiced,
         DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 4 DAY), '%Y-%m-%d') AS printerNextDue`,
    );

    const users = {};
    for (const user of [
      {
        fullName: "BMC Administrator",
        username: "admin",
        email: "admin@bmc.local",
        department: "IT",
        role: "admin",
      },
      {
        fullName: "BMC IT Technician",
        username: "technician",
        email: "technician@bmc.local",
        department: "IT",
        role: "technician",
      },
      {
        fullName: "Alex Employee",
        username: "employee1",
        email: "employee1@bmc.local",
        department: "Accounting",
        role: "employee",
      },
      {
        fullName: "Jamie Employee",
        username: "employee2",
        email: "employee2@bmc.local",
        department: "Marketing",
        role: "employee",
      },
    ]) {
      users[user.username] = await insertUser(connection, user, departments);
    }

    const devices = [
      {
        tag: "BMC-PC-001",
        type: "PC",
        brand: "Dell",
        model: "OptiPlex",
        department: "Accounting",
        location: "Accounting Office",
        assignedUser: users.employee1,
        lastServiced: null,
        nextDue: dates[0].pcNextDue,
      },
      {
        tag: "BMC-PR-001",
        type: "Printer",
        brand: "HP",
        model: "LaserJet",
        department: "Marketing",
        location: "Marketing Office",
        assignedUser: null,
        lastServiced: dates[0].printerLastServiced,
        nextDue: dates[0].printerNextDue,
      },
    ];
    const deviceIds = {};
    for (const device of devices) {
      await connection.execute(
        `INSERT INTO devices
          (asset_tag, type, brand, model, department_id, location, assigned_user_id,
           status, verification, last_serviced, next_due)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', 'Verified', ?, ?)
         ON DUPLICATE KEY UPDATE
           type = VALUES(type),
           brand = VALUES(brand),
           model = VALUES(model),
           department_id = VALUES(department_id),
           location = VALUES(location),
           assigned_user_id = VALUES(assigned_user_id),
           last_serviced = VALUES(last_serviced),
           next_due = VALUES(next_due)`,
        [
          device.tag,
          device.type,
          device.brand,
          device.model,
          departments[device.department],
          device.location,
          device.assignedUser,
          device.lastServiced,
          device.nextDue,
        ],
      );
      const [rows] = await connection.execute(
        "SELECT id FROM devices WHERE asset_tag = ?",
        [device.tag],
      );
      deviceIds[device.tag] = rows[0].id;
    }

    await connection.execute(
      `INSERT INTO tickets
        (ticket_no, requester_user_id, department_id, device_id, device_text,
         help_topic, summary, details, priority, source, status, assigned_to)
       VALUES ('IT-0001', ?, ?, ?, NULL, 'Hardware', 'Sample support request',
         'Seeded example ticket for checking the initial setup.', 'Normal',
         'Signed in', 'Open', ?)
       ON DUPLICATE KEY UPDATE
         requester_user_id = VALUES(requester_user_id),
         department_id = VALUES(department_id),
         device_id = VALUES(device_id),
         summary = VALUES(summary),
         details = VALUES(details),
         assigned_to = VALUES(assigned_to)`,
      [
        users.employee1,
        departments.Accounting,
        deviceIds["BMC-PC-001"],
        users.technician,
      ],
    );
    await connection.execute(
      `INSERT INTO tickets
        (ticket_no, guest_name, guest_email, department_id, device_text,
         help_topic, summary, details, priority, source, status)
       VALUES ('IT-0002', 'Taylor Guest', 'taylor@example.com', ?, 'Personal laptop',
         'Software', 'Sample guest request',
         'Seeded guest ticket with a device that is not registered.', 'Low',
         'Guest', 'In progress')
       ON DUPLICATE KEY UPDATE
         guest_name = VALUES(guest_name),
         guest_email = VALUES(guest_email),
         department_id = VALUES(department_id),
         device_text = VALUES(device_text),
         summary = VALUES(summary),
         details = VALUES(details),
         status = VALUES(status)`,
      [departments["HR/Admin"]],
    );

    await connection.commit();
    console.log("Seed data added. Initial password for all seeded accounts: ChangeMe123!");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Seeding failed: ${error.message}`);
  process.exitCode = 1;
});
