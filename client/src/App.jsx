import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import ErrorBoundary from "./ErrorBoundary.jsx";
import Modal from "./Modal.jsx";
import { formatNotificationTime } from "./notification-time.js";

const AuthContext = createContext(null);

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
  const { user } = useAuth();

  return (
    <header className="public-header">
      <Link to="/" className="brand-link" aria-label="BMC IT Support home">
        <Brand />
      </Link>
      {user ? (
        <ErrorBoundary message="Profile tools could not be displayed.">
          <ProfileMenu />
        </ErrorBoundary>
      ) : (
        <span className="account-link">
          Guest User | <Link to="/login">Sign in</Link>
        </span>
      )}
    </header>
  );
}

function Avatar({ user, className = "" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarPath = typeof user?.avatarPath === "string" ? user.avatarPath : "";
  useEffect(() => setImageFailed(false), [avatarPath]);
  return (
    <span className={`profile-avatar ${className}`} aria-hidden="true">
      {avatarPath && !imageFailed ? (
        <img src={avatarPath} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <svg viewBox="0 0 40 40" focusable="false">
          <circle cx="20" cy="20" r="19" fill="#fff" stroke="currentColor" strokeWidth="2" />
          <circle cx="20" cy="14" r="6" fill="currentColor" />
          <path d="M8 33c1.7-6.1 6-9.2 12-9.2s10.3 3.1 12 9.2" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

function ProfileMenu() {
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const notificationTriggerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationTab, setNotificationTab] = useState("unread");
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingMoreNotifications, setLoadingMoreNotifications] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationActionsOpen, setNotificationActionsOpen] = useState(false);
  const [notificationPanelPosition, setNotificationPanelPosition] = useState(null);
  const [unavailableNotificationMessage, setUnavailableNotificationMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notificationError, setNotificationError] = useState("");

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const limit = notificationTab === "all" ? 10 : 50;
      const result = await api(
        `/api/notifications?unread=${notificationTab === "unread"}&limit=${limit}&offset=0`,
      );
      setNotifications(Array.isArray(result.notifications) ? result.notifications : []);
      setUnreadCount(Number.isFinite(Number(result.unreadCount)) ? Number(result.unreadCount) : 0);
      setHasMoreNotifications(result.hasMore === true);
      setNotificationError("");
    } catch (requestError) {
      setNotificationError("Could not load notifications. Try again.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [notificationTab]);

  useEffect(() => {
    if (user.mustChangePassword) return undefined;
    refreshNotifications();
    const intervalId = window.setInterval(refreshNotifications, 30000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [user.mustChangePassword, refreshNotifications]);

  useEffect(() => {
    if (!open && !notificationsOpen) return undefined;
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setOpen(false);
        setNotificationsOpen(false);
        setNotificationActionsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setNotificationsOpen(false);
        setNotificationActionsOpen(false);
        (notificationsOpen ? notificationTriggerRef : triggerRef).current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, notificationsOpen]);

  async function changePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Profile photos must be 2 MB or smaller.");
      return;
    }
    const body = new FormData();
    body.append("avatar", file);
    setUploading(true);
    try {
      const result = await api("/api/auth/avatar", { method: "POST", body });
      setUser((current) => ({ ...current, avatarPath: result.avatarPath }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSignOut() {
    setError("");
    try {
      await signOut();
      window.location.replace("/");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function openNotification(notification) {
    setUnavailableNotificationMessage("");
    try {
      const notificationId = Number(notification?.id);
      const canMarkRead = Number.isSafeInteger(notificationId) && notificationId > 0;
      if (!notification?.isRead && canMarkRead) {
        await api(`/api/notifications/${notificationId}/read`, { method: "PATCH" });
        setNotifications((current) => current.map((item) => (
          item?.id === notificationId ? { ...item, isRead: true } : item
        )).filter((item) => notificationTab !== "unread" || item?.id !== notificationId));
        setUnreadCount((current) => Math.max(0, current - 1));
      }
      setNotificationsOpen(false);
      if (typeof notification?.ticketNo !== "string" || !notification.ticketNo.trim()) {
        setUnavailableNotificationMessage("This ticket is no longer available.");
        setNotificationsOpen(true);
        return;
      }
      navigate(user.role === "employee"
        ? `/employee/requests/${encodeURIComponent(notification.ticketNo)}`
        : `/staff/tickets/${encodeURIComponent(notification.ticketNo)}`);
    } catch (requestError) {
      setNotificationError("Could not load notifications. Try again.");
    }
  }

  async function markAllNotificationsRead() {
    try {
      await api("/api/notifications/read-all", { method: "PATCH" });
      if (notificationTab === "unread") {
        setNotifications([]);
        setHasMoreNotifications(false);
      } else {
        setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
      }
      setUnreadCount(0);
      setNotificationActionsOpen(false);
      setNotificationError("");
    } catch (requestError) {
      setNotificationError("Could not load notifications. Try again.");
    }
  }

  async function clearReadNotifications() {
    try {
      await api("/api/notifications/read", { method: "DELETE" });
      setNotificationActionsOpen(false);
      await refreshNotifications();
    } catch (requestError) {
      setNotificationError("Could not load notifications. Try again.");
    }
  }

  async function loadMoreNotifications() {
    setLoadingMoreNotifications(true);
    setNotificationError("");
    try {
      const result = await api(
        `/api/notifications?unread=false&limit=10&offset=${notifications.length}`,
      );
      const page = Array.isArray(result.notifications) ? result.notifications : [];
      setNotifications((current) => [...current, ...page]);
      setHasMoreNotifications(result.hasMore === true);
    } catch (requestError) {
      setNotificationError("Could not load notifications. Try again.");
    } finally {
      setLoadingMoreNotifications(false);
    }
  }

  function selectNotificationTab(tab) {
    if (tab === notificationTab) return;
    setNotificationTab(tab);
    setNotifications([]);
    setHasMoreNotifications(false);
    setNotificationError("");
  }

  function handleNotificationTabKeyDown(event) {
    const tabs = Array.from(event.currentTarget.parentElement.querySelectorAll('[role="tab"]'));
    const currentIndex = tabs.indexOf(event.currentTarget);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex !== currentIndex) {
      event.preventDefault();
      tabs[nextIndex].focus();
      selectNotificationTab(nextIndex === 0 ? "unread" : "all");
    }
  }

  function toggleNotifications() {
    setOpen(false);
    if (notificationsOpen) {
      setNotificationActionsOpen(false);
    } else {
      const bounds = notificationTriggerRef.current?.getBoundingClientRect();
      if (bounds) {
        const panelWidth = Math.min(460, window.innerWidth - 24);
        setNotificationPanelPosition({
          top: Math.round(bounds.bottom + 8),
          right: Math.max(
            12,
            Math.min(
              Math.round(window.innerWidth - bounds.right),
              Math.round(window.innerWidth - panelWidth - 12),
            ),
          ),
        });
      }
      refreshNotifications();
    }
    setNotificationsOpen((current) => !current);
  }

  const roleLabel = user.role === "admin" ? "Admin"
    : user.role === "technician" ? "IT Staff" : "Employee";
  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        aria-controls="notification-panel"
        aria-expanded={notificationsOpen}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="notification-button"
        onClick={toggleNotifications}
        ref={notificationTriggerRef}
        type="button"
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      <button
        className="profile-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setNotificationsOpen(false);
          setNotificationActionsOpen(false);
          setOpen((current) => !current);
        }}
        ref={triggerRef}
      >
        <Avatar user={user} />
        <span className="profile-trigger-name">{user.fullName}</span>
        <span className={`profile-role-badge role-${user.role}`}>{roleLabel}</span>
        <svg className="profile-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="m3 6 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <section className="profile-dropdown" aria-label="Profile menu">
          <div className="profile-dropdown-heading">
            <Avatar user={user} className="profile-dropdown-avatar" />
            <div className="profile-dropdown-identity">
              <strong>{user.fullName}</strong>
              <span>@{user.username}</span>
              <span>{user.department || "No department"}</span>
              <span>{user.email}</span>
            </div>
          </div>
          {error && <p className="profile-menu-error" role="alert">{error}</p>}
          <input
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            onChange={changePhoto}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="profile-menu-action"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {uploading ? "Uploading photo..." : "Change photo"}
          </button>
          <Link className="profile-menu-action" onClick={() => setOpen(false)} to="/change-password">
            Change password
          </Link>
          <button className="profile-menu-action profile-menu-signout" onClick={handleSignOut} type="button">
            Sign out
          </button>
        </section>
      )}
      {notificationsOpen && (
        <ErrorBoundary message="Notifications could not be displayed.">
          <NotificationPanel
            clearReadNotifications={clearReadNotifications}
            error={notificationError}
            hasMore={hasMoreNotifications}
            loading={notificationsLoading}
            loadingMore={loadingMoreNotifications}
            markAllRead={markAllNotificationsRead}
            moreOpen={notificationActionsOpen}
            notifications={notifications}
            onItemClick={openNotification}
            onLoadMore={loadMoreNotifications}
            onMoreToggle={() => setNotificationActionsOpen((current) => !current)}
            onRetry={refreshNotifications}
            onTabKeyDown={handleNotificationTabKeyDown}
            onTabSelect={selectNotificationTab}
            position={notificationPanelPosition}
            tab={notificationTab}
            unavailableMessage={unavailableNotificationMessage}
            unreadCount={unreadCount}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

function NotificationPanel({
  clearReadNotifications,
  error,
  hasMore,
  loading,
  loadingMore,
  markAllRead,
  moreOpen,
  notifications,
  onItemClick,
  onLoadMore,
  onMoreToggle,
  onRetry,
  onTabKeyDown,
  onTabSelect,
  position,
  tab,
  unavailableMessage,
  unreadCount,
}) {
  const style = position
    ? { top: `${position.top}px`, right: `${position.right}px` }
    : undefined;
  return (
    <section
      className="notification-panel"
      id="notification-panel"
      aria-label="Notifications"
      style={style}
    >
      <div className="notification-panel-heading">
        <strong>Notification</strong>
        <div className="notification-panel-actions">
          <button
            className="notification-mark-read-link"
            disabled={unreadCount === 0}
            onClick={markAllRead}
            type="button"
          >
            Mark all as read
          </button>
          <div className="notification-more-wrap">
            <button
              aria-expanded={moreOpen}
              aria-label="More notification actions"
              className="notification-more-button"
              onClick={onMoreToggle}
              type="button"
            >
              <span aria-hidden="true">···</span>
            </button>
            {moreOpen && (
              <div className="notification-more-menu" role="group" aria-label="More notification actions">
                <button disabled={unreadCount === 0} onClick={markAllRead} type="button">
                  Mark all as read
                </button>
                <button onClick={clearReadNotifications} type="button">
                  Clear read notifications
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="notification-tabs" role="tablist" aria-label="Notification filter">
        <button
          aria-selected={tab === "unread"}
          className={tab === "unread" ? "notification-tab-active" : ""}
          onClick={() => onTabSelect("unread")}
          onKeyDown={onTabKeyDown}
          role="tab"
          type="button"
        >
          Unread ({unreadCount})
        </button>
        <button
          aria-selected={tab === "all"}
          className={tab === "all" ? "notification-tab-active" : ""}
          onClick={() => onTabSelect("all")}
          onKeyDown={onTabKeyDown}
          role="tab"
          type="button"
        >
          All
        </button>
      </div>
      {unavailableMessage && <p className="profile-menu-error" role="alert">{unavailableMessage}</p>}
      {error ? (
        <div className="notification-load-error" role="alert">
          <p>Could not load notifications. Try again.</p>
          <button className="notification-retry-button" onClick={onRetry} type="button">Retry</button>
        </div>
      ) : loading && notifications.length === 0 ? (
        <p className="notification-empty">Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <p className="notification-empty">No notifications</p>
      ) : (
        <>
          <ul className="notification-list">
            {notifications.map((notification, index) => {
              const time = formatNotificationTime(notification?.createdAt);
              const ticketNo = typeof notification?.ticketNo === "string" ? notification.ticketNo : "";
              const actorName = typeof notification?.actorName === "string" && notification.actorName.trim()
                ? notification.actorName
                : "System";
              const actorDepartment = typeof notification?.actorDepartment === "string"
                ? notification.actorDepartment.trim()
                : "";
              const actorMeta = notification?.actorType === "guest"
                ? `Guest - ${actorName}`
                : notification?.actorType === "system"
                  ? "System"
                  : [actorDepartment, actorName].filter(Boolean).join(" - ") || "System";
              return (
                <li key={notification?.id ?? `${ticketNo}-${index}`}>
                  <button
                    className={`notification-item ${notification?.isRead ? "" : "notification-unread"}`}
                    onClick={() => onItemClick(notification || {})}
                    type="button"
                  >
                    <Avatar
                      className="notification-avatar"
                      user={{ avatarPath: notification?.actorAvatarPath }}
                    />
                    <span className="notification-item-content">
                      <strong>{notification?.title || "Notification"}</strong>
                      <span className="notification-item-message">
                        {notification?.message || ticketNo || "Ticket details unavailable"}
                      </span>
                      <span className="notification-item-meta">
                        <time dateTime={time.full ? notification.createdAt : undefined} title={time.full || undefined}>
                          {time.relative}
                        </time>
                        <span aria-hidden="true">·</span>
                        <span>{actorMeta}</span>
                      </span>
                    </span>
                    {!notification?.isRead && <span className="notification-unread-dot" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {tab === "all" && hasMore && (
            <button className="notification-load-more" disabled={loadingMore} onClick={onLoadMore} type="button">
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
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
          <Link to="/" aria-label="BMC IT Support home">
            <img src="/bmc-logo.png" alt="" />
          </Link>
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
        <div><dt>IT staff</dt><dd>{ticket.technician}</dd></div>
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
  const { user } = useAuth();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState({});
  const navigation = [
    { label: "Dashboard", href: "/staff", active: activePage === "Dashboard" },
    {
      label: "Ticket queue",
      active: location.pathname.startsWith("/staff/tickets"),
      children: [
        { label: "Ticket queue", href: "/staff/tickets", active: !location.pathname.includes("/walk-in") },
        { label: "New walk-in ticket", href: "/staff/tickets/walk-in", active: location.pathname.includes("/walk-in") },
      ],
    },
    { label: "Devices", href: "/staff/devices", active: activePage === "Devices" },
    {
      label: "Maintenance schedule",
      active: activePage === "Maintenance schedule" || activePage === "Maintenance plans",
      children: [
        { label: "Maintenance schedule", href: "/staff/maintenance-schedule", active: activePage === "Maintenance schedule" },
        { label: "Maintenance plans", href: "/staff/maintenance-plans", active: activePage === "Maintenance plans" },
      ],
    },
    { label: "Reports", href: "/staff/reports", active: activePage === "Reports" },
    ...(user.role === "admin"
      ? [{
          label: "Accounts",
          active: activePage === "Employee Accounts" || activePage === "IT Accounts",
          children: [
            { label: "Employee accounts", href: "/staff/accounts/employees", active: activePage === "Employee Accounts" },
            { label: "IT accounts", href: "/staff/accounts/it", active: activePage === "IT Accounts" },
          ],
        }]
      : []),
  ];

  useEffect(() => {
    setOpenGroups((current) => {
      const activeGroup = navigation.find((item) => item.children && item.active);
      if (!activeGroup || current[activeGroup.label] === true) return current;
      return { ...current, [activeGroup.label]: true };
    });
  }, [location.pathname]);

  return (
    <div className="staff-layout">
      <aside className="staff-sidebar">
        <Link to="/staff" className="sidebar-brand" aria-label="IT Service Desk home">
          <Brand compact />
        </Link>
        <nav aria-label="IT staff navigation">
          {navigation.map((item) => (
            <div className="sidebar-nav-item" key={item.label}>
              {item.href ? (
                <Link
                  className={`sidebar-link ${item.active ? "is-active" : ""}`}
                  to={item.href}
                >
                  {item.label}
                </Link>
              ) : (
                <div className={`sidebar-dropdown ${openGroups[item.label] ?? item.active ? "sidebar-group-open" : ""}`}>
                  <button
                    aria-expanded={openGroups[item.label] ?? item.active}
                    className={`sidebar-link sidebar-dropdown-button ${item.active ? "is-active" : ""}`}
                    onClick={() => setOpenGroups((current) => ({
                      ...current,
                      [item.label]: !(current[item.label] ?? item.active),
                    }))}
                    type="button"
                  >
                    {item.label}
                    <span className="sidebar-dropdown-chevron" aria-hidden="true">
                      {(openGroups[item.label] ?? item.active) ? "⌃" : "⌄"}
                    </span>
                  </button>
                  {(openGroups[item.label] ?? item.active) && (
                    <div className="sidebar-submenu">
                      {item.children.map((child) => (
                        <Link
                          aria-current={child.active ? "page" : undefined}
                          className={`sidebar-submenu-link ${child.active ? "is-active" : ""}`}
                          key={child.href}
                          to={child.href}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <main className="staff-main">
        <div className="staff-topbar">
          <ErrorBoundary message="Profile tools could not be displayed.">
            <ProfileMenu />
          </ErrorBoundary>
        </div>
        <div className="staff-content">{children}</div>
      </main>
    </div>
  );
}

function StaffHome() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/staff/dashboard")
      .then(setDashboard)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StaffLayout activePage="Dashboard">
      <div className="page-heading dashboard-heading">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Current ticket and maintenance overview.</p>
        </div>
      </div>
      <FormError message={error} />
      {loading ? <p className="muted">Loading dashboard...</p> : dashboard && (
        <>
          <div className="dashboard-metrics">
            <MetricCard label="Open tickets" value={dashboard.metrics.openTickets} />
            <MetricCard label="Resolved this week" value={dashboard.metrics.resolvedThisWeek} />
            <MetricCard label="Overdue maintenance" value={dashboard.metrics.overdueMaintenance} tone="danger" />
            <MetricCard label="Maintenance due this week" value={dashboard.metrics.maintenanceDueThisWeek} />
            <MetricCard label="Devices on schedule" value={`${dashboard.metrics.onSchedulePercent}%`} tone="success" />
          </div>
          <div className="dashboard-panels">
            <section className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <h2>Recent tickets</h2>
                <Link to="/staff/tickets">View queue</Link>
              </div>
              {dashboard.recentTickets.length ? (
                <ul className="dashboard-list">
                  {dashboard.recentTickets.map((ticket) => (
                    <li key={ticket.ticketNo}>
                      <div>
                        <Link className="dashboard-list-title" to={`/staff/tickets/${ticket.ticketNo}`}>
                          {ticket.ticketNo} · {ticket.summary}
                        </Link>
                        <span className="dashboard-list-meta">
                          {[ticket.department, ticket.source, ticket.requesterName].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <span className={`staff-status-badge status-${ticket.status.toLowerCase().replace(/\s+/g, "-")}`}>
                        {ticket.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No tickets have been submitted yet.</p>}
            </section>
            <section className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <h2>Maintenance needing attention</h2>
                <Link to="/staff/maintenance-schedule">View schedule</Link>
              </div>
              {dashboard.maintenanceAttention.length ? (
                <ul className="dashboard-list">
                  {dashboard.maintenanceAttention.map((device) => (
                    <li key={device.id}>
                      <div>
                        <Link className="dashboard-list-title" to={`/staff/devices/${device.id}`}>
                          {device.assetTag} · {device.department || device.type}
                        </Link>
                        <span className="dashboard-list-meta">
                          {device.planName || `${device.intervalValue || ""} ${device.intervalUnit || ""}`.trim()}
                          {device.lastServiced ? ` · Last serviced ${device.lastServiced}` : ""}
                        </span>
                      </div>
                      <span className={`maintenance-status status-${device.status.toLowerCase().replace(/\s+/g, "-")}`}>
                        {device.status === "Overdue"
                          ? `Overdue ${Math.abs(device.daysToDue)} day${Math.abs(device.daysToDue) === 1 ? "" : "s"}`
                          : device.daysToDue === 0 ? "Due today"
                            : device.daysToDue === 1 ? "Due tomorrow"
                              : `Due in ${device.daysToDue} days`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No overdue or due-soon maintenance.</p>}
            </section>
          </div>
        </>
      )}
    </StaffLayout>
  );
}

function MetricCard({ label, value, tone = "" }) {
  return (
    <section className={`dashboard-metric ${tone ? `is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function formatResolutionMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "No resolved tickets";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (!hours) return `${remainingMinutes} min`;
  if (!remainingMinutes) return `${hours} hr`;
  return `${hours} hr ${remainingMinutes} min`;
}

function ReportBarList({ title, items, emptyMessage }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className="report-chart-card">
      <h2>{title}</h2>
      {items.length ? (
        <ul className="report-bar-list">
          {items.map((item) => (
            <li key={item.name}>
              <span className="report-bar-label">{item.name}</span>
              <span
                className="report-bar-track"
                role="meter"
                aria-label={`${item.name}: ${item.count}`}
                aria-valuemin="0"
                aria-valuemax={max}
                aria-valuenow={item.count}
              >
                <span className="report-bar" style={{ width: `${Math.max(2, (item.count / max) * 100)}%` }} />
              </span>
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
      ) : <p className="muted">{emptyMessage}</p>}
    </section>
  );
}

function ReportsPage() {
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [departmentId, setDepartmentId] = useState("All");
  const [departments, setDepartments] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    api("/api/staff/reports/lookups")
      .then(({ departments: values }) => setDepartments(values))
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams({ month });
    if (departmentId !== "All") query.set("departmentId", departmentId);
    setLoading(true);
    api(`/api/staff/reports?${query}`)
      .then((result) => {
        setReport(result);
        setError("");
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [month, departmentId]);

  const exportQuery = new URLSearchParams({ month });
  if (departmentId !== "All") exportQuery.set("departmentId", departmentId);

  async function createBackup() {
    setBackingUp(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/api/staff/backup", { method: "POST" });
      setNotice(`${result.message} Saved as server/backups/${result.filename} (${(result.size / 1024 / 1024).toFixed(2)} MB).`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <StaffLayout activePage="Reports">
      <div className="page-heading reports-heading">
        <div>
          <h1>Reports</h1>
          <p className="muted">Ticket and maintenance activity for a selected month.</p>
        </div>
        <div className="reports-actions">
          {user.role === "admin" && (
            <>
              <a className="button button-outline" href={`/api/staff/reports/tickets.csv?${exportQuery}`}>
                Export tickets (CSV)
              </a>
              <a className="button button-outline" href={`/api/staff/reports/maintenance.csv?${exportQuery}`}>
                Export maintenance (CSV)
              </a>
              <button className="button button-primary" disabled={backingUp} onClick={createBackup} type="button">
                {backingUp ? "Backing up..." : "Back up now"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="reports-filters">
        <label>
          Period
          <input type="month" onChange={(event) => setMonth(event.target.value)} value={month} />
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
      </div>
      <FormError message={error} />
      {notice && <div className="notice" role="status">{notice}</div>}
      {loading ? <p className="muted">Loading report...</p> : report && (
        <>
          <div className="reports-metrics">
            <MetricCard label="Tickets received" value={report.summary.ticketsReceived} />
            <MetricCard label="Tickets resolved" value={report.summary.ticketsResolved} />
            <MetricCard label="Average time to resolve" value={formatResolutionMinutes(report.summary.averageResolutionMinutes)} />
            <MetricCard label="Devices on schedule" value={`${report.summary.onSchedulePercent}%`} tone="success" />
          </div>
          <div className="reports-chart-grid">
            <ReportBarList
              title="Tickets by department"
              items={report.byDepartment}
              emptyMessage="No tickets were received in this period."
            />
            <ReportBarList
              title="Tickets by help topic"
              items={report.byHelpTopic}
              emptyMessage="No tickets were received in this period."
            />
          </div>
        </>
      )}
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
  const [inactiveDepartment, setInactiveDepartment] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setInactiveDepartment(null);
    Promise.all([
      api("/api/staff/devices/lookups"),
      id ? api(`/api/staff/devices/${encodeURIComponent(id)}`) : Promise.resolve(null),
    ])
      .then(([lookupResult, deviceResult]) => {
        setLookups(lookupResult);
        if (deviceResult) {
          const { device } = deviceResult;
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
          const departmentId = device.departmentId ? String(device.departmentId) : "";
          if (departmentId && !lookupResult.departments.some(
            (department) => String(department.id) === departmentId,
          )) {
            setInactiveDepartment({
              id: departmentId,
              name: device.department || "Inactive department",
            });
          }
        }
      })
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
              {inactiveDepartment && (
                <option disabled value={inactiveDepartment.id}>
                  {inactiveDepartment.name} (inactive)
                </option>
              )}
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
        <Link className="button button-primary" to="/staff/maintenance-plans">Manage plans</Link>
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
            <legend>Checklist: what IT staff checks</legend>
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
          Assign to IT staff
          <select onChange={(event) => setAssignedTo(event.target.value)} required value={assignedTo}>
            <option value="">Choose IT staff</option>
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
  const { user, refreshUser } = useAuth();
  const isEmployee = type === "employees";
  const title = isEmployee ? "Employee Accounts" : "IT Accounts";
  const endpoint = isEmployee ? "/api/accounts/employees" : "/api/accounts/it";
  const accountRoute = isEmployee ? "employees" : "it";
  const [accounts, setAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState(null);
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
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const emptyForm = { fullName: "", username: "", email: "", departmentId: "", role: "technician" };

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

  const closeDialog = useCallback(() => {
    setDialog(null);
    setEditingAccount(null);
    setEditForm(null);
    setError("");
    setCopied(false);
  }, []);

  function openCreateDialog() {
    setForm(emptyForm);
    setTemporaryPassword("");
    setError("");
    setNotice("");
    setDialog({ kind: "create" });
  }

  function updateForm(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "fullName" && !current.username) {
        next.username = suggestedUsername(value);
      }
      return next;
    });
  }

  const formIsDirty = dialog?.kind === "create"
    && Object.keys(emptyForm).some((field) => form[field] !== emptyForm[field]);
  const editIsDirty = dialog?.kind === "edit" && editingAccount && editForm
    && (
      editForm.fullName !== editingAccount.fullName
      || editForm.username !== editingAccount.username
      || editForm.email !== editingAccount.email
      || editForm.departmentId !== String(editingAccount.departmentId || "")
      || (!isEmployee && editForm.role !== editingAccount.role)
    );

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
      setTemporaryPassword(result.temporaryPassword);
      setDialog({ kind: "created", username: result.account.username });
      setForm(emptyForm);
      await loadAccounts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function askToResetPassword(account) {
    setError("");
    setNotice("");
    setDialog({ kind: "confirm", action: "reset", account });
  }

  function askToChangeStatus(account, active) {
    setError("");
    setNotice("");
    setDialog({ kind: "confirm", action: active ? "enable" : "disable", account, active });
  }

  async function confirmAccountAction() {
    if (dialog?.kind !== "confirm") return;
    const { account, action, active } = dialog;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (action === "reset") {
        const result = await api(`${endpoint}/${account.id}/reset-password`, { method: "POST" });
        setTemporaryPassword(result.temporaryPassword);
        setDialog({ kind: "password-reset", username: account.username });
        await loadAccounts();
      } else {
        const result = await api(`/api/accounts/${accountRoute}/${account.id}/status`, {
          method: "PATCH",
          body: jsonBody({ active }),
        });
        closeDialog();
        setNotice(result.message);
        await loadAccounts();
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyTemporaryPassword() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch (requestError) {
      setError(`Could not copy the password: ${requestError.message}`);
    }
  }

  function startEditing(account) {
    setEditingAccount(account);
    setEditForm({
      fullName: account.fullName,
      username: account.username,
      email: account.email,
      departmentId: String(account.departmentId || ""),
      role: account.role,
    });
    setError("");
    setNotice("");
    setDialog({ kind: "edit" });
  }

  async function saveAccount(event) {
    event.preventDefault();
    if (!editingAccount || !editForm) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const route = isEmployee ? "employees" : "it";
      const result = await api(`/api/accounts/${route}/${editingAccount.id}`, {
        method: "PATCH",
        body: jsonBody({
          fullName: editForm.fullName,
          username: editForm.username,
          email: editForm.email,
          departmentId: Number(editForm.departmentId),
          ...(isEmployee ? {} : { role: editForm.role }),
        }),
      });
      closeDialog();
      setNotice(result.message);
      loadAccounts().catch((requestError) => setError(requestError.message));
      if (editingAccount.id === user.id) await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
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
        <button className="button button-primary" onClick={openCreateDialog} type="button">
          {isEmployee ? "Create account" : "+ Add IT account"}
        </button>
      </div>
      {!dialog && <FormError message={error} />}
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className="accounts-grid accounts-grid-wide">
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
                <th className="account-actions-heading">Actions</th>
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
                  {!isEmployee && <td><span className={`role-pill role-${account.role}`}>{accountRoleLabel(account.role)}</span></td>}
                  <td><span className={`status-pill ${account.active ? "status-active" : "status-disabled"}`}>{account.active ? "Active" : "Disabled"}</span></td>
                  <td>{formatDate(account.lastSignIn)}</td>
                  <td className="table-actions">
                    <AccountRowActions
                      account={account}
                      currentUser={user}
                      onEdit={() => startEditing(account)}
                      onResetPassword={() => askToResetPassword(account)}
                      onStatusChange={(active) => askToChangeStatus(account, active)}
                    />
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td className="empty-cell" colSpan={6}>No accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {dialog && (
        <Modal
          closeConfirmation="Discard your unsaved account changes?"
          isDirty={Boolean(formIsDirty || editIsDirty)}
          onClose={closeDialog}
          size={dialog.kind === "confirm" ? "small" : "default"}
          title={
            dialog.kind === "create"
              ? `Create ${isEmployee ? "employee" : "IT"} account`
              : dialog.kind === "edit"
                ? `Edit ${isEmployee ? "employee" : "IT"} account`
                : dialog.kind === "confirm"
                  ? "Confirm account action"
                  : dialog.kind === "created"
                    ? "Account created"
                    : dialog.kind === "password-reset"
                      ? "Password reset"
                      : ""
          }
        >
          {(dialog.kind === "create" || dialog.kind === "edit") && (
            <form className="account-modal-form" onSubmit={dialog.kind === "create" ? createAccount : saveAccount}>
              <TextField
                label="Full name"
                value={dialog.kind === "create" ? form.fullName : editForm?.fullName || ""}
                onChange={(value) => {
                  if (dialog.kind === "create") updateForm("fullName", value);
                  else setEditForm((current) => ({ ...current, fullName: value }));
                }}
                required
              />
              <label>
                Department
                <select
                  onChange={(event) => {
                    if (dialog.kind === "create") updateForm("departmentId", event.target.value);
                    else setEditForm((current) => ({ ...current, departmentId: event.target.value }));
                  }}
                  required
                  value={dialog.kind === "create" ? form.departmentId : editForm?.departmentId || ""}
                >
                  <option value="">Choose a department</option>
                  {dialog.kind === "edit"
                    && editingAccount
                    && !departments.some(
                      (department) => String(department.id) === String(editingAccount.departmentId),
                    )
                    && (
                      <option disabled value={editingAccount.departmentId}>
                        {editingAccount.department || "Inactive department"} (inactive)
                      </option>
                    )}
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              {!isEmployee && (
                <label>
                  Role
                  <select
                    onChange={(event) => {
                      if (dialog.kind === "create") updateForm("role", event.target.value);
                      else setEditForm((current) => ({ ...current, role: event.target.value }));
                    }}
                    value={dialog.kind === "create" ? form.role : editForm?.role || "technician"}
                  >
                    <option value="technician">IT Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              )}
              <TextField
                label="Username"
                value={dialog.kind === "create" ? form.username : editForm?.username || ""}
                onChange={(value) => {
                  if (dialog.kind === "create") updateForm("username", value);
                  else setEditForm((current) => ({ ...current, username: value }));
                }}
                required
              />
              {dialog.kind === "create" && <small className="field-hint">Suggested from the full name; you can change it.</small>}
              <TextField
                label="Email"
                type="email"
                value={dialog.kind === "create" ? form.email : editForm?.email || ""}
                onChange={(value) => {
                  if (dialog.kind === "create") updateForm("email", value);
                  else setEditForm((current) => ({ ...current, email: value }));
                }}
                required
              />
              {dialog.kind === "create" && (
                <p className="field-hint">A temporary password will be generated. The account holder must change it at first sign-in.</p>
              )}
              <FormError message={error} />
              <div className="form-actions">
                <button
                  className="button button-secondary"
                  onClick={() => {
                    if (!(formIsDirty || editIsDirty) || window.confirm("Discard your unsaved account changes?")) closeDialog();
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  {dialog.kind === "create" ? (busy ? "Creating..." : "Create account") : (busy ? "Saving..." : "Save changes")}
                </button>
              </div>
            </form>
          )}
          {dialog.kind === "confirm" && (
            <div className="account-modal-content">
              <p>
                {dialog.action === "reset"
                  ? `Reset password for ${dialog.account.fullName}?`
                  : `${dialog.action === "enable" ? "Enable" : "Disable"} ${dialog.account.fullName}'s account?`}
              </p>
              <FormError message={error} />
              <div className="form-actions">
                <button className="account-dialog-button account-dialog-neutral" disabled={busy} onClick={closeDialog} type="button">Cancel</button>
                <button
                  className={`account-dialog-button ${dialog.action === "disable" ? "account-dialog-danger" : "account-dialog-primary"}`}
                  disabled={busy}
                  onClick={confirmAccountAction}
                  type="button"
                >
                  {busy ? "Please wait..." : dialog.action === "reset" ? "Reset password" : dialog.action === "enable" ? "Enable" : "Disable"}
                </button>
              </div>
            </div>
          )}
          {(dialog.kind === "created" || dialog.kind === "password-reset") && (
            <div className="account-modal-content">
              <p className="account-password-instruction">The user must change it at first sign-in</p>
              <label className="account-password-label">
                Temporary password for {dialog.username}
                <span className="account-temporary-password">{temporaryPassword}</span>
              </label>
              {error && <FormError message={error} />}
              <div className="form-actions">
                <button className="button button-secondary" onClick={copyTemporaryPassword} type="button">{copied ? "Copied" : "Copy"}</button>
                <button className="button button-primary" onClick={closeDialog} type="button">Done</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </StaffLayout>
  );
}

function AccountRowActions({ account, currentUser, onEdit, onResetPassword, onStatusChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 8 });
  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);
  const triggerRef = useRef(null);
  const ownAdminAccount = currentUser?.role === "admin"
    && String(account.id) === String(currentUser.id);
  const statusAction = account.active ? "disable" : "enable";
  const statusDisabled = statusAction === "disable" && ownAdminAccount;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const positionMenu = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const menuHeight = 128;
      setMenuPosition({
        top: bounds.bottom + menuHeight <= window.innerHeight - 8
          ? bounds.bottom + 4
          : Math.max(8, bounds.top - menuHeight - 4),
        right: Math.max(8, window.innerWidth - bounds.right),
      });
    };
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !menuPanelRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    positionMenu();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen]);

  function runAndClose(action) {
    action();
    setMenuOpen(false);
  }

  const statusButton = (
    <button
      className={`account-action-button ${statusAction === "disable" ? "account-action-disable" : "account-action-enable"}`}
      disabled={statusDisabled}
      onClick={() => {
        if (!statusDisabled) onStatusChange(statusAction === "enable");
      }}
      title={statusDisabled ? "You cannot disable your own account" : undefined}
      type="button"
    >
      {statusAction === "disable" ? "Disable" : "Enable"}
    </button>
  );

  return (
    <div className="account-row-actions" ref={menuRef}>
      <div className="account-row-actions-desktop">
        <button className="account-action-button account-action-edit" onClick={onEdit} type="button">Edit</button>
        <button className="account-action-button account-action-reset" onClick={onResetPassword} type="button">Reset password</button>
        {statusDisabled
          ? <span className="account-action-disabled" title="You cannot disable your own account">{statusButton}</span>
          : statusButton}
      </div>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`Actions for ${account.fullName}`}
        className="account-row-actions-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        ref={triggerRef}
        type="button"
      >
        ...
      </button>
      {menuOpen && (
        createPortal(
          <div className="account-row-actions-menu" ref={menuPanelRef} role="menu" style={menuPosition}>
            <button className="account-action-button account-action-edit" onClick={() => runAndClose(onEdit)} role="menuitem" type="button">Edit</button>
            <button className="account-action-button account-action-reset" onClick={() => runAndClose(onResetPassword)} role="menuitem" type="button">Reset password</button>
            {statusDisabled
              ? <span className="account-action-disabled" title="You cannot disable your own account">{statusButton}</span>
              : <button
                className={`account-action-button ${statusAction === "disable" ? "account-action-disable" : "account-action-enable"}`}
                onClick={() => runAndClose(() => onStatusChange(statusAction === "enable"))}
                role="menuitem"
                type="button"
              >
                {statusAction === "disable" ? "Disable" : "Enable"}
              </button>}
          </div>,
          document.body,
        )
      )}
    </div>
  );
}

function accountRoleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "technician") return "IT Staff";
  return "Employee";
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
          path="/staff/reports"
          element={<AuthGate roles={["technician", "admin"]}><ReportsPage /></AuthGate>}
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
