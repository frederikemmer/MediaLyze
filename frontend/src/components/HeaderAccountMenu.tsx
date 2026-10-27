import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { LogOut, User } from "lucide-react";

type HeaderAccountMenuProps = {
  username: string;
  owner: boolean;
  kind: "account" | "guest";
  onSignOut: () => void | Promise<void>;
  onAccountClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  initiallyOpen?: boolean;
};

export function HeaderAccountMenu({ username, owner, kind, onSignOut, onAccountClick, initiallyOpen = false }: HeaderAccountMenuProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstAfterOpenRef = useRef(false);
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const displayName = username.trim() || t("access.guest");
  const roleLabel = kind === "guest" ? t("access.guest") : owner ? t("access.owner") : t("access.user");
  const accountMenuLabel = t("access.accountMenu", { name: displayName });
  const initials = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase() || "U";

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !focusFirstAfterOpenRef.current) return;
    focusFirstAfterOpenRef.current = false;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
  }, [isOpen]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setIsOpen(false);
      return;
    }

    const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
    if (!menuItems.length) return;
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + menuItems.length) % menuItems.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = menuItems.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      menuItems[nextIndex]?.focus();
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" || isOpen) return;
    event.preventDefault();
    focusFirstAfterOpenRef.current = true;
    setIsOpen(true);
  }

  return (
    <>
      <span className="media-header-account-divider" aria-hidden="true" />
      <div className="media-header-account" ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className="icon-nav-button media-header-account-trigger"
          aria-label={accountMenuLabel}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          data-tooltip={accountMenuLabel}
          onClick={() => setIsOpen((open) => !open)}
          onKeyDown={handleTriggerKeyDown}
        >
          <User aria-hidden="true" className="nav-icon" />
        </button>
        {isOpen ? (
          <div id={menuId} className="media-header-account-menu" role="menu" aria-label={t("access.myAccount")} ref={menuRef} onKeyDown={handleMenuKeyDown}>
            <div className="media-header-account-menu-heading" role="presentation">
              <span className="media-header-account-avatar" aria-hidden="true">{initials}</span>
              <span className="media-header-account-copy"><strong>{displayName}</strong><small>{roleLabel}</small></span>
            </div>
            <span className="media-header-account-separator" role="separator" />
            <NavLink
              to="/settings?section=accounts&account=me"
              className="media-header-account-menu-item"
              role="menuitem"
              onClick={(event) => {
                setIsOpen(false);
                onAccountClick?.(event);
              }}
            >
              <User aria-hidden="true" />
              <span>{t("access.myAccount")}</span>
            </NavLink>
            <button
              type="button"
              className="media-header-account-menu-item signout"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                void onSignOut();
              }}
            >
              <LogOut aria-hidden="true" />
              <span>{t("access.logout")}</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
