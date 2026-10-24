import { createContext, useContext, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, jsonBody } from "./api.js";

const AuthContext = createContext(null);
const departmentOptionsFallback = [];

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refreshUser() {
    const result = await api("/api/auth/me");
    setUser(result.user);
    return result.user;
  }

  useEffect(() => {
    api("/api/auth/me")
      .then((result) => setUser(result.user))
      .catch((requestError) => {
        if (requestError.status !== 401) setError(requestError.message);
      })
      .finally(() => setLoading(false));
  }, []);

  async function signIn(username, password) {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: jsonBody({ username, password }),
    });
    setUser(result.user);
    return result.user;
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, setUser, loading, error, refreshUser, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <img className="brand-logo" src="/bmc-logo.png" alt="BMC logo" />
      <span>
        {compact ? (
          <>
            <strong>IT Service Desk</strong>
            <small>Brilliant Metal Craft and Machine Design OPC</small>
          </>
        ) : (
          <strong>Brilliant Metal Craft and Machine Design OPC</strong>
        )}
      </span>
    </div>
  );
}

function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    try {
      await signOut();
      navigate("/");
    } catch (error) {
      window.alert(error.message);
    }
  }

  return (
    <header className="public-header">
      <Link to="/" className="brand-link" aria-label="BMC IT Support home">
        <Brand />
      </Link>
      {user ? (
        <span className="account-link">
          {user.fullName} |{" "}
          <button type="button" className="text-link" onClick={handleSignOut}>
            Sign out
          </button>
        </span>
      ) : (
        <span className="account-link">
          Guest User | <Link to="/login">Sign in</Link>
        </span>
      )}
    </header>
  );
}

function PublicHome() {
  const { user } = useAuth();
  const newTicketPath = user?.role === "employee"
    ? "/employee/new-request"
    : "/guest/new-ticket";
  return (
    <div className="public-page">
      <Header />
      <main className="home-content">
        <section className="home-intro">
          <h1>Welcome to BMC IT Support</h1>
          <p>
            Get help with your computer, printer, or other IT issue. Sign in
            with the account provided by IT to manage your requests.
          </p>
        </section>
        <section className="home-actions" aria-label="IT support actions">
          <Link className="button button-blue button-large" to={newTicketPath}>
            Open a New Ticket
          </Link>
          <Link className="button button-green button-large" to="/ticket-status">
            Check Ticket Status
          </Link>
          {user && (
            <Link className="button button-outline button-large" to={homeFor(user)}>
              Go to my account
            </Link>
          )}
        </section>
      </main>
    </div>
  );
}

function homeFor(user) {
  if (user.mustChangePassword) return "/change-password";
  if (user.role === "employee") {
    return user.onboardingCompleted ? "/employee" : "/employee/setup";
  }
  return "/staff";
}

function SignInPage() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate(homeFor(user), { replace: true });
  }, [user, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const signedInUser = await signIn(username.trim(), password);
      navigate(homeFor(signedInUser), { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="signin-page">
      <section className="signin-brand-panel">
        <div className="signin-brand-copy">
          <img src="/bmc-logo.png" alt="" />
          <h1>Brilliant Metal Craft and Machine Design OPC</h1>
          <p>IT Service Desk · Request help, track tickets, manage maintenance</p>
        </div>
      </section>
      <section className="signin-form-panel">
        <form className="signin-card" onSubmit={handleSubmit}>
          <h2>Sign in</h2>
          <p className="muted">Use the username and password from the IT department.</p>
          <FormError message={error} />
          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              maxLength={80}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Example: m.santos"
              required
              value={username}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="button button-primary button-large" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
          <p className="signin-note">
            No sign-up. IT creates every account.
            <br />
            First time? Use the temporary password from IT. You will be asked
            to choose a new one.
            <br />
            Forgot your password? Ask IT to reset it.
          </p>
        </form>
      </section>
    </main>
  );
}

function FormError({ message }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}

function ChangePasswordPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: jsonBody({ currentPassword, newPassword }),
      });
      const updatedUser = { ...user, mustChangePassword: false };
      setUser(updatedUser);
      navigate(homeFor(updatedUser), { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="center-page">
      <Header />
      <form className="form-card change-password-card" onSubmit={handleSubmit}>
        <h1>Choose a new password</h1>
        <p className="muted">
          For your security, change the temporary password before continuing.
        </p>
        <FormError message={error} />
        <label>
          Temporary password
          <input
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
        <label>
          New password
          <input
            autoComplete="new-password"
            minLength={12}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
          <small>Use 12–128 characters with at least one letter and one number.</small>
        </label>
        <label>
          Confirm new password
          <input
            autoComplete="new-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
        </label>
        <button className="button button-primary button-large" disabled={saving}>
          {saving ? "Saving..." : "Change password"}
        </button>
      </form>
    </main>
  );
}

function EmployeeSetupPage() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [computer, setComputer] = useState({
    brand: "",
    model: "",
    ram: "",
    serialNo: "",
    motherboard: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/auth/computer-setup")
      .then(({ computer: savedComputer }) => {
        if (savedComputer) {
          setComputer({
            brand: savedComputer.brand,
            model: savedComputer.model,
            ram: savedComputer.ram,
            serialNo: savedComputer.serialNo,
            motherboard: savedComputer.motherboard,
          });
        }
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  async function finishSetup(skip) {
    setError("");
    setSaving(true);
    try {
      await api("/api/auth/computer-setup", {
        method: "PATCH",
        body: jsonBody({ ...computer, skip }),
      });
      await refreshUser();
      navigate("/employee", { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    finishSetup(false);
  }

  return (
    <div className="employee-shell">
      <Header />
      <main className="employee-main">
        <h1>Add your computer</h1>
        <p className="muted">
          Tell IT about your office computer so it can be identified when
          requesting help.
        </p>
        <form className="form-card setup-card" onSubmit={handleSubmit}>
          <FormError message={error} />
          <div className="form-grid">
            <TextField label="Brand" value={computer.brand} onChange={(brand) => setComputer({ ...computer, brand })} maxLength={100} required />
            <TextField label="Model" value={computer.model} onChange={(model) => setComputer({ ...computer, model })} maxLength={100} required />
            <TextField label="RAM" value={computer.ram} onChange={(ram) => setComputer({ ...computer, ram })} maxLength={80} />
            <TextField label="Serial number" value={computer.serialNo} onChange={(serialNo) => setComputer({ ...computer, serialNo })} />
          </div>
          <TextField label="Motherboard (optional)" value={computer.motherboard} onChange={(motherboard) => setComputer({ ...computer, motherboard })} />
          <p className="info-note">
            Not sure? On Windows, open Settings, then System, then About. The
            serial number is also on the sticker on the computer.
          </p>
          <button className="button button-primary button-large" disabled={saving || loading}>
            {loading ? "Loading..." : saving ? "Saving..." : "Save my computer"}
          </button>
          <button
            className="text-button skip-button"
            disabled={saving || loading}
            onClick={() => finishSetup(true)}
            type="button"
          >
            Skip for now
          </button>
        </form>
      </main>
    </div>
  );
}

function EmployeeHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [computer, setComputer] = useState(null);
  const [computerLoaded, setComputerLoaded] = useState(false);
  const [computerError, setComputerError] = useState("");
  const [tickets, setTickets] = useState([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [ticketsError, setTicketsError] = useState("");

  useEffect(() => {
    api("/api/auth/computer-setup")
      .then(({ computer: savedComputer }) => setComputer(savedComputer))
      .catch((requestError) => setComputerError(requestError.message))
      .finally(() => setComputerLoaded(true));
    api("/api/tickets/mine")
      .then(({ tickets: employeeTickets }) => setTickets(employeeTickets))
      .catch((requestError) => setTicketsError(requestError.message))
      .finally(() => setTicketsLoaded(true));
  }, []);

  return (
    <div className="employee-shell">
      <Header />
      <main className="employee-main employee-home">
        <div className="employee-home-heading">
          <div>
            <h1>Hello, {user.fullName}</h1>
            <p className="muted">{user.department || "BMC"}</p>
          </div>
          <Link className="button button-primary" to="/employee/new-request">
            New request
          </Link>
        </div>
        <section className="employee-card">
          <h2>Your requests</h2>
          {ticketsError ? (
            <FormError message={ticketsError} />
          ) : !ticketsLoaded ? (
            <p className="muted">Loading your requests...</p>
          ) : tickets.length ? (
            <div className="table-wrap employee-ticket-wrap">
              <table className="accounts-table employee-ticket-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Submitted</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.ticketNo}>
                      <td>
                        <Link to={`/employee/requests/${ticket.ticketNo}`}>
                          {ticket.ticketNo}
                        </Link>
                      </td>
                      <td>{ticket.summary}</td>
                      <td>{formatDate(ticket.submittedAt)}</td>
                      <td><span className="ticket-status-pill">{ticket.progressStatus}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>You have not submitted any requests yet.</p>
          )}
        </section>
        <section className="employee-computer-box">
          {computerError ? (
            <FormError message={computerError} />
          ) : !computerLoaded ? (
            <p className="muted">Loading your computer details...</p>
          ) : computer ? (
            <>
              <h2>My computer</h2>
              <dl className="computer-details">
                <div><dt>Brand</dt><dd>{computer.brand || "—"}</dd></div>
                <div><dt>Model</dt><dd>{computer.model || "—"}</dd></div>
                <div><dt>RAM</dt><dd>{computer.ram || "—"}</dd></div>
                <div><dt>Serial number</dt><dd>{computer.serialNo || "—"}</dd></div>
                <div><dt>Last maintenance</dt><dd>{formatMaintenanceDate(computer.lastServiced) || "Not recorded"}</dd></div>
                <div><dt>Next maintenance</dt><dd>{formatMaintenanceDate(computer.nextDue) || "Not scheduled"}</dd></div>
              </dl>
              <button className="text-button" onClick={() => navigate("/employee/setup")}>
                Edit details
              </button>
            </>
          ) : (
            <>
              <h2>My computer</h2>
              <p>IT will add your computer details.</p>
              <button className="text-button" onClick={() => navigate("/employee/setup")}>
                Edit details
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function GuestTicketPage() {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    email: "",
    device: "",
    fullName: "",
    departmentId: "",
    helpTopic: "",
    summary: "",
    details: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/tickets/departments")
      .then(({ departments: values }) => setDepartments(values))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const result = await api("/api/tickets/guest", {
        method: "POST",
        body: jsonBody({ ...form, departmentId: Number(form.departmentId) }),
      });
      navigate(`/ticket-submitted/${result.ticketNo}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="public-page">
      <Header />
      <main className="guest-ticket-page">
        <h1>Open a New Ticket</h1>
        <p className="muted">Please fill in the form below to open a new ticket</p>
        <form onSubmit={submit}>
          <h2>Contact Information</h2>
          <div className="guest-contact-grid">
            <TextField label="Email Address" type="email" value={form.email} onChange={(value) => updateForm("email", value)} maxLength={254} required />
            <TextField label="Device" value={form.device} onChange={(value) => updateForm("device", value)} maxLength={255} placeholder="Asset tag or device name" />
            <TextField label="Full Name" value={form.fullName} onChange={(value) => updateForm("fullName", value)} maxLength={150} required />
            <label>
              Department
              <select
                onChange={(event) => updateForm("departmentId", event.target.value)}
                required
                value={form.departmentId}
              >
                <option value="">Choose a department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
            <label>
              Help Topic
              <select
                onChange={(event) => updateForm("helpTopic", event.target.value)}
                required
                value={form.helpTopic}
              >
                <option value="">Choose a help topic</option>
                {helpTopicOptions.map((topic) => (
                  <option key={topic} value={topic}>{topic}</option>
                ))}
              </select>
            </label>
          </div>
          <hr />
          <h2>Ticket Details</h2>
          <p className="muted">Please describe your issue</p>
          <div className="guest-ticket-details">
            <TextField label="Issue Summary" value={form.summary} onChange={(value) => updateForm("summary", value)} maxLength={200} required />
            <label>
              Details
              <textarea
                maxLength={10000}
                onChange={(event) => updateForm("details", event.target.value)}
                placeholder="Details on the reasons for opening the ticket"
                required
                rows={10}
                value={form.details}
              />
            </label>
          </div>
          <FormError message={error} />
          <div className="form-actions">
            <button className="button button-primary" disabled={saving || loading}>
              {loading ? "Loading..." : saving ? "Creating..." : "Create Ticket"}
            </button>
            <Link className="button button-secondary" to="/">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}

const helpTopicOptions = [
  "Hardware",
  "Software",
  "Network",
  "Account access",
  "Printer",
  "Other",
];

function TicketSubmittedPage() {
  const { ticketNo } = useParams();
  const { user } = useAuth();
  const employee = user?.role === "employee";

  return (
    <div className="employee-shell">
      <Header />
      <main className="ticket-submitted-page">
        <div className="success-check" aria-hidden="true">✓</div>
        <h1>Request sent</h1>
        <p>Your ticket number is <strong>{ticketNo}</strong>.</p>
        <p>IT will look at it soon. Check progress anytime.</p>
        {employee ? (
          <Link className="button button-primary" to={`/employee/requests/${ticketNo}`}>
            View request status
          </Link>
        ) : (
          <Link className="button button-primary" to={`/ticket-status?ticketNo=${encodeURIComponent(ticketNo)}`}>
            Check Ticket Status
          </Link>
        )}
      </main>
    </div>
  );
}

function TicketStatusForm() {
  const [searchParams] = useSearchParams();
  const [ticketNo, setTicketNo] = useState(searchParams.get("ticketNo") || "");
  const [email, setEmail] = useState("");
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  async function checkStatus(event) {
    event.preventDefault();
    setError("");
    setTicket(null);
    setSearching(true);
    try {
      const result = await api("/api/tickets/guest-status", {
        method: "POST",
        body: jsonBody({ ticketNo, email }),
      });
      setTicket(result.ticket);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="public-page">
      <Header />
      <main className="ticket-status-page">
        <h1>Check Ticket Status</h1>
        <p className="muted">Enter your ticket number and the email address used to submit it.</p>
        <form className="ticket-status-lookup" onSubmit={checkStatus}>
          <TextField label="Ticket number" value={ticketNo} onChange={setTicketNo} maxLength={20} required />
          <TextField label="Email address" type="email" value={email} onChange={setEmail} maxLength={254} required />
          <FormError message={error} />
          <button className="button button-primary" disabled={searching}>
            {searching ? "Checking..." : "Check status"}
          </button>
        </form>
        {ticket && <TicketStatusCard ticket={ticket} />}
      </main>
    </div>
  );
}

function TicketProgress({ ticket }) {
  const steps = ["Submitted", "Received", "Assigned", "In repair", "Resolved"];
  return (
    <div
      className="ticket-progress"
      role="progressbar"
      aria-label="Ticket progress"
      aria-valuemin={0}
      aria-valuemax={steps.length - 1}
      aria-valuenow={ticket.progressIndex}
      aria-valuetext={ticket.progressStatus}
    >
      {steps.map((step, index) => (
        <div
          className={`ticket-progress-step ${index <= ticket.progressIndex ? "is-complete" : ""} ${step === ticket.progressStatus ? "is-current" : ""}`}
          key={step}
        >
          <span className="ticket-progress-dot">{index < ticket.progressIndex ? "✓" : index + 1}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

function TicketStatusCard({ ticket }) {
  return (
    <section className="ticket-status-card">
      <div className="ticket-status-card-heading">
        <div>
          <h2>{ticket.summary}</h2>
          <p className="muted">{ticket.ticketNo} · Submitted {formatDate(ticket.submittedAt)}</p>
        </div>
        <span className="ticket-status-pill">{ticket.progressStatus}</span>
      </div>
      <TicketProgress ticket={ticket} />
      <dl className="ticket-meta">
        <div><dt>Technician</dt><dd>{ticket.technician}</dd></div>
        <div><dt>Last update</dt><dd>{ticket.lastUpdateAt ? formatDate(ticket.lastUpdateAt) : "Just submitted"}</dd></div>
      </dl>
      <p className="ticket-last-update">{ticket.lastUpdate}</p>
      <section className="ticket-messages">
        <h3>Messages from IT</h3>
        {ticket.messages.length ? (
          ticket.messages.map((message, index) => (
            <article key={`${message.createdAt}-${index}`}>
              <p>{message.note}</p>
              <small>{formatDate(message.createdAt)}</small>
            </article>
          ))
        ) : (
          <p className="muted">There are no messages from IT yet.</p>
        )}
      </section>
    </section>
  );
}

function EmployeeNewRequestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [options, setOptions] = useState({ computer: null, printers: [] });
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [deviceChoice, setDeviceChoice] = useState("other");
  const [printerId, setPrinterId] = useState("");
  const [otherDevice, setOtherDevice] = useState("");
  const [helpTopic, setHelpTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("Urgent");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/tickets/employee-options")
      .then((result) => {
        setOptions(result);
        if (result.computer) setDeviceChoice("computer");
        else if (result.printers.length) {
          setDeviceChoice("printer");
          setPrinterId(String(result.printers[0].id));
        }
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setOptionsLoaded(true));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const result = await api("/api/tickets/employee", {
        method: "POST",
        body: jsonBody({
          deviceChoice,
          ...(deviceChoice === "printer" ? { printerId: Number(printerId) } : {}),
          ...(deviceChoice === "other" ? { otherDevice } : {}),
          helpTopic,
          summary,
          details,
          priority,
        }),
      });
      navigate(`/ticket-submitted/${result.ticketNo}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="employee-shell">
      <Header />
      <main className="employee-request-page">
        <Link className="back-link" to="/employee">‹ My requests</Link>
        <form className="employee-request-form" onSubmit={submit}>
          <h1>New request</h1>
          <section className="request-contact">
            <h2>Your information</h2>
            <div className="request-contact-grid">
              <label>Name<input readOnly value={user.fullName} /></label>
              <label>Email<input readOnly value={user.email} /></label>
              <label>Department<input readOnly value={user.department || ""} /></label>
            </div>
          </section>
          <section className="request-section">
            <h2>What needs help?</h2>
            <div className="device-choice-grid">
              <button
                className={`device-choice ${deviceChoice === "computer" ? "selected" : ""}`}
                disabled={!options.computer}
                onClick={() => setDeviceChoice("computer")}
                type="button"
              >
                <strong>My computer</strong>
                <small>{options.computer ? `${options.computer.brand || ""} ${options.computer.model || ""}`.trim() || options.computer.assetTag : "Set up your computer first"}</small>
              </button>
              <button
                className={`device-choice ${deviceChoice === "printer" ? "selected" : ""}`}
                disabled={!options.printers.length}
                onClick={() => setDeviceChoice("printer")}
                type="button"
              >
                <strong>A printer</strong>
                <small>Shared by many</small>
              </button>
              <button
                className={`device-choice ${deviceChoice === "other" ? "selected" : ""}`}
                onClick={() => setDeviceChoice("other")}
                type="button"
              >
                <strong>Something else</strong>
                <small>Tell us what it is</small>
              </button>
            </div>
            {deviceChoice === "printer" && (
              <div className="printer-options">
                <h3>Which printer?</h3>
                {options.printers.map((printer) => (
                  <label className={`printer-option ${String(printer.id) === printerId ? "selected" : ""}`} key={printer.id}>
                    <input
                      checked={String(printer.id) === printerId}
                      name="printer"
                      onChange={() => setPrinterId(String(printer.id))}
                      type="radio"
                      value={printer.id}
                    />
                    <span>
                      <strong>{printer.department ? `${printer.department} printer` : `${printer.brand || "Shared"} printer`}</strong>
                      {" · "}{printer.assetTag}
                      <small>{printer.location || `${printer.brand || ""} ${printer.model || ""}`.trim()}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {deviceChoice === "other" && (
              <TextField label="What device or equipment?" value={otherDevice} onChange={setOtherDevice} maxLength={255} required />
            )}
          </section>
          <section className="request-section">
            <label>
              Help topic
              <select onChange={(event) => setHelpTopic(event.target.value)} required value={helpTopic}>
                <option value="">Choose a help topic</option>
                {helpTopicOptions.map((topic) => (
                  <option key={topic} value={topic}>{topic}</option>
                ))}
              </select>
            </label>
            <TextField label="Issue summary" value={summary} onChange={setSummary} maxLength={200} required />
            <label>
              What is the problem?
              <textarea
                maxLength={10000}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="Tell us what happened and what you have already tried."
                required
                rows={4}
                value={details}
              />
            </label>
          </section>
          <section className="request-section">
            <h2>How urgent is it?</h2>
            <div className="priority-options">
              {[
                { value: "Urgent", label: "I cannot work" },
                { value: "Normal", label: "I can still work" },
                { value: "Low", label: "It can wait" },
              ].map((option) => (
                <button
                  className={`priority-choice ${priority === option.value ? "selected" : ""}`}
                  key={option.value}
                  onClick={() => setPriority(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
          <p className="request-footnote">Your name and department are sent automatically.</p>
          <FormError message={error} />
          <button className="button button-primary button-large" disabled={saving || !optionsLoaded}>
            {saving ? "Sending..." : "Send to IT"}
          </button>
          <Link className="request-cancel" to="/employee">Cancel</Link>
        </form>
      </main>
    </div>
  );
}

function EmployeeTicketStatusPage() {
  const { ticketNo } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/api/tickets/mine/${encodeURIComponent(ticketNo)}`)
      .then(({ ticket: result }) => setTicket(result))
      .catch((requestError) => setError(requestError.message));
  }, [ticketNo]);

  return (
    <div className="employee-shell">
      <Header />
      <main className="employee-request-page">
        <Link className="back-link" to="/employee">‹ My requests</Link>
        <h1>Request status</h1>
        <FormError message={error} />
        {ticket && <TicketStatusCard ticket={ticket} />}
      </main>
    </div>
  );
}

function TextField({ label, value, onChange, required = false, type = "text", maxLength = 120, placeholder }) {
  return (
    <label>
      {label}
      <input
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function AuthGate({ children, roles, allowPasswordChange = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingPage />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!allowPasswordChange && user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  if (!allowPasswordChange && user.role === "employee" && !user.onboardingCompleted && location.pathname !== "/employee/setup") {
    return <Navigate to="/employee/setup" replace />;
  }
  return children;
}

function LoadingPage() {
  return <main className="loading-page">Loading your account...</main>;
}

function StaffLayout({ children, activePage }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const links = [
    { label: "Dashboard", href: "/staff", group: "" },
    { label: "Ticket queue", href: "/staff/tickets", group: "Tickets" },
    { label: "Devices", href: "/staff/devices", group: "Devices" },
    { label: "Maintenance plans", href: "/staff/maintenance-plans", group: "Maintenance" },
    { label: "Maintenance schedule", href: "/staff/maintenance-schedule", group: "Maintenance" },
    { label: "Reports", group: "Admin" },
    ...(user.role === "admin"
      ? [
          { label: "Employee accounts", href: "/staff/accounts/employees", group: "Admin" },
          { label: "IT accounts", href: "/staff/accounts/it", group: "Admin" },
        ]
      : []),
  ];

  async function handleSignOut() {
    try {
      await signOut();
      navigate("/");
    } catch (error) {
      window.alert(error.message);
    }
  }

  return (
    <div className="staff-layout">
      <aside className="staff-sidebar">
        <Link to="/staff" className="sidebar-brand" aria-label="IT Service Desk home">
          <Brand compact />
        </Link>
        <nav aria-label="IT staff navigation">
          {links.map((item) => (
            <div key={item.label}>
              {item.group && <p className="sidebar-group">{item.group}</p>}
              {item.href ? (
                <Link
                  className={`sidebar-link ${activePage === item.label ? "is-active" : ""}`}
                  to={item.href}
                >
                  {item.label}
                </Link>
              ) : (
                <span className="sidebar-link sidebar-link-disabled">{item.label}</span>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-user">
          <strong>{user.fullName}</strong>
          <span>{user.role === "admin" ? "Admin" : "Technician"}</span>
          <button className="text-button" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>
      <main className="staff-content">{children}</main>
    </div>
  );
}

function StaffHome() {
  const { user } = useAuth();
  return (
    <StaffLayout activePage="Dashboard">
      <h1>Dashboard</h1>
      <p className="muted">Welcome, {user.fullName}.</p>
      <div className="staff-welcome-card">
        <h2>{user.role === "admin" ? "Administrator" : "Technician"} account</h2>
        <p>
          {user.role === "admin"
            ? "Manage employee and IT accounts from the Admin section."
            : "Account management is available to admins only."}
        </p>
      </div>
    </StaffLayout>
  );
}

function TicketQueuePage() {
  const [tickets, setTickets] = useState([]);
  const [status, setStatus] = useState("All");
  const [priority, setPriority] = useState("All");
  const [source, setSource] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = new URLSearchParams();
    if (status !== "All") query.set("status", status);
    if (priority !== "All") query.set("priority", priority);
    if (source !== "All") query.set("source", source);
    if (search) query.set("search", search);
    setLoading(true);
    api(`/api/staff/tickets/?${query}`)
      .then(({ tickets: results }) => {
        setTickets(results);
        setError("");
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [status, priority, source, search]);

  function handleSearch(event) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <StaffLayout activePage="Ticket queue">
      <div className="ticket-queue-heading">
        <div>
          <h1>Ticket Queue</h1>
          <p className="muted">Self-service and walk-in tickets in one list.</p>
        </div>
        <Link className="button button-primary" to="/staff/tickets/walk-in">
          + Walk-in Ticket
        </Link>
      </div>
      <div className="ticket-filters">
        <form className="ticket-search" onSubmit={handleSearch}>
          <input
            aria-label="Search tickets"
            maxLength={120}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search ticket, name, or device"
            value={searchInput}
          />
          <button className="button button-secondary">Search</button>
        </form>
        <label>
          Status
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="All">All statuses</option>
            {ticketStatuses.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Priority
          <select onChange={(event) => setPriority(event.target.value)} value={priority}>
            <option value="All">All priorities</option>
            {["Urgent", "High", "Normal", "Low"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Source
          <select onChange={(event) => setSource(event.target.value)} value={source}>
            <option value="All">All sources</option>
            {["Guest", "Signed in", "Walk-in"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <FormError message={error} />
      <div className="table-wrap staff-ticket-table-wrap">
        <table className="accounts-table staff-ticket-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Employee / Guest</th>
              <th>Department</th>
              <th>Device</th>
              <th>Priority</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.ticketNo}>
                <td>
                  <Link to={`/staff/tickets/${ticket.ticketNo}`}>{ticket.ticketNo}</Link>
                  <small className="ticket-subject">{ticket.summary}</small>
                </td>
                <td>{ticket.requesterName}</td>
                <td>{ticket.department || "—"}</td>
                <td>
                  {ticket.deviceTag || ticket.deviceText || <span className="unregistered-badge">Not registered</span>}
                  {ticket.deviceText && !ticket.deviceId && <small className="ticket-subject">Not registered</small>}
                </td>
                <td><span className={`priority-badge priority-${ticket.priority.toLowerCase()}`}>{ticket.priority === "Normal" ? "Medium" : ticket.priority}</span></td>
                <td><span className={`source-badge source-${ticket.source.toLowerCase().replace(/\s+/g, "-")}`}>{ticket.source}</span></td>
                <td><span className={`staff-status-badge status-${ticket.status.toLowerCase().replace(/\s+/g, "-")}`}>{ticket.status}</span></td>
              </tr>
            ))}
            {!loading && tickets.length === 0 && (
              <tr><td className="empty-cell" colSpan={7}>No tickets match these filters.</td></tr>
            )}
            {loading && <tr><td className="empty-cell" colSpan={7}>Loading tickets...</td></tr>}
          </tbody>
        </table>
      </div>
    </StaffLayout>
  );
}

const ticketStatuses = ["Open", "In progress", "Waiting for parts", "Resolved", "Closed"];

function TicketDetailPage() {
  const { ticketNo } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [status, setStatus] = useState("Open");
  const [note, setNote] = useState("");
  const [visibleToRequester, setVisibleToRequester] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceMatches, setDeviceMatches] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadTicket() {
    const result = await api(`/api/staff/tickets/${encodeURIComponent(ticketNo)}`);
    setTicket(result.ticket);
    setAssignedTo(result.ticket.assignedTo ? String(result.ticket.assignedTo) : "");
    setStatus(result.ticket.status);
  }

  useEffect(() => {
    Promise.all([
      loadTicket(),
      api("/api/staff/tickets/lookups").then(({ technicians: values }) => setTechnicians(values)),
    ])
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [ticketNo]);

  useEffect(() => {
    if (!deviceSearch.trim()) {
      setDeviceMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api(`/api/staff/tickets/lookups?query=${encodeURIComponent(deviceSearch.trim())}`)
        .then(({ devices }) => setDeviceMatches(devices))
        .catch((requestError) => setError(requestError.message));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [deviceSearch]);

  async function saveUpdate(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const result = await api(`/api/staff/tickets/${encodeURIComponent(ticketNo)}`, {
        method: "PATCH",
        body: jsonBody({ status, assignedTo, note, visibleToRequester }),
      });
      setNotice(result.message);
      setNote("");
      setVisibleToRequester(false);
      await loadTicket();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function linkDevice(assetTag) {
    setError("");
    setNotice("");
    try {
      const result = await api(`/api/staff/tickets/${encodeURIComponent(ticketNo)}/link-device`, {
        method: "POST",
        body: jsonBody({ assetTag }),
      });
      setNotice(result.message);
      setDeviceSearch("");
      setDeviceMatches([]);
      await loadTicket();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <StaffLayout activePage="Ticket queue">
      <Link className="back-link" to="/staff/tickets">‹ Ticket queue</Link>
      {loading ? (
        <p className="muted">Loading ticket...</p>
      ) : error && !ticket ? (
        <FormError message={error} />
      ) : ticket && (
        <>
          <div className="ticket-detail-heading">
            <div>
              <h1>{ticket.ticketNo}</h1>
              <p className="muted">{ticket.summary}</p>
            </div>
            <span className={`staff-status-badge status-${ticket.status.toLowerCase().replace(/\s+/g, "-")}`}>{ticket.status}</span>
          </div>
          <FormError message={error} />
          {notice && <div className="notice" role="status">{notice}</div>}
          <div className="ticket-detail-grid">
            <section className="ticket-detail-card">
              <h2>Details</h2>
              <dl className="ticket-detail-list">
                <div><dt>Who asked</dt><dd>{ticket.requesterName} <small>({ticket.requesterType})</small><br />{ticket.requesterEmail || "No email recorded"}</dd></div>
                <div><dt>Department</dt><dd>{ticket.department || "—"}</dd></div>
                <div><dt>Priority</dt><dd><span className={`priority-badge priority-${ticket.priority.toLowerCase()}`}>{ticket.priority === "Normal" ? "Medium" : ticket.priority}</span></dd></div>
                <div><dt>Source</dt><dd><span className={`source-badge source-${ticket.source.toLowerCase().replace(/\s+/g, "-")}`}>{ticket.source}</span></dd></div>
                <div><dt>Help topic</dt><dd>{ticket.helpTopic}</dd></div>
                <div>
                  <dt>Device</dt>
                  <dd>
                    {ticket.device?.id ? (
                      <>
                        <strong>{ticket.device.assetTag}</strong>
                        <span className="ticket-device-subtitle">{[ticket.device.brand, ticket.device.model].filter(Boolean).join(" ")}</span>
                        <span className="ticket-device-subtitle">Last maintenance: {formatMaintenanceDate(ticket.device.lastServiced) || "Not recorded"}</span>
                        <span className="ticket-device-subtitle">Next maintenance: {formatMaintenanceDate(ticket.device.nextDue) || "Not scheduled"}</span>
                      </>
                    ) : (
                      <>
                        <span>{ticket.device?.text || <span className="unregistered-badge">Not registered</span>}</span>
                        {ticket.device?.text && <span className="unregistered-badge">Not registered</span>}
                        <div className="link-device-tools">
                          <label>
                            Search asset tag
                            <input
                              onChange={(event) => setDeviceSearch(event.target.value)}
                              placeholder="Type an asset tag"
                              value={deviceSearch}
                            />
                          </label>
                          {deviceMatches.filter((device) => device.assetTag.toLowerCase().includes(deviceSearch.trim().toLowerCase())).map((device) => (
                            <button className="device-match" key={device.id} onClick={() => linkDevice(device.assetTag)} type="button">
                              {device.assetTag} · {device.type} {[device.brand, device.model].filter(Boolean).join(" ")}
                            </button>
                          ))}
                          <Link
                            className="button button-secondary"
                            to={`/staff/devices/new?ticketNo=${encodeURIComponent(ticket.ticketNo)}&assetTag=${encodeURIComponent(ticket.device?.text || "")}`}
                          >
                            Add device
                          </Link>
                        </div>
                      </>
                    )}
                  </dd>
                </div>
                <div><dt>Problem</dt><dd className="ticket-problem">{ticket.details}</dd></div>
              </dl>
            </section>
            <section className="ticket-detail-card">
              <h2>History</h2>
              <ol className="ticket-history">
                {ticket.history.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`}>
                    <span className="history-marker" />
                    <div>
                      <p>{entry.note}</p>
                      {(entry.oldStatus || entry.newStatus) && (
                        <small>Status: {entry.oldStatus || "—"} → {entry.newStatus || "—"}</small>
                      )}
                      <small>{entry.author} · {formatDate(entry.createdAt)}</small>
                      {entry.visibleToRequester && <span className="history-visible-badge">Shown to requester</span>}
                    </div>
                  </li>
                ))}
                {ticket.history.length === 0 && <li>No history recorded.</li>}
              </ol>
            </section>
            <section className="ticket-detail-card update-ticket-card">
              <h2>Update this ticket</h2>
              <form onSubmit={saveUpdate}>
                <label>
                  Status
                  <select onChange={(event) => setStatus(event.target.value)} value={status}>
                    {ticketStatuses.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  Assigned to
                  <select onChange={(event) => setAssignedTo(event.target.value)} value={assignedTo}>
                    <option value="">Unassigned</option>
                    {technicians.map((technician) => (
                      <option key={technician.id} value={technician.id}>
                        {technician.fullName}{user.id === technician.id ? " (you)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note
                  <textarea
                    maxLength={5000}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Add an internal note or message for the requester"
                    rows={5}
                    value={note}
                  />
                </label>
                <label className="visible-note-check">
                  <input
                    checked={visibleToRequester}
                    onChange={(event) => setVisibleToRequester(event.target.checked)}
                    type="checkbox"
                  />
                  Show this note to the employee
                </label>
                <button className="button button-primary" disabled={saving}>
                  {saving ? "Saving..." : "Save update"}
                </button>
              </form>
            </section>
          </div>
        </>
      )}
    </StaffLayout>
  );
}

function DeviceListPage() {
  const [devices, setDevices] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");
  const [departmentId, setDepartmentId] = useState("All");
  const [status, setStatus] = useState("All");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/staff/devices/lookups")
      .then(({ departments: values }) => setDepartments(values))
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (type !== "All") query.set("type", type);
    if (departmentId !== "All") query.set("departmentId", departmentId);
    if (status !== "All") query.set("status", status);
    setLoading(true);
    api(`/api/staff/devices/?${query}`)
      .then(({ devices: values }) => {
        setDevices(values);
        setError("");
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [search, type, departmentId, status]);

  function handleSearch(event) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  const columns = type === "All"
    ? ["Asset tag", "Type", "Maker and model", "Details", "Serial number", "Department", "Verification", "View specs"]
    : type === "PC"
      ? ["Asset tag", "Maker and model", "RAM", "Motherboard", "Serial number", "Department", "Verification", "View specs"]
      : ["Asset tag", "Maker and model", "Printer type", "Toner or ink model", "IP address", "Serial number", "Department", "Verification", "View specs"];

  return (
    <StaffLayout activePage="Devices">
      <div className="page-heading">
        <div>
          <h1>Devices</h1>
          <p className="muted">Device specifications and IT verification.</p>
        </div>
        <Link className="button button-primary" to="/staff/devices/new">+ Add device</Link>
      </div>
      <div className="device-filters">
        <form className="ticket-search" onSubmit={handleSearch}>
          <input
            aria-label="Search devices"
            maxLength={120}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search asset tag, maker, model, serial number, or IP address"
            value={searchInput}
          />
          <button className="button button-secondary">Search</button>
        </form>
        <label>
          Type
          <select onChange={(event) => setType(event.target.value)} value={type}>
            <option value="All">All types</option>
            <option value="PC">PC</option>
            <option value="Printer">Printer</option>
          </select>
        </label>
        <label>
          Department
          <select onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
            <option value="All">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="All">All statuses</option>
            <option value="Active">Active</option>
            <option value="Retired">Retired</option>
          </select>
        </label>
      </div>
      <FormError message={error} />
      <div className="table-wrap device-table-wrap">
        <table className="accounts-table device-table">
          <thead>
            <tr>
              {columns.map((column) => <th key={column}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id}>
                <td>{device.assetTag}</td>
                {type === "All" && <td>{device.type}</td>}
                <td>{[device.brand, device.model].filter(Boolean).join(" ") || "—"}</td>
                {type === "All" && (
                  <td>
                    {(device.type === "PC"
                      ? [device.ram, device.motherboard]
                      : [device.printerType, device.ipAddress]
                    ).filter(Boolean).join(" · ") || "—"}
                  </td>
                )}
                {type === "PC" && (
                  <>
                    <td>{device.ram || "—"}</td>
                    <td>{device.motherboard || "—"}</td>
                  </>
                )}
                {type === "Printer" && (
                  <>
                    <td>{device.printerType || "—"}</td>
                    <td>{device.supplyModel || "—"}</td>
                    <td>{device.ipAddress || "—"}</td>
                  </>
                )}
                <td>{device.serialNo || "—"}</td>
                <td>{device.department || "—"}</td>
                <td>
                  <span className={`device-verification ${device.verification === "Verified" ? "is-verified" : "needs-check"}`}>
                    {device.verification}
                  </span>
                </td>
                <td><Link to={`/staff/devices/${device.id}`}>View specs</Link></td>
              </tr>
            ))}
            {!loading && devices.length === 0 && (
              <tr><td className="empty-cell" colSpan={columns.length}>No devices match these filters.</td></tr>
            )}
            {loading && <tr><td className="empty-cell" colSpan={columns.length}>Loading devices...</td></tr>}
          </tbody>
        </table>
      </div>
    </StaffLayout>
  );
}

function DeviceEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ticketNo = searchParams.get("ticketNo") || "";
  const [form, setForm] = useState({
    assetTag: searchParams.get("assetTag") || "",
    type: "PC",
    brand: "",
    model: "",
    ram: "",
    motherboard: "",
    printerType: "",
    supplyModel: "",
    ipAddress: "",
    serialNo: "",
    location: "",
    departmentId: "",
    assignedUserId: "",
    lastServiced: "",
  });
  const [lookups, setLookups] = useState({ departments: [], employees: [], plans: [] });
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api("/api/staff/devices/lookups").then(setLookups),
      id ? api(`/api/staff/devices/${encodeURIComponent(id)}`).then(({ device }) => {
        setForm({
          assetTag: device.assetTag || "",
          type: device.type,
          brand: device.brand || "",
          model: device.model || "",
          ram: device.ram || "",
          motherboard: device.motherboard || "",
          printerType: device.printerType || "",
          supplyModel: device.supplyModel || "",
          ipAddress: device.ipAddress || "",
          serialNo: device.serialNo || "",
          location: device.location || "",
          departmentId: device.departmentId ? String(device.departmentId) : "",
          assignedUserId: device.assignedUserId ? String(device.assignedUserId) : "",
          lastServiced: device.lastServiced || "",
        });
      }) : Promise.resolve(),
    ])
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [id]);

  const selectedPlan = lookups.plans.find((plan) => plan.deviceType === form.type);
  const selectedInterval = selectedPlan
    ? `${selectedPlan.name} · every ${selectedPlan.intervalValue} ${selectedPlan.intervalUnit}${selectedPlan.intervalValue === 1 ? "" : "s"}`
    : "No maintenance plan configured for this type";

  function updateForm(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function saveDevice(event) {
    event.preventDefault();
    setError("");
    if (form.type === "Printer" && form.ipAddress
      && !/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(form.ipAddress.trim())) {
      setError("Enter a valid IPv4 address.");
      return;
    }
    setSaving(true);
    const {
      printerType,
      supplyModel,
      ipAddress,
      ...deviceFields
    } = form;
    const payload = {
      ...deviceFields,
      printer_type: printerType,
      supply_model: supplyModel,
      ip_address: ipAddress,
      departmentId: form.departmentId,
      assignedUserId: form.assignedUserId || null,
      lastServiced: form.lastServiced || null,
    };
    try {
      const result = await api(
        id
          ? `/api/staff/devices/${encodeURIComponent(id)}`
          : `/api/staff/devices/${ticketNo ? `?ticketNo=${encodeURIComponent(ticketNo)}` : ""}`,
        { method: id ? "PATCH" : "POST", body: jsonBody(payload) },
      );
      if (result.linkedTicketNo) {
        navigate(`/staff/tickets/${encodeURIComponent(result.linkedTicketNo)}`);
      } else {
        navigate(`/staff/devices/${id || result.id}`);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <StaffLayout activePage="Devices"><p className="muted">Loading device...</p></StaffLayout>;
  }

  return (
    <StaffLayout activePage="Devices">
      <Link className="back-link" to={id ? `/staff/devices/${id}` : "/staff/devices"}>‹ {id ? "Device details" : "Devices"}</Link>
      <h1>{id ? "Edit device specifications" : "Add device"}</h1>
      <p className="muted device-editor-intro">Register a PC or printer and attach its maintenance plan.</p>
      {ticketNo && (
        <div className="device-ticket-banner">
          Adding from ticket {ticketNo}. The new device will be linked to that ticket.
        </div>
      )}
      <FormError message={error} />
      <form className="device-editor-card" onSubmit={saveDevice}>
        <div className="device-editor-grid">
          <TextField label="Asset tag" value={form.assetTag} onChange={(value) => updateForm("assetTag", value)} maxLength={80} required />
          <label>
            Type
            <select onChange={(event) => updateForm("type", event.target.value)} value={form.type}>
              <option value="PC">PC</option>
              <option value="Printer">Printer</option>
            </select>
          </label>
          <TextField label="Brand" value={form.brand} onChange={(value) => updateForm("brand", value)} maxLength={100} />
          <TextField label="Model" value={form.model} onChange={(value) => updateForm("model", value)} maxLength={100} />
          {form.type === "PC" ? (
            <>
              <TextField label="RAM" value={form.ram} onChange={(value) => updateForm("ram", value)} maxLength={80} />
              <TextField label="Motherboard" value={form.motherboard} onChange={(value) => updateForm("motherboard", value)} maxLength={120} />
            </>
          ) : (
            <>
              <label>
                Printer type
                <select onChange={(event) => updateForm("printerType", event.target.value)} required value={form.printerType}>
                  <option value="">Choose printer type</option>
                  <option value="Laser">Laser</option>
                  <option value="Inkjet or ink tank">Inkjet or ink tank</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <TextField label="Toner or ink model (optional)" value={form.supplyModel} onChange={(value) => updateForm("supplyModel", value)} maxLength={120} />
              <TextField
                label="Network IP address (optional)"
                value={form.ipAddress}
                onChange={(value) => updateForm("ipAddress", value)}
                maxLength={45}
                placeholder="192.168.1.20"
              />
            </>
          )}
          <TextField label="Serial number" value={form.serialNo} onChange={(value) => updateForm("serialNo", value)} maxLength={120} />
          <TextField label="Location" value={form.location} onChange={(value) => updateForm("location", value)} maxLength={150} />
          <label>
            Department
            <select onChange={(event) => updateForm("departmentId", event.target.value)} required value={form.departmentId}>
              <option value="">Choose a department</option>
              {lookups.departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>
          <label>
            Assigned employee
            <select onChange={(event) => updateForm("assignedUserId", event.target.value)} value={form.assignedUserId}>
              <option value="">Unassigned</option>
              {lookups.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.fullName}</option>
              ))}
            </select>
          </label>
          <TextField
            label="Last serviced (optional)"
            value={form.lastServiced}
            onChange={(value) => updateForm("lastServiced", value)}
            type="date"
          />
          <label className="device-plan-readonly">
            Maintenance plan
            <input aria-readonly="true" readOnly value={selectedInterval} />
          </label>
        </div>
        {!selectedPlan && <p className="form-error">Add a plan for this device type before saving.</p>}
        <div className="form-actions">
          <Link className="button button-secondary" to={id ? `/staff/devices/${id}` : "/staff/devices"}>Cancel</Link>
          <button className="button button-primary" disabled={saving || !selectedPlan}>
            {saving ? "Saving..." : id ? "Save specifications" : "Save device"}
          </button>
        </div>
      </form>
    </StaffLayout>
  );
}

function DeviceDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingVerification, setSavingVerification] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");

  async function loadDevice() {
    const result = await api(`/api/staff/devices/${encodeURIComponent(id)}`);
    setDevice(result.device);
  }

  useEffect(() => {
    loadDevice()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function verifyDevice() {
    setError("");
    setNotice("");
    setSavingVerification(true);
    try {
      const result = await api(`/api/staff/devices/${encodeURIComponent(id)}/verification`, {
        method: "PATCH",
        body: jsonBody({ verification: "Verified" }),
      });
      setNotice(result.message);
      await loadDevice();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingVerification(false);
    }
  }

  return (
    <StaffLayout activePage="Devices">
      <Link className="back-link" to="/staff/devices">‹ Back to devices</Link>
      {loading ? <p className="muted">Loading device...</p> : error && !device ? <FormError message={error} /> : device && (
        <>
          <div className="page-heading device-detail-heading">
            <div>
              <h1>{device.assetTag} {device.brand} {device.model}</h1>
              <p className="muted">{device.department || "No department"} · {device.assignedTo ? `Assigned to ${device.assignedTo}` : "Unassigned"}</p>
            </div>
            <div className="device-detail-actions">
              {device.status === "Active" && (
                <Link className="button button-secondary" to={`/staff/devices/${device.id}/checkup`}>Record checkup</Link>
              )}
              <Link className="button button-secondary" to={`/staff/devices/${device.id}/edit`}>Edit specs</Link>
              {device.verification === "Needs IT check" && (
                <button className="button button-primary" disabled={savingVerification} onClick={verifyDevice} type="button">
                  {savingVerification ? "Saving..." : "Mark verified"}
                </button>
              )}
            </div>
          </div>
          <FormError message={error} />
          {notice && <div className="notice" role="status">{notice}</div>}
          <div className="device-detail-grid">
            <section className="ticket-detail-card">
              <h2>Specifications</h2>
              <dl className="device-spec-list">
                <div><dt>Type</dt><dd>{device.type}</dd></div>
                <div><dt>Brand</dt><dd>{device.brand || "—"}</dd></div>
                <div><dt>Model</dt><dd>{device.model || "—"}</dd></div>
                {device.type === "PC" ? (
                  <>
                    <div><dt>RAM</dt><dd>{device.ram || "—"}</dd></div>
                    <div><dt>Motherboard</dt><dd>{device.motherboard || "—"}</dd></div>
                  </>
                ) : (
                  <>
                    <div><dt>Printer type</dt><dd>{device.printerType || "—"}</dd></div>
                    <div><dt>Toner or ink model</dt><dd>{device.supplyModel || "—"}</dd></div>
                    <div><dt>IP address</dt><dd>{device.ipAddress || "—"}</dd></div>
                  </>
                )}
                <div><dt>Serial number</dt><dd>{device.serialNo || "—"}</dd></div>
                <div><dt>Department</dt><dd>{device.department || "—"}</dd></div>
                <div><dt>Location</dt><dd>{device.location || "—"}</dd></div>
                <div><dt>Assigned employee</dt><dd>{device.assignedTo || "Unassigned"}</dd></div>
                <div><dt>Verification</dt><dd>{device.verification}</dd></div>
                <div><dt>Status</dt><dd>{device.status}</dd></div>
              </dl>
            </section>
            <section className="ticket-detail-card">
              <h2>Maintenance</h2>
              <p className="device-plan-title">
                {device.plan
                  ? `${device.plan.name} · every ${device.plan.intervalValue} ${device.plan.intervalUnit}${device.plan.intervalValue === 1 ? "" : "s"}`
                  : "No plan configured"}
              </p>
              <dl className="device-date-list">
                <div><dt>Last serviced</dt><dd>{formatMaintenanceDate(device.lastServiced) || "Not recorded"}</dd></div>
                <div><dt>Next due</dt><dd>{formatMaintenanceDate(device.nextDue) || "Not scheduled"}</dd></div>
              </dl>
            </section>
            <section className="ticket-detail-card">
              <h2>Maintenance history</h2>
              {device.history.length ? (
                <ul className="device-history-list">
                  {device.history.map((entry, index) => (
                    <li key={`${entry.doneAt}-${index}`}>
                      <strong>{formatDate(entry.doneAt)}</strong>
                      <span>Completed by {entry.doneBy}</span>
                      {entry.checklist.length > 0 && (
                        <span>Completed: {entry.checklist.join(" · ")}</span>
                      )}
                      {entry.notes && <p>{entry.notes}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No maintenance records yet.</p>}
            </section>
            <section className="ticket-detail-card">
              <h2>Linked tickets</h2>
              {device.tickets.length ? (
                <ul className="device-ticket-list">
                  {device.tickets.map((ticket) => (
                    <li key={ticket.ticketNo}>
                      <Link to={`/staff/tickets/${ticket.ticketNo}`}>{ticket.ticketNo} · {ticket.summary}</Link>
                      <span className={`staff-status-badge status-${ticket.status.toLowerCase().replace(/\s+/g, "-")}`}>{ticket.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No tickets are linked to this device.</p>}
            </section>
          </div>
        </>
      )}
    </StaffLayout>
  );
}

function MaintenanceProcess({ activeStep, message }) {
  const steps = [
    { label: "1 Plans", href: "/staff/maintenance-plans" },
    { label: "2 Schedule", href: "/staff/maintenance-schedule" },
    { label: "3 Record checkup" },
    { label: "4 History and reports" },
  ];
  return (
    <div className="maintenance-process">
      <nav aria-label="Maintenance process steps">
        <strong>Maintenance process</strong>
        {steps.map((step, index) => (
          <span className="maintenance-process-step-wrap" key={step.label}>
            {index > 0 && <span className="maintenance-process-separator">›</span>}
            {step.href ? (
              <Link className={`maintenance-process-step ${step.label === activeStep ? "is-active" : ""}`} to={step.href}>
                {step.label}
              </Link>
            ) : (
              <span className={`maintenance-process-step ${step.label === activeStep ? "is-active" : ""}`}>
                {step.label}
              </span>
            )}
          </span>
        ))}
      </nav>
      {message && <div className="maintenance-process-note">{message}</div>}
    </div>
  );
}

function MaintenanceSchedulePage() {
  const [devices, setDevices] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [type, setType] = useState("All");
  const [departmentId, setDepartmentId] = useState("All");
  const [status, setStatus] = useState("All");
  const [postponeDevice, setPostponeDevice] = useState(null);
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  const [savingPostpone, setSavingPostpone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadDevices() {
    const query = new URLSearchParams();
    if (type !== "All") query.set("type", type);
    if (departmentId !== "All") query.set("departmentId", departmentId);
    if (status !== "All") query.set("status", status);
    const result = await api(`/api/staff/devices/schedule?${query}`);
    setDevices(result.devices);
  }

  useEffect(() => {
    api("/api/staff/devices/lookups")
      .then(({ departments: values }) => setDepartments(values))
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    loadDevices()
      .then(() => setError(""))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [type, departmentId, status]);

  async function savePostpone(event) {
    event.preventDefault();
    if (!postponeDevice) return;
    setSavingPostpone(true);
    setError("");
    setNotice("");
    try {
      const result = await api(`/api/staff/devices/${postponeDevice.id}/postpone`, {
        method: "POST",
        body: jsonBody({ newDate, reason }),
      });
      setNotice(result.message);
      setPostponeDevice(null);
      setNewDate("");
      setReason("");
      await loadDevices();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingPostpone(false);
    }
  }

  return (
    <StaffLayout activePage="Maintenance schedule">
      <MaintenanceProcess
        activeStep="2 Schedule"
        message="This to-do list is made from the maintenance plans. Record a checkup after servicing a device, or postpone it if the employee needs more time."
      />
      <div className="page-heading maintenance-heading">
        <div>
          <h1>Maintenance schedule</h1>
          <p className="muted">Each active device shows its last check, next due date, and maintenance interval.</p>
        </div>
        <Link className="button button-secondary" to="/staff/maintenance-plans">Manage plans</Link>
      </div>
      <div className="maintenance-legend" aria-label="Maintenance status legend">
        <span><strong className="maintenance-status status-overdue">Overdue</strong> past the due date</span>
        <span><strong className="maintenance-status status-due-soon">Due soon</strong> within 7 days</span>
        <span><strong className="maintenance-status status-on-schedule">On schedule</strong> nothing needed yet</span>
        <span><strong className="maintenance-status status-postponed">Postponed</strong> moved to a later date</span>
      </div>
      <div className="maintenance-filters">
        <label>
          Device type
          <select onChange={(event) => setType(event.target.value)} value={type}>
            <option value="All">All devices</option>
            <option value="PC">PCs</option>
            <option value="Printer">Printers</option>
          </select>
        </label>
        <label>
          Department
          <select onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
            <option value="All">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="All">All statuses</option>
            {["Overdue", "Due soon", "Postponed", "On schedule"].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <FormError message={error} />
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="table-wrap maintenance-schedule-table-wrap">
        <table className="accounts-table maintenance-schedule-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Type</th>
              <th>Department</th>
              <th>Frequency</th>
              <th>Last serviced</th>
              <th>Next due</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id}>
                <td><Link to={`/staff/devices/${device.id}`}>{device.assetTag}</Link></td>
                <td>{device.type}</td>
                <td>{device.department || "—"}</td>
                <td>{device.intervalValue ? `Every ${device.intervalValue} ${device.intervalUnit}${device.intervalValue === 1 ? "" : "s"}` : "No plan"}</td>
                <td>{formatMaintenanceDate(device.lastServiced) || "Not recorded"}</td>
                <td>
                  {formatMaintenanceDate(device.nextDue) || "Not scheduled"}
                  {device.postponedUntil && device.maintenanceStatus === "Postponed" && (
                    <small className="maintenance-original-date">Postponed</small>
                  )}
                </td>
                <td>
                  <span className={`maintenance-status status-${device.maintenanceStatus.toLowerCase().replace(/\s+/g, "-")}`}>
                    {device.maintenanceStatus}
                  </span>
                  {device.postponeReason && device.maintenanceStatus === "Postponed" && (
                    <small className="maintenance-reason">{device.postponeReason}</small>
                  )}
                </td>
                <td className="maintenance-row-actions">
                  <Link to={`/staff/devices/${device.id}/checkup`}>Record checkup</Link>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPostponeDevice(device);
                      setNewDate("");
                      setReason("");
                    }}
                    type="button"
                  >
                    Postpone
                  </button>
                </td>
              </tr>
            ))}
            {!loading && devices.length === 0 && (
              <tr><td className="empty-cell" colSpan={8}>No active devices match these filters.</td></tr>
            )}
            {loading && <tr><td className="empty-cell" colSpan={8}>Loading maintenance schedule...</td></tr>}
          </tbody>
        </table>
      </div>
      {postponeDevice && (
        <div className="maintenance-modal-backdrop" role="presentation">
          <section aria-labelledby="postpone-title" aria-modal="true" className="maintenance-modal" role="dialog">
            <h2 id="postpone-title">Postpone maintenance · {postponeDevice.assetTag}</h2>
            <p className="muted">Current due date: {formatMaintenanceDate(postponeDevice.nextDue) || "Not scheduled"}</p>
            <form onSubmit={savePostpone}>
              <label>
                New due date
                <input
                  min={postponeDevice.nextDue > new Date().toISOString().slice(0, 10)
                    ? new Date(new Date(`${postponeDevice.nextDue}T00:00:00`).getTime() + 86400000).toISOString().slice(0, 10)
                    : new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  onChange={(event) => setNewDate(event.target.value)}
                  required
                  type="date"
                  value={newDate}
                />
              </label>
              <label>
                Reason
                <textarea
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why does this checkup need to move?"
                  required
                  rows={4}
                  value={reason}
                />
              </label>
              <div className="form-actions">
                <button className="button button-secondary" onClick={() => setPostponeDevice(null)} type="button">Cancel</button>
                <button className="button button-primary" disabled={savingPostpone}>
                  {savingPostpone ? "Saving..." : "Save postponement"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </StaffLayout>
  );
}

function RecordCheckupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [completedItems, setCompletedItems] = useState([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/api/staff/devices/${encodeURIComponent(id)}/checkup`)
      .then(({ device: result }) => setDevice(result))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [id]);

  function toggleChecklistItem(item) {
    setCompletedItems((current) => (
      current.includes(item)
        ? current.filter((value) => value !== item)
        : [...current, item]
    ));
  }

  async function saveCheckup(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api(`/api/staff/devices/${encodeURIComponent(id)}/checkup`, {
        method: "POST",
        body: jsonBody({ completedItems, notes }),
      });
      navigate(`/staff/devices/${id}`, {
        state: { notice: "Checkup recorded. Maintenance dates updated and any postponement cleared." },
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <StaffLayout activePage="Maintenance schedule">
      <MaintenanceProcess
        activeStep="3 Record checkup"
        message="Tick the checklist items completed, add notes if needed, and save. Today becomes the last serviced date and the next due date is recalculated."
      />
      <Link className="back-link" to="/staff/maintenance-schedule">‹ Maintenance schedule</Link>
      {loading ? <p className="muted">Loading checkup...</p> : !device ? (
        <FormError message={error || "Device could not be loaded."} />
      ) : (
        <>
          <h1>Record checkup · {device.assetTag} {device.brand} {device.model}</h1>
          <p className="muted maintenance-checkup-subtitle">
            {device.department || "No department"} · {device.plan.name} · Every {device.plan.intervalValue} {device.plan.intervalUnit}{device.plan.intervalValue === 1 ? "" : "s"}
          </p>
          <FormError message={error} />
          <div className="maintenance-checkup-grid">
            <form className="ticket-detail-card maintenance-checkup-form" onSubmit={saveCheckup}>
              <h2>Checklist</h2>
              <div className="maintenance-checklist">
                {device.plan.checklist.map((item) => (
                  <label className="maintenance-checklist-item" key={item}>
                    <input
                      checked={completedItems.includes(item)}
                      onChange={() => toggleChecklistItem(item)}
                      type="checkbox"
                    />
                    <span>{item}</span>
                  </label>
                ))}
                {device.plan.checklist.length === 0 && (
                  <p className="muted">This plan has no checklist items. You can still record the checkup.</p>
                )}
              </div>
              <label>
                Notes
                <textarea
                  maxLength={10000}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Anything found during service?"
                  rows={4}
                  value={notes}
                />
              </label>
              <button className="button button-primary" disabled={saving}>
                {saving ? "Saving..." : "Save checkup"}
              </button>
            </form>
            <aside className="maintenance-checkup-aside">
              <section className="ticket-detail-card">
                <h2>Device</h2>
                <dl className="device-date-list">
                  <div><dt>Serial number</dt><dd>{device.serialNo || "—"}</dd></div>
                  <div><dt>Last serviced</dt><dd>{formatMaintenanceDate(device.lastServiced) || "Not recorded"}</dd></div>
                  <div><dt>Due</dt><dd>{formatMaintenanceDate(device.nextDue) || "Not scheduled"}</dd></div>
                  <div><dt>Verification</dt><dd>{device.verification}</dd></div>
                </dl>
              </section>
              <section className="ticket-detail-card">
                <h2>After saving</h2>
                <dl className="device-date-list">
                  <div><dt>Last serviced</dt><dd>Today</dd></div>
                  <div><dt>Next due</dt><dd>{formatMaintenanceDate(device.afterNextDue)} <span className="automatic-badge">Automatic</span></dd></div>
                </dl>
                {device.verification === "Needs IT check" && (
                  <p className="muted maintenance-verification-note">This first checkup will also mark the device Verified.</p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </StaffLayout>
  );
}

function MaintenancePlansPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/staff/maintenance-plans")
      .then(({ plans: values }) => setPlans(values))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StaffLayout activePage="Maintenance plans">
      <div className="page-heading">
        <div>
          <h1>Maintenance Plans</h1>
          <p className="muted">Set how often each device type is serviced and what to check.</p>
        </div>
        {user.role === "admin" && (
          <Link className="button button-primary" to="/staff/maintenance-plans/new">+ New plan</Link>
        )}
      </div>
      {location.state?.notice && <div className="notice" role="status">{location.state.notice}</div>}
      <div className="device-plan-page-grid">
        <div className="table-wrap">
          <table className="accounts-table maintenance-plan-table">
            <thead>
              <tr><th>Plan</th><th>Applies to</th><th>Frequency</th><th>Checklist</th><th>Devices</th>{user.role === "admin" && <th>Action</th>}</tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>{plan.deviceType === "PC" ? "PCs" : "Printers"}</td>
                  <td>Every {plan.intervalValue} {plan.intervalUnit}{plan.intervalValue === 1 ? "" : "s"}</td>
                  <td>{plan.checklist.join(" · ")}</td>
                  <td>{plan.deviceCount}</td>
                  {user.role === "admin" && (
                    <td><Link to={`/staff/maintenance-plans/new?type=${encodeURIComponent(plan.deviceType)}`}>Edit</Link></td>
                  )}
                </tr>
              ))}
              {!loading && plans.length === 0 && (
                <tr><td className="empty-cell" colSpan={user.role === "admin" ? 6 : 5}>No maintenance plans configured.</td></tr>
              )}
              {loading && <tr><td className="empty-cell" colSpan={user.role === "admin" ? 6 : 5}>Loading plans...</td></tr>}
            </tbody>
          </table>
        </div>
        <aside className="ticket-detail-card plan-info-card">
          <h2>How due dates work</h2>
          <p>New devices receive their type's plan automatically.</p>
          <p>Next due is the last serviced date plus the plan interval, or today plus the interval if no date is entered.</p>
          <p>Changing a plan applies to future device due dates.</p>
        </aside>
      </div>
    </StaffLayout>
  );
}

function MaintenancePlanEditorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const editingType = searchParams.get("type") || "";
  const [form, setForm] = useState({
    name: "",
    deviceType: editingType === "Printer" ? "Printer" : "PC",
    intervalValue: "1",
    intervalUnit: "month",
    checklist: [""],
  });
  const [loading, setLoading] = useState(Boolean(editingType));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editingType) return;
    api("/api/staff/maintenance-plans")
      .then(({ plans }) => {
        const plan = plans.find((item) => item.deviceType === editingType);
        if (!plan) {
          setError("That maintenance plan could not be found.");
          return;
        }
        setForm({
          name: plan.name,
          deviceType: plan.deviceType,
          intervalValue: String(plan.intervalValue),
          intervalUnit: plan.intervalUnit,
          checklist: plan.checklist.length ? plan.checklist : [""],
        });
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [editingType]);

  function updateChecklist(index, value) {
    setForm((current) => ({
      ...current,
      checklist: current.checklist.map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  }

  async function savePlan(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const result = await api(`/api/staff/maintenance-plans/${encodeURIComponent(form.deviceType)}`, {
        method: "PUT",
        body: jsonBody({
          ...form,
          intervalValue: Number(form.intervalValue),
          checklist: form.checklist.map((item) => item.trim()).filter(Boolean),
        }),
      });
      navigate("/staff/maintenance-plans", { state: { notice: result.message } });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (user.role !== "admin") return <Navigate to="/staff/maintenance-plans" replace />;
  if (loading) return <StaffLayout activePage="Maintenance plans"><p className="muted">Loading plan...</p></StaffLayout>;

  return (
    <StaffLayout activePage="Maintenance plans">
      <Link className="back-link" to="/staff/maintenance-plans">‹ Back to Maintenance Plans</Link>
      <h1>{editingType ? "Edit maintenance plan" : "New maintenance plan"}</h1>
      <FormError message={error} />
      <form className="maintenance-plan-editor" onSubmit={savePlan}>
        <div className="maintenance-plan-form-fields">
          <div className="maintenance-plan-top-fields">
            <TextField label="Plan name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} maxLength={120} required />
            <label>
              Applies to
              <select
                onChange={(event) => setForm((current) => ({ ...current, deviceType: event.target.value }))}
                value={form.deviceType}
              >
                <option value="PC">PCs</option>
                <option value="Printer">Printers</option>
              </select>
            </label>
          </div>
          <div className="maintenance-interval-field">
            <label>
              How often
              <span className="maintenance-interval-controls">
                <span>Every</span>
                <input
                  max="3650"
                  min="1"
                  onChange={(event) => setForm((current) => ({ ...current, intervalValue: event.target.value }))}
                  required
                  type="number"
                  value={form.intervalValue}
                />
                <select
                  onChange={(event) => setForm((current) => ({ ...current, intervalUnit: event.target.value }))}
                  value={form.intervalUnit}
                >
                  <option value="day">days</option>
                  <option value="week">weeks</option>
                  <option value="month">months</option>
                </select>
              </span>
            </label>
          </div>
          <fieldset className="maintenance-checklist-field">
            <legend>Checklist: what the technician checks</legend>
            {form.checklist.map((item, index) => (
              <div className="maintenance-checklist-row" key={index}>
                <input
                  aria-label={`Checklist item ${index + 1}`}
                  maxLength={255}
                  onChange={(event) => updateChecklist(index, event.target.value)}
                  required
                  value={item}
                />
                <button
                  className="button button-secondary"
                  disabled={form.checklist.length === 1}
                  onClick={() => setForm((current) => ({
                    ...current,
                    checklist: current.checklist.filter((_, itemIndex) => itemIndex !== index),
                  }))}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() => setForm((current) => ({ ...current, checklist: [...current.checklist, ""] }))}
              type="button"
            >
              + Add checklist item
            </button>
          </fieldset>
        </div>
        <aside className="plan-save-info">
          <h2>After you save</h2>
          <p>Every device of this type uses the saved plan for future due dates.</p>
          <p>Existing devices keep their current due dates.</p>
          <p>Only administrators can create or edit plans.</p>
        </aside>
        <div className="form-actions maintenance-plan-actions">
          <Link className="button button-secondary" to="/staff/maintenance-plans">Cancel</Link>
          <button className="button button-primary" disabled={saving}>
            {saving ? "Saving..." : "Save plan"}
          </button>
        </div>
      </form>
    </StaffLayout>
  );
}

function WalkInTicketPage() {
  const navigate = useNavigate();
  const [identityType, setIdentityType] = useState("employee");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [helpTopic, setHelpTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/staff/tickets/lookups")
      .then(({ technicians: values }) => {
        setTechnicians(values);
        if (values.length) setAssignedTo(String(values[0].id));
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    const query = employeeSearch.trim();
    if (identityType !== "employee" || query.length < 2) {
      setEmployees([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api(`/api/staff/tickets/lookups?query=${encodeURIComponent(query)}`)
        .then(({ employees: values }) => setEmployees(values))
        .catch((requestError) => setError(requestError.message));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [employeeSearch, identityType]);

  useEffect(() => {
    const query = deviceSearch.trim();
    if (query.length < 1) {
      setDevices([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api(`/api/staff/tickets/lookups?query=${encodeURIComponent(query)}`)
        .then(({ devices: values }) => setDevices(values))
        .catch((requestError) => setError(requestError.message));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [deviceSearch]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const result = await api("/api/staff/tickets/walk-in", {
        method: "POST",
        body: jsonBody({
          ...(identityType === "employee"
            ? { requesterUserId: selectedEmployee?.id || "" }
            : { guestName }),
          deviceId: selectedDevice?.id,
          helpTopic,
          summary,
          details,
          priority,
          assignedTo,
        }),
      });
      navigate(`/staff/tickets/${result.ticketNo}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <StaffLayout activePage="Ticket queue">
      <Link className="back-link" to="/staff/tickets">‹ Ticket queue</Link>
      <h1>New walk-in ticket</h1>
      <p className="muted">Record a request received in person.</p>
      <form className="walk-in-form" onSubmit={submit}>
        <div className="walk-in-identity-toggle">
          <button className={identityType === "employee" ? "selected" : ""} onClick={() => setIdentityType("employee")} type="button">Employee</button>
          <button className={identityType === "guest" ? "selected" : ""} onClick={() => setIdentityType("guest")} type="button">Guest</button>
        </div>
        {identityType === "employee" ? (
          <section>
            <label>
              Search employee by name, username, or email
              <input
                onChange={(event) => {
                  setEmployeeSearch(event.target.value);
                  setSelectedEmployee(null);
                }}
                placeholder="Type at least 2 characters"
                value={employeeSearch}
              />
            </label>
            {selectedEmployee && <p className="selected-lookup">Selected: {selectedEmployee.fullName} · {selectedEmployee.email}</p>}
            <div className="lookup-results">
              {employees.map((employee) => (
                <button key={employee.id} onClick={() => { setSelectedEmployee(employee); setEmployeeSearch(employee.fullName); setEmployees([]); }} type="button">
                  {employee.fullName} · {employee.email}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <TextField label="Guest name" value={guestName} onChange={setGuestName} maxLength={150} required />
        )}
        <section>
          <label>
            Search device by asset tag, brand, or model
            <input
              onChange={(event) => {
                setDeviceSearch(event.target.value);
                setSelectedDevice(null);
              }}
              placeholder="Type to search devices"
              value={deviceSearch}
            />
          </label>
          {selectedDevice && <p className="selected-lookup">Selected: {selectedDevice.assetTag} · {selectedDevice.type}</p>}
          <div className="lookup-results">
            {devices.map((device) => (
              <button key={device.id} onClick={() => { setSelectedDevice(device); setDeviceSearch(device.assetTag); setDevices([]); }} type="button">
                {device.assetTag} · {device.type} {[device.brand, device.model].filter(Boolean).join(" ")}
              </button>
            ))}
          </div>
        </section>
        <label>
          Help topic
          <select onChange={(event) => setHelpTopic(event.target.value)} required value={helpTopic}>
            <option value="">Choose a help topic</option>
            {helpTopicOptions.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
          </select>
        </label>
        <TextField label="Issue summary" value={summary} onChange={setSummary} maxLength={200} required />
        <label>
          Problem details
          <textarea maxLength={10000} onChange={(event) => setDetails(event.target.value)} required rows={5} value={details} />
        </label>
        <label>
          Priority
          <select onChange={(event) => setPriority(event.target.value)} value={priority}>
            {["Urgent", "High", "Normal", "Low"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Assign to technician
          <select onChange={(event) => setAssignedTo(event.target.value)} required value={assignedTo}>
            <option value="">Choose a technician</option>
            {technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.fullName}</option>)}
          </select>
        </label>
        <FormError message={error} />
        <div className="form-actions">
          <button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Create walk-in ticket"}</button>
          <Link className="button button-secondary" to="/staff/tickets">Cancel</Link>
        </div>
      </form>
    </StaffLayout>
  );
}

function AccountPage({ type }) {
  const isEmployee = type === "employees";
  const title = isEmployee ? "Employee Accounts" : "IT Accounts";
  const endpoint = isEmployee ? "/api/accounts/employees" : "/api/accounts/it";
  const [accounts, setAccounts] = useState([]);
  const [departments, setDepartments] = useState(departmentOptionsFallback);
  const [formOpen, setFormOpen] = useState(isEmployee);
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    email: "",
    departmentId: "",
    role: "technician",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAccounts() {
    const [accountResult, departmentResult] = await Promise.all([
      api(endpoint),
      api("/api/accounts/departments"),
    ]);
    setAccounts(accountResult.accounts);
    setDepartments(departmentResult.departments);
  }

  useEffect(() => {
    loadAccounts().catch((requestError) => setError(requestError.message));
  }, [endpoint]);

  function updateForm(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "fullName" && !current.username) {
        next.username = suggestedUsername(value);
      }
      return next;
    });
  }

  async function createAccount(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: jsonBody({
          fullName: form.fullName,
          username: form.username,
          email: form.email,
          departmentId: Number(form.departmentId),
          ...(isEmployee ? {} : { role: form.role }),
        }),
      });
      setNotice(`Temporary password for ${result.account.username}: ${result.temporaryPassword}`);
      setForm({ fullName: "", username: "", email: "", departmentId: "", role: "technician" });
      await loadAccounts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(account) {
    if (!window.confirm(`Reset the password for ${account.fullName}?`)) return;
    setError("");
    setNotice("");
    try {
      const result = await api(`${endpoint}/${account.id}/reset-password`, { method: "POST" });
      setNotice(`Temporary password for ${account.username}: ${result.temporaryPassword}`);
      await loadAccounts();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function setAccountActive(account, active) {
    const action = active ? "enable" : "disable";
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${account.fullName}'s account?`)) return;
    setError("");
    setNotice("");
    try {
      const route = isEmployee ? "employees" : "it";
      const result = await api(`/api/accounts/${route}/${account.id}/status`, {
        method: "PATCH",
        body: jsonBody({ active }),
      });
      setNotice(result.message);
      await loadAccounts();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <StaffLayout activePage={title}>
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            {isEmployee
              ? "IT creates every employee account. There is no sign-up."
              : "Only these accounts can open the IT side. Employee accounts are managed on their own page."}
          </p>
        </div>
        {!isEmployee && (
          <button className="button button-primary" onClick={() => setFormOpen(!formOpen)}>
            {formOpen ? "Close" : "+ Add IT Account"}
          </button>
        )}
      </div>
      <FormError message={error} />
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className={`accounts-grid ${!isEmployee && !formOpen ? "accounts-grid-wide" : ""}`}>
        <div className="table-wrap">
          <table className="accounts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                {isEmployee && <th>Department</th>}
                {!isEmployee && <th>Role</th>}
                <th>Status</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.fullName}</strong>
                    {account.mustChangePassword && <small className="account-subline">Must set a new password</small>}
                  </td>
                  <td>{account.username}</td>
                  {isEmployee && <td>{account.department || "—"}</td>}
                  {!isEmployee && <td><span className={`role-pill role-${account.role}`}>{account.role}</span></td>}
                  <td><span className={`status-pill ${account.active ? "status-active" : "status-disabled"}`}>{account.active ? "Active" : "Disabled"}</span></td>
                  <td>{formatDate(account.lastSignIn)}</td>
                  <td className="table-actions">
                    <button className="text-button" onClick={() => resetPassword(account)}>Reset password</button>
                    <button
                      className={`text-button ${account.active ? "danger-link" : ""}`}
                      onClick={() => setAccountActive(account, !account.active)}
                    >
                      {account.active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td className="empty-cell" colSpan={6}>No accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {(isEmployee || formOpen) && (
          <form className="form-card account-form" onSubmit={createAccount}>
            <h2>{isEmployee ? "Create employee account" : "Create IT account"}</h2>
            <TextField label="Full name" value={form.fullName} onChange={(value) => updateForm("fullName", value)} required />
            <label>
              Department
              <select
                onChange={(event) => updateForm("departmentId", event.target.value)}
                required
                value={form.departmentId}
              >
                <option value="">Choose a department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
            {!isEmployee && (
              <label>
                Role
                <select
                  onChange={(event) => updateForm("role", event.target.value)}
                  value={form.role}
                >
                  <option value="technician">Technician</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            )}
            <TextField label="Username" value={form.username} onChange={(value) => updateForm("username", value)} required />
            <small className="field-hint">Suggested from the full name; you can change it.</small>
            <TextField label="Email" type="email" value={form.email} onChange={(value) => updateForm("email", value)} required />
            <p className="field-hint">A temporary password will be generated. The account holder must change it at first sign-in.</p>
            <button className="button button-primary button-large" disabled={busy}>
              {busy ? "Creating..." : "Create Account"}
            </button>
          </form>
        )}
      </section>
    </StaffLayout>
  );
}

function suggestedUsername(fullName) {
  const parts = fullName.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.replace(/[^a-z0-9._-]/g, "") || "";
  const firstInitial = parts[0].replace(/[^a-z0-9]/g, "").slice(0, 1);
  const surname = parts[parts.length - 1].replace(/[^a-z0-9]/g, "");
  return firstInitial && surname ? `${firstInitial}.${surname}` : "";
}

function formatDate(date) {
  if (!date) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function formatMaintenanceDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
    .format(new Date(`${date}T00:00:00`));
}

function App() {
  const { error, loading } = useAuth();
  if (loading) return <LoadingPage />;

  return (
    <>
      {error && <div className="global-error" role="alert">{error}</div>}
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<SignInPage />} />
        <Route path="/guest/new-ticket" element={<GuestTicketPage />} />
        <Route path="/ticket-status" element={<TicketStatusForm />} />
        <Route path="/ticket-submitted/:ticketNo" element={<TicketSubmittedPage />} />
        <Route
          path="/change-password"
          element={<AuthGate allowPasswordChange><ChangePasswordPage /></AuthGate>}
        />
        <Route
          path="/employee/setup"
          element={<AuthGate roles={["employee"]}><EmployeeSetupPage /></AuthGate>}
        />
        <Route
          path="/employee"
          element={<AuthGate roles={["employee"]}><EmployeeHome /></AuthGate>}
        />
        <Route
          path="/employee/new-request"
          element={<AuthGate roles={["employee"]}><EmployeeNewRequestPage /></AuthGate>}
        />
        <Route
          path="/employee/requests/:ticketNo"
          element={<AuthGate roles={["employee"]}><EmployeeTicketStatusPage /></AuthGate>}
        />
        <Route
          path="/staff"
          element={<AuthGate roles={["technician", "admin"]}><StaffHome /></AuthGate>}
        />
        <Route
          path="/staff/tickets"
          element={<AuthGate roles={["technician", "admin"]}><TicketQueuePage /></AuthGate>}
        />
        <Route
          path="/staff/tickets/walk-in"
          element={<AuthGate roles={["technician", "admin"]}><WalkInTicketPage /></AuthGate>}
        />
        <Route
          path="/staff/tickets/:ticketNo"
          element={<AuthGate roles={["technician", "admin"]}><TicketDetailPage /></AuthGate>}
        />
        <Route
          path="/staff/devices"
          element={<AuthGate roles={["technician", "admin"]}><DeviceListPage /></AuthGate>}
        />
        <Route
          path="/staff/devices/new"
          element={<AuthGate roles={["technician", "admin"]}><DeviceEditorPage /></AuthGate>}
        />
        <Route
          path="/staff/devices/:id/edit"
          element={<AuthGate roles={["technician", "admin"]}><DeviceEditorPage /></AuthGate>}
        />
        <Route
          path="/staff/devices/:id"
          element={<AuthGate roles={["technician", "admin"]}><DeviceDetailPage /></AuthGate>}
        />
        <Route
          path="/staff/devices/:id/checkup"
          element={<AuthGate roles={["technician", "admin"]}><RecordCheckupPage /></AuthGate>}
        />
        <Route
          path="/staff/maintenance-schedule"
          element={<AuthGate roles={["technician", "admin"]}><MaintenanceSchedulePage /></AuthGate>}
        />
        <Route
          path="/staff/maintenance-plans"
          element={<AuthGate roles={["technician", "admin"]}><MaintenancePlansPage /></AuthGate>}
        />
        <Route
          path="/staff/maintenance-plans/new"
          element={<AuthGate roles={["admin"]}><MaintenancePlanEditorPage /></AuthGate>}
        />
        <Route
          path="/staff/accounts/employees"
          element={<AuthGate roles={["admin"]}><AccountPage type="employees" /></AuthGate>}
        />
        <Route
          path="/staff/accounts/it"
          element={<AuthGate roles={["admin"]}><AccountPage type="it" /></AuthGate>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function AppWithAuth() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
