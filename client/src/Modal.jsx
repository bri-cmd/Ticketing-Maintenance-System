import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export default function Modal({
  title,
  children,
  onClose,
  isDirty = false,
  closeConfirmation = "Discard your unsaved changes?",
  size = "default",
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const isDirtyRef = useRef(isDirty);
  const closeConfirmationRef = useRef(closeConfirmation);
  onCloseRef.current = onClose;
  isDirtyRef.current = isDirty;
  closeConfirmationRef.current = closeConfirmation;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusInitial = () => {
      const firstFocusable = dialog?.querySelector(
        "[data-modal-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-modal-close])",
      );
      (firstFocusable || dialog)?.focus();
    };
    const requestClose = () => {
      if (!isDirtyRef.current || window.confirm(closeConfirmationRef.current)) onCloseRef.current();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(dialog?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])].filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const animationFrame = window.requestAnimationFrame(focusInitial);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function handleBackdropClick(event) {
    if (event.target !== event.currentTarget) return;
    if (!isDirty || window.confirm(closeConfirmation)) onClose();
  }

  return createPortal(
    <div className="account-modal-backdrop" onMouseDown={handleBackdropClick}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`account-modal ${size === "small" ? "account-modal-small" : ""}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="account-modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            aria-label="Close dialog"
            className="account-modal-close"
            data-modal-close
            onClick={() => {
              if (!isDirty || window.confirm(closeConfirmation)) onClose();
            }}
            type="button"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
