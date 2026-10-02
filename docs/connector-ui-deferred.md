# Connector UI roadmap

[Documentation home](README.md)

This document is the living list of connector workflows that are not yet part of the shared Connector Settings UI. The provider-neutral backend is authoritative for catalog data, inferred bindings, exact-path matching, and synchronization.

## Reintroduced

The shared connector UI now includes:

- provider-neutral connection accordions for any number of Jellyfin connections, with lazy detail/user loading and global active-job polling;
- connection-scoped users, user-item state, playback events, combined file playback timelines, and a disabled Plex `Soon™` option;
- independent, collapsed-by-default **Library assignments** and **Path mappings** sections;
- automatic mapping as the default for new and upgraded connections, plus a manual mode that exposes the same rules for editing;
- conservative corpus inference across many assets, multiple connector locations, multiple MediaLyze roots, and multiple target libraries;
- verified, stale, imported, and manual rule states with expandable technical fields;
- binding-derived mandatory library links, optional manual links, coverage, and guided MediaLyze-library creation recommendations;
- Library Settings association/path editors replaced by status and a deep link to the responsible connector.

Individual-file matching is intentionally not part of the product. There are no file-ID inputs, persisted file suggestions, ignore/restore actions, or manual match APIs to reintroduce.

## Next: focused connection diagnostics

Diagnostics should live inside the corresponding connection accordion and be designed for large catalogs:

- status totals and actionable explanations;
- filtering by library, location, match status, and text;
- server-side pagination;
- read-only focused details with sanitized provider payloads;
- direct links back to the relevant binding row;
- clear distinction between unmapped paths, unavailable roots, ambiguous bindings, missing files, and unsupported item types.

Diagnostics must remain read-only. Resolution happens by correcting a root, mapping rule, or MediaLyze library scan—not by assigning an individual file.

## Provider and cross-connector backlog

- implement and register the Plex transport, DTO normalization, capabilities, and provider-specific tests before enabling Plex;
- generalize connector images and multi-connector cover selection;
- add connector-spanning playback statistics outside the file timeline;
- decide which additional provider-specific catalog pages or actions deserve capability-gated accordion sections;
- remove the deprecated `/api/jellyfin/*` facade and legacy tables only after all remaining compatibility consumers have migrated.

Every new UI stage must update all shipped locales, the `/ui-elements` catalog, capability-gating tests, secret-redaction tests, and upgrade/migration coverage.
