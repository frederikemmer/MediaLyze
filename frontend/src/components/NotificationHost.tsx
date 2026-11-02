import { ArrowRight, Film, Folder, Server, Settings } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { NotificationEntry } from "../lib/notifications";
import { notificationText } from "../lib/notifications";
import type { NotificationSettings } from "../lib/notification-settings";

const areaIcons = { connectors: Server, transcoding: Film, library: Folder, settings: Settings };

export function NotificationCard({ entry, settings, style, inactive = false }: {
  entry: NotificationEntry; settings: NotificationSettings; style?: CSSProperties; inactive?: boolean;
}) {
  const Icon = areaIcons[entry.source.area];
  return (
    <article className="notification-card" data-palette={settings.palette} data-style={settings.style}
      data-type={entry.type} style={style} inert={inactive}>
      <Icon className="notification-area-icon" aria-hidden="true" />
      <span className="notification-copy" title={notificationText(entry.message)}>
        {typeof entry.message === "string" ? entry.message : entry.message.map((part, index) => (
          typeof part === "string" ? <span key={index}>{part}</span> : <span key={index} className="notification-reference">{part.reference}</span>
        ))}
      </span>
      <Link className="notification-source-link" to={entry.source.href} title={entry.source.label} aria-label={entry.source.label}>
        <ArrowRight aria-hidden="true" />
      </Link>
    </article>
  );
}

/** Shared by the live host and the visual catalog, including keyboard/overflow behavior. */
export function NotificationDeck({ entries, settings }: { entries: NotificationEntry[]; settings: NotificationSettings }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = hovered || focused;
  const deck = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!expanded && deck.current) deck.current.scrollTop = 0; }, [expanded]);
  const cards = [...entries].reverse();
  const visible = Math.min(cards.length, 5);
  return (
    <div ref={deck} className="notification-deck" data-expanded={expanded} data-overflow={cards.length > 5}
      role="group" aria-label={t("notifications.group", { count: cards.length })} tabIndex={cards.length > 1 ? 0 : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !hovered) event.currentTarget.scrollTop = 0; }}
      onPointerDown={(event) => { if (event.pointerType === "touch") event.currentTarget.focus(); }}
      style={{ "--notification-stack-height": `${42 + (visible - 1) * 5}px`, "--notification-fan-height": `${42 + (visible - 1) * 46}px` } as CSSProperties}>
      {cards.map((entry, index) => (
        <NotificationCard key={entry.id} entry={entry} settings={settings} inactive={!expanded && index > 0}
          style={{ "--notification-top": `${(visible - 1) * 5 - index * 5}px`, "--notification-fan-top": `${index * 46}px`,
            "--notification-delay": `${Math.min(index, 4) * 18}ms`, zIndex: cards.length - index } as CSSProperties} />
      ))}
    </div>
  );
}

export function NotificationHost({ entries, settings, setPaused }: {
  entries: NotificationEntry[]; settings: NotificationSettings; setPaused: (source: string, active: boolean) => void;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    // Programmatic removal/regrouping can remove a focused card without a blur event.
    if (!host.current?.contains(document.activeElement)) setPaused("focus", false);
    if (!entries.length) setPaused("pointer", false);
  }, [entries, settings.grouping, setPaused]);
  const groups = new Map<string, NotificationEntry[]>();
  for (const entry of entries) {
    const topic = entry.topicKey ?? `notification:${entry.id}`;
    const key = settings.grouping === "off" ? String(entry.id)
      : settings.grouping === "type" ? entry.type
      : settings.grouping === "topic" ? topic : JSON.stringify([topic, entry.type]);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return (
    <section ref={host} className="notification-host" aria-label={t("notifications.title")}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setPaused("pointer", true); }}
      onPointerLeave={() => setPaused("pointer", false)}
      onFocusCapture={() => setPaused("focus", true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused("focus", false); }}>
      {[...groups].reverse().map(([key, group]) => <NotificationDeck key={key} entries={group} settings={settings} />)}
    </section>
  );
}
