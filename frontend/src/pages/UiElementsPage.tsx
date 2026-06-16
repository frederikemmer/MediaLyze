import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  Columns3Cog,
  Copy,
  Database,
  Diff,
  Download,
  Eye,
  EyeOff,
  FileCheckCorner,
  FileDiff,
  FileExclamationPoint,
  FilePlusCorner,
  FileSearchCorner,
  FileVideo,
  Folder,
  GitCompare,
  History,
  House,
  Info,
  Layers,
  LayoutPanelTop,
  ListFilter,
  LoaderCircle,
  Lock,
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  PanelTopClose,
  Plus,
  Save,
  SaveOff,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";

import { AnimatedSearchIcon } from "../components/AnimatedSearchIcon";
import { AsyncPanel } from "../components/AsyncPanel";
import { ComparisonChartPanel } from "../components/ComparisonChartPanel";
import { DistributionChartPanel } from "../components/DistributionChartPanel";
import { DistributionList } from "../components/DistributionList";
import { DuplicatePanelEmptyState } from "../components/DuplicatePanelEmptyState";
import { ChevronsRightLeftIcon } from "../components/ChevronsRightLeftIcon";
import { CheckIcon } from "../components/CheckIcon";
import { CopyIcon } from "../components/CopyIcon";
import { DashboardVisibilityIcon } from "../components/DashboardVisibilityIcon";
import { DeleteIcon } from "../components/DeleteIcon";
import { GitCompareArrowsIcon } from "../components/GitCompareArrowsIcon";
import { GithubIcon } from "../components/GithubIcon";
import { AudioStreamPrimaryToggle, type AudioStreamPrimaryMode } from "../components/AudioStreamPrimaryToggle";
import { PanelEmptyState } from "../components/PanelEmptyState";
import { PathBrowser } from "../components/PathBrowser";
import { PathSegmentTrail } from "../components/PathSegmentTrail";
import { PanelLeftToggleIcon } from "../components/PanelLeftToggleIcon";
import { ProfileFavoriteButton } from "../components/ProfileFavoriteButton";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import { SparklesIcon as AnimatedSparklesIcon } from "../components/SparklesIcon";
import { SquarePenIcon } from "../components/SquarePenIcon";
import { StatCard } from "../components/StatCard";
import { StatisticPanelLayoutControls } from "../components/StatisticPanelLayoutControls";
import { StatisticPanelLayoutMigrationNotice } from "../components/StatisticPanelLayoutMigrationNotice";
import { StreamDetailsList } from "../components/StreamDetailsList";
import { TableViewSettingsEditor } from "../components/TableViewSettingsEditor";
import { TelemetryModeToggle } from "../components/TelemetryModeToggle";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { api, type BrowseResponse, type ComparisonResponse, type MediaFileStreamDetails } from "../lib/api";
import { buildDefaultLibraryStatisticsSettings } from "../lib/library-statistics-settings";
import type { ComparisonSelection } from "../lib/statistic-comparisons";
import type { StatisticPanelLayoutMenuDefinition } from "../lib/statistic-panel-layout";
import { useTheme, type ThemePreference } from "../lib/theme";

type CatalogSectionId =
  | "foundation"
  | "header-nav"
  | "settings"
  | "forms"
  | "buttons"
  | "panels"
  | "tables"
  | "stats"
  | "runtime"
  | "file-library"
  | "duplicates-path-telemetry"
  | "dialogs";

type CatalogSectionDefinition = {
  id: CatalogSectionId;
  titleKey: string;
  descriptionKey: string;
};

const catalogSections: CatalogSectionDefinition[] = [
  { id: "foundation", titleKey: "uiElements.sections.foundation", descriptionKey: "uiElements.descriptions.foundation" },
  { id: "header-nav", titleKey: "uiElements.sections.headerNav", descriptionKey: "uiElements.descriptions.headerNav" },
  { id: "settings", titleKey: "uiElements.sections.settings", descriptionKey: "uiElements.descriptions.settings" },
  { id: "forms", titleKey: "uiElements.sections.forms", descriptionKey: "uiElements.descriptions.forms" },
  { id: "buttons", titleKey: "uiElements.sections.buttons", descriptionKey: "uiElements.descriptions.buttons" },
  { id: "panels", titleKey: "uiElements.sections.panels", descriptionKey: "uiElements.descriptions.panels" },
  { id: "tables", titleKey: "uiElements.sections.tables", descriptionKey: "uiElements.descriptions.tables" },
  { id: "stats", titleKey: "uiElements.sections.stats", descriptionKey: "uiElements.descriptions.stats" },
  { id: "runtime", titleKey: "uiElements.sections.runtime", descriptionKey: "uiElements.descriptions.runtime" },
  { id: "file-library", titleKey: "uiElements.sections.fileLibrary", descriptionKey: "uiElements.descriptions.fileLibrary" },
  {
    id: "duplicates-path-telemetry",
    titleKey: "uiElements.sections.duplicatesPathTelemetry",
    descriptionKey: "uiElements.descriptions.duplicatesPathTelemetry",
  },
  { id: "dialogs", titleKey: "uiElements.sections.dialogs", descriptionKey: "uiElements.descriptions.dialogs" },
];

function preventCatalogNavigation(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
}

const colorTokens = [
  { name: "--bg", value: "var(--bg)" },
  { name: "--bg-alt", value: "var(--bg-alt)" },
  { name: "--ink", value: "var(--ink)" },
  { name: "--muted", value: "var(--muted)" },
  { name: "--panel", value: "var(--panel)" },
  { name: "--panel-strong", value: "var(--panel-strong)" },
  { name: "--accent", value: "var(--accent)" },
  { name: "--accent-2", value: "var(--accent-2)" },
  { name: "--accent-3", value: "var(--accent-3)" },
];

const distributionItems = [
  { label: "HEVC", value: 42 },
  { label: "H.264", value: 31 },
  { label: "AV1", value: 12 },
  { label: "ProRes", value: 5 },
];

const numericDistribution = {
  total: 128,
  bins: [
    { lower: null, upper: 50, count: 8, percentage: 6.25 },
    { lower: 50, upper: 70, count: 26, percentage: 20.3 },
    { lower: 70, upper: 85, count: 54, percentage: 42.2 },
    { lower: 85, upper: null, count: 40, percentage: 31.25 },
  ],
};

const comparisonResponse: ComparisonResponse = {
  x_field: "duration",
  y_field: "size",
  x_field_kind: "numeric",
  y_field_kind: "numeric",
  available_renderers: ["heatmap", "scatter", "bar"],
  total_files: 128,
  included_files: 118,
  excluded_files: 10,
  sampled_points: false,
  sample_limit: 5000,
  x_buckets: [
    { key: "0:3600", label: "0:3600", lower: 0, upper: 3600 },
    { key: "3600:7200", label: "3600:7200", lower: 3600, upper: 7200 },
    { key: "7200:null", label: "7200:null", lower: 7200, upper: null },
  ],
  y_buckets: [
    { key: "0:8000000000", label: "0:8000000000", lower: 0, upper: 8000000000 },
    { key: "8000000000:24000000000", label: "8000000000:24000000000", lower: 8000000000, upper: 24000000000 },
    { key: "24000000000:null", label: "24000000000:null", lower: 24000000000, upper: null },
  ],
  heatmap_cells: [
    { x_key: "0:3600", y_key: "0:8000000000", count: 18 },
    { x_key: "3600:7200", y_key: "8000000000:24000000000", count: 42 },
    { x_key: "7200:null", y_key: "24000000000:null", count: 16 },
  ],
  scatter_points: [
    { media_file_id: 1, asset_name: "Arrival.2016.UHD.mkv", x_value: 6960, y_value: 18400000000 },
    { media_file_id: 2, asset_name: "Concert.Live.flac", x_value: 4380, y_value: 870000000 },
    { media_file_id: 3, asset_name: "Archive.Sample.mov", x_value: 9300, y_value: 42000000000 },
  ],
  bar_entries: [
    { x_key: "0:3600", x_label: "Short", value: 6200000000, count: 18 },
    { x_key: "3600:7200", x_label: "Feature", value: 16400000000, count: 42 },
    { x_key: "7200:null", x_label: "Long", value: 31000000000, count: 16 },
  ],
};

const mockBrowseResponses: Record<string, BrowseResponse> = {
  ".": {
    current_path: ".",
    parent_path: null,
    entries: [
      { name: "Movies", path: "Movies", is_dir: true },
      { name: "Music", path: "Music", is_dir: true },
      { name: "Series", path: "Series", is_dir: true },
    ],
  },
  Movies: {
    current_path: "Movies",
    parent_path: ".",
    entries: [
      { name: "Arrival", path: "Movies/Arrival", is_dir: true },
      { name: "Concerts", path: "Movies/Concerts", is_dir: true },
    ],
  },
  Music: {
    current_path: "Music",
    parent_path: ".",
    entries: [
      { name: "Live", path: "Music/Live", is_dir: true },
      { name: "Albums", path: "Music/Albums", is_dir: true },
    ],
  },
  Series: {
    current_path: "Series",
    parent_path: ".",
    entries: [{ name: "Documentaries", path: "Series/Documentaries", is_dir: true }],
  },
};

const streamDetails: MediaFileStreamDetails = {
  id: 1,
  video_streams: [
    {
      stream_index: 0,
      codec: "hevc",
      profile: "Main 10",
      width: 3840,
      height: 2160,
      pix_fmt: "yuv420p10le",
      color_space: "bt2020nc",
      color_transfer: "smpte2084",
      color_primaries: "bt2020",
      frame_rate: 23.976,
      bit_rate: 18400000,
      bit_depth: 10,
      hdr_type: "hdr10",
    },
  ],
  audio_streams: [
    {
      stream_index: 1,
      codec: "eac3",
      profile: "Dolby Digital Plus",
      spatial_audio_profile: "dolby_atmos",
      channels: 6,
      channel_layout: "5.1",
      sample_rate: 48000,
      bit_rate: 768000,
      bit_depth: 24,
      bit_rate_mode: "CBR",
      compression_mode: "lossy",
      replay_gain: null,
      replay_gain_peak: null,
      writing_library: "Lavf",
      md5_unencoded: null,
      language: "en",
      default_flag: true,
      forced_flag: false,
    },
  ],
  subtitle_streams: [
    { stream_index: 2, codec: "subrip", language: "de", default_flag: false, forced_flag: false, subtitle_type: "text" },
  ],
  external_subtitles: [{ path: "Arrival.2016.de.srt", language: "de", format: "srt" }],
};

const availablePanelDefinitions: StatisticPanelLayoutMenuDefinition[] = [
  { id: "quality_score", nameKey: "dashboard.qualityScoreDistribution" },
  { id: "comparison", nameKey: "dashboard.comparisonPanel" },
  { id: "history", nameKey: "dashboard.history.title" },
];

function CatalogSection({
  definition,
  children,
}: {
  definition: CatalogSectionDefinition;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id={definition.id} className="panel ui-elements-section">
      <div className="panel-title-row">
        <h2>{t(definition.titleKey)}</h2>
      </div>
      <p className="subtitle">{t(definition.descriptionKey)}</p>
      <div className="ui-elements-section-body">{children}</div>
    </section>
  );
}

function VariantGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ui-elements-variant-group">
      <h3>{title}</h3>
      <div className="ui-elements-variant-grid">{children}</div>
    </div>
  );
}

function SourceTag({ source }: { source: string }) {
  return <span className="ui-elements-source-tag">{source}</span>;
}

function ClassList({ classes }: { classes: string[] }) {
  return (
    <div className="ui-elements-class-list" aria-label="CSS classes">
      {classes.map((className) => (
        <code key={className}>{className}</code>
      ))}
    </div>
  );
}

function VariantCard({
  title,
  source,
  classes,
  status,
  children,
  wide = false,
}: {
  title: string;
  source: string;
  classes: string[];
  status?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`ui-elements-variant-card${wide ? " ui-elements-variant-card-wide" : ""}`}>
      <div className="ui-elements-variant-meta">
        <div>
          <strong>{title}</strong>
          {status ? <span>{status}</span> : null}
        </div>
        <SourceTag source={source} />
      </div>
      <div className="ui-elements-variant-preview">{children}</div>
      <ClassList classes={classes} />
    </article>
  );
}

function Badge({ children, className = "badge" }: { children: ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}

function ScoreMeter({ value }: { value: number }) {
  return (
    <div className="score-cell">
      <strong>{value}</strong>
      <span className="score-meter">
        <span
          className={`score-meter-fill ${value >= 85 ? "score-meter-fill-high" : value >= 65 ? "score-meter-fill-medium" : "score-meter-fill-low"}`}
          style={{ width: `${value}%` }}
        />
      </span>
    </div>
  );
}

function AnalyzedFilesTable() {
  const rows = [
    { file: "Movies/Arrival.2016.mkv", container: "mkv", codec: "HEVC", quality: 91, size: "18.4 GB" },
    { file: "Series/Example/S01E01.mp4", container: "mp4", codec: "H.264", quality: 76, size: "4.8 GB" },
    { file: "Music/Live Session.flac", container: "flac", codec: "FLAC", quality: 88, size: "624 MB" },
  ];

  return (
    <div className="data-table-shell ui-elements-table-shell">
      <div className="media-data-table">
        <div className="media-data-table-head">
          <div className="media-data-row media-data-head-row ui-elements-data-row">
            {["File", "Container", "Codec", "Quality", "Size"].map((label, index) => (
              <div key={label} className={`media-data-cell media-data-header-cell${index === 0 ? " is-sticky" : ""}`}>
                <button type="button" className="column-sort">
                  {label}
                  <span className={`sort-indicator${index === 0 ? " is-active" : ""}`}>{index === 0 ? "↓" : "↕"}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="media-data-table-body is-static-body">
          {rows.map((row) => (
            <div key={row.file} className="media-data-row media-data-body-row is-static-row ui-elements-data-row">
              <div className="media-data-cell is-sticky">
                <span className="file-link">{row.file}</span>
              </div>
              <div className="media-data-cell">{row.container}</div>
              <div className="media-data-cell">{row.codec}</div>
              <div className="media-data-cell">
                <ScoreMeter value={row.quality} />
              </div>
              <div className="media-data-cell">{row.size}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsNavigationFixture({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={`settings-layout${collapsed ? " is-settings-nav-collapsed" : ""}`}>
      <aside className="settings-navigation-panel" aria-label="Settings navigation">
        <button
          type="button"
          className="settings-mobile-menu-button"
          aria-label="Open settings navigation"
          aria-expanded="false"
          aria-controls="settings-mobile-navigation-menu"
        >
          <span className="settings-mobile-menu-button-content">
            <span className="settings-mobile-menu-current">
              <Folder className="nav-icon" aria-hidden="true" />
              <span>Libraries</span>
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="settings-mobile-menu-chevron" />
        </button>
        <div id="settings-mobile-navigation-menu" className="settings-mobile-navigation-menu" aria-hidden="true">
          <nav className="settings-mobile-navigation-list" aria-label="Mobile settings navigation">
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item active" aria-current="page" tabIndex={-1}>
              <span className="nav-active-pill" />
              <span className="settings-navigation-item-content">
                <Folder className="nav-icon" aria-hidden="true" />
                <span>Libraries</span>
              </span>
            </button>
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item" tabIndex={-1}>
              <span className="settings-navigation-item-content">
                <Settings className="nav-icon" aria-hidden="true" />
                <span>App settings</span>
              </span>
            </button>
          </nav>
        </div>
        <div className="settings-navigation-header">
          {!collapsed ? <span>Settings</span> : null}
          <button
            type="button"
            className="secondary icon-only-button settings-navigation-collapse-button"
            aria-label={collapsed ? "Expand settings navigation" : "Collapse settings navigation"}
            title={collapsed ? "Expand settings navigation" : "Collapse settings navigation"}
            aria-expanded={!collapsed}
          >
            <PanelLeftToggleIcon aria-hidden="true" collapsed={collapsed} className="settings-navigation-toggle-icon" size={24} />
          </button>
        </div>
        <nav className="settings-navigation-list">
          <button type="button" className="settings-navigation-item active" aria-current="page" aria-label="Libraries" data-settings-panel-id="configuredLibraries">
            <span className="nav-active-pill" />
            <span className="settings-navigation-item-content">
              <Folder className="nav-icon" aria-hidden="true" />
              {!collapsed ? <span>Libraries</span> : null}
            </span>
          </button>
          <button type="button" className="settings-navigation-item" aria-label="App settings" data-settings-panel-id="appSettings">
            <span className="settings-navigation-item-content">
              <Settings className="nav-icon" aria-hidden="true" />
              {!collapsed ? <span>App settings</span> : null}
            </span>
          </button>
        </nav>
        <div className="settings-navigation-quick-actions">
          <div className="settings-navigation-divider" />
          {!collapsed ? <div className="settings-navigation-section-label">Quick actions</div> : null}
          <button type="button" className="secondary settings-navigation-quick-action" aria-label="Full scan" title="Full scan">
            <Database className="nav-icon" aria-hidden="true" />
            {!collapsed ? <span>Full scan</span> : null}
          </button>
        </div>
      </aside>
    </div>
  );
}

function TableViewSettingsFixture() {
  const [settings, setSettings] = useState(() => buildDefaultLibraryStatisticsSettings());

  return (
    <TableViewSettingsEditor
      settings={settings}
      libraryType="movies"
      showMusicQualityScore
      hasVideoMetadata
      onChange={setSettings}
    />
  );
}

function QualityPickerFixture({ open = false }: { open?: boolean }) {
  return (
    <div className="quality-picker-field-shell search-filter-picker">
      <button type="button" className={`quality-picker-field${open ? " is-open" : ""}`}>
        <div className="quality-picker-values">
          <span className="badge quality-picker-chip">HEVC</span>
          <span className="badge quality-picker-chip">AV1</span>
        </div>
        <ChevronDown className="nav-icon" aria-hidden="true" />
      </button>
      {open ? (
        <div className="search-filter-picker-popover quality-picker-popover">
          <div className="quality-picker-custom-entry">
            <div className="quality-picker-custom-row">
              <input className="quality-picker-custom-input" defaultValue="vvc" aria-label="Custom value" />
              <button type="button" className="secondary small">
                Add
              </button>
            </div>
          </div>
          <button type="button" className="search-filter-picker-item is-selected">HEVC</button>
          <button type="button" className="search-filter-picker-item">H.264</button>
        </div>
      ) : null}
    </div>
  );
}

function QualityProfileFixture() {
  return (
    <div className="quality-profile-panel-stack">
      <div className="quality-profile-segments">
        <button type="button" className="quality-profile-segment is-active">
          <span className="quality-profile-segment-pill" />
          <span>Video</span>
        </button>
        <button type="button" className="quality-profile-segment">
          <span>Music</span>
        </button>
      </div>
      <div className="quality-profile-picker is-protected">
        <div className="quality-profile-picker-control">
          <button type="button" className="quality-profile-picker-trigger">
            <span className="quality-profile-picker-name">
              <span>Default video</span>
              <span className="badge">Default</span>
              <span className="badge">Built-in</span>
            </span>
            <ChevronDown className="nav-icon" aria-hidden="true" />
          </button>
          <div className="quality-profile-picker-actions">
            <TooltipTrigger
              ariaLabel="Built-in default profile protection"
              className="quality-profile-protected-tooltip"
              content="Built-in default profiles are protected for app updates. Duplicate this profile or create a new one to make changes."
              align="start"
            >
              <Lock className="nav-icon" aria-hidden="true" size={16} />
            </TooltipTrigger>
            <button type="button" className="quality-profile-action-button" disabled title="Built-in default profiles are protected for app updates.">
              <Save className="nav-icon" aria-hidden="true" />
            </button>
            <button type="button" className="quality-profile-action-button" title="Duplicate profile">
              <CopyIcon className="nav-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className="quality-profile-metric-list">
        <div className="quality-profile-metric-item">
          <div className="quality-profile-metric-row">
            <button type="button" className="quality-profile-metric-toggle" aria-pressed="true">
              <CheckIcon className="nav-icon" aria-hidden="true" />
            </button>
            <div className="quality-profile-metric-name">
              <strong>Resolution</strong>
              <span className="subtitle">Weight and boundary controls</span>
            </div>
            <div className="quality-profile-weight-control">
              <input className="quality-profile-weight-input" type="number" defaultValue={8} aria-label="Weight" />
            </div>
          </div>
          <div className="quality-profile-metric-settings-grid">
            <label className="quality-profile-boundary-field">
              <span>Minimum</span>
              <QualityPickerFixture />
            </label>
            <label className="quality-profile-boundary-field">
              <span>Ideal</span>
              <QualityPickerFixture open />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchFilterFixture({ invalid = false }: { invalid?: boolean }) {
  return (
    <div className={`metadata-search-row${invalid ? " is-invalid" : ""}`}>
      <div className="metadata-search-control">
        <button type="button" className="metadata-search-icon-button" aria-label="Search field">
          <Search aria-hidden="true" className="nav-icon" />
        </button>
        <input defaultValue={invalid ? ">=4GB,<" : "codec:hevc, hdr:!sdr"} aria-label="Structured search" />
        <button type="button" className="metadata-search-remove" aria-label="Clear search">
          <X aria-hidden="true" className="nav-icon" />
        </button>
      </div>
      {invalid ? <p className="metadata-search-error">Incomplete numeric expression.</p> : null}
    </div>
  );
}

function IgnorePatternFixture() {
  return (
    <div className="ignore-pattern-section">
      <button type="button" className="secondary ignore-pattern-section-toggle">
        <span className="ignore-pattern-section-title">User ignore patterns</span>
        <span className="ignore-pattern-section-meta">
          <span className="badge">2</span>
          <ChevronDown aria-hidden="true" className="nav-icon" />
        </span>
      </button>
      <div className="ignore-pattern-section-body">
        <div className="ignore-pattern-row ignore-pattern-row-draft">
          <div className="ignore-pattern-control">
            <input defaultValue="*.sample" aria-label="New ignore pattern" />
          </div>
          <button type="button" className="secondary icon-only-button ignore-pattern-action-button" aria-label="Add">
            <Plus aria-hidden="true" className="nav-icon" />
          </button>
        </div>
        <div className="ignore-pattern-row ignore-pattern-row-saved">
          <div className="ignore-pattern-control">
            <input defaultValue="*/@eaDir/*" aria-label="Saved ignore pattern" />
          </div>
          <button type="button" className="secondary icon-only-button ignore-pattern-action-button" aria-label="Remove">
            <Trash2 aria-hidden="true" className="nav-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatisticLayoutFixture() {
  return (
    <div className="media-grid statistic-layout-grid is-editing">
      <div className="statistic-layout-panel-shell span-x-2 span-y-2 is-drop-target">
        <AsyncPanel title="Editable statistic panel">
          <DistributionList items={distributionItems} />
        </AsyncPanel>
        <div className="statistic-layout-overlay">
          <div className="statistic-layout-overlay-sheen" />
          <div className="statistic-layout-size-controls statistic-layout-size-controls-top-left">
            <button type="button" className="statistic-layout-size-button" aria-label="Remove">
              <Trash2 className="nav-icon" aria-hidden="true" />
            </button>
          </div>
          <div className="statistic-layout-size-controls statistic-layout-size-controls-right">
            <button type="button" className="statistic-layout-size-button" aria-label="Expand width">
              <PanelRightClose className="nav-icon" aria-hidden="true" />
            </button>
            <button type="button" className="statistic-layout-size-button" aria-label="Shrink width">
              <PanelLeftClose className="nav-icon" aria-hidden="true" />
            </button>
          </div>
          <div className="statistic-layout-size-controls statistic-layout-size-controls-bottom">
            <button type="button" className="statistic-layout-size-button" aria-label="Expand height">
              <PanelBottomClose className="nav-icon" aria-hidden="true" />
            </button>
            <button type="button" className="statistic-layout-size-button" aria-label="Shrink height">
              <PanelTopClose className="nav-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanJobFixture({ determinate = false }: { determinate?: boolean }) {
  return (
    <div className={`scan-job-card ${determinate ? "is-determinate ui-elements-determinate-scan" : "is-indeterminate"}`.trim()}>
      <div className="scan-job-card-main">
        <AnimatedSearchIcon animateOnMount className="scan-job-card-search-icon" />
        <span className="scan-job-card-name">{determinate ? "Music library" : "Movies archive"}</span>
        <div className="scan-job-metrics">
          {[
            { icon: FilePlusCorner, value: "42" },
            { icon: FileDiff, value: "18" },
            { icon: FileExclamationPoint, value: "3" },
            { icon: FileCheckCorner, value: determinate ? "82%" : "128" },
          ].map(({ icon: Icon, value }) => (
            <span key={value} className="scan-job-metric-item">
              <span className="scan-job-metric-icon-wrap">
                <Icon aria-hidden="true" size={14} />
                <span className="scan-job-metric-value">{value}</span>
              </span>
            </span>
          ))}
        </div>
        <div className="scan-job-card-actions">
          <button type="button" className="secondary icon-only-button scan-job-toggle-button" aria-label="Toggle">
            <ListFilter aria-hidden="true" className="nav-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanLogFixture() {
  return (
    <div className="scan-log-card">
      <button type="button" className="scan-log-summary">
        <div className="scan-log-summary-head">
          <div className="scan-log-summary-copy">
            <strong>Movies archive</strong>
            <span>Incremental scan - manual trigger</span>
          </div>
          <div className="meta-tags">
            <span className="badge scan-log-outcome badge-completed_with_issues">Completed with issues</span>
            <span className="scan-badge badge">incremental</span>
          </div>
        </div>
        <div className="scan-log-summary-meta">
          <span>128 analyzed</span>
          <span>3 errors</span>
          <span>42 unchanged</span>
        </div>
      </button>
      <div className="scan-log-detail">
        <div className="scan-log-detail-sections">
          <details className="scan-log-detail-section scan-log-collapsible-block" open>
            <summary className="scan-log-collapse-toggle">
              <span className="scan-log-collapse-copy">
                <strong>Failed files</strong>
                <span className="scan-log-collapse-summary">Short reasons plus copyable diagnostics</span>
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">3</span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              <div className="scan-log-pattern-card">
                <div className="scan-log-detail-title">
                  <code className="scan-log-path">Movies/Broken.mkv</code>
                  <button type="button" className="scan-log-copy-button" aria-label="Copy diagnostic">
                    <Copy className="nav-icon" aria-hidden="true" />
                  </button>
                </div>
                <p className="scan-log-failure-reason">ffprobe exited with code 1</p>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function FileDetailNavigationFixture() {
  return (
    <div className="file-detail-layout settings-layout">
      <aside className="settings-navigation-panel file-detail-navigation-panel" aria-label="File detail navigation">
        <button
          type="button"
          className="settings-mobile-menu-button"
          aria-label="Open file detail navigation"
          aria-expanded="false"
          aria-controls="file-detail-mobile-navigation-menu"
        >
          <span className="settings-mobile-menu-button-content">
            <span className="settings-mobile-menu-current">
              <FileVideo className="nav-icon" aria-hidden="true" />
              <span>Overview</span>
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="settings-mobile-menu-chevron" />
        </button>
        <div id="file-detail-mobile-navigation-menu" className="settings-mobile-navigation-menu" aria-hidden="true">
          <nav className="settings-mobile-navigation-list" aria-label="Mobile file detail navigation">
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item active" aria-current="page" data-file-detail-panel-id="overview" data-toggle-key="overview" tabIndex={-1}>
              <span className="nav-active-pill" />
              <span className="settings-navigation-item-content">
                <FileVideo className="nav-icon" aria-hidden="true" />
                <span>Overview</span>
              </span>
            </button>
            <button type="button" className="settings-navigation-item settings-mobile-navigation-item" data-file-detail-panel-id="streams" data-toggle-key="streams" tabIndex={-1}>
              <span className="settings-navigation-item-content">
                <Database className="nav-icon" aria-hidden="true" />
                <span>Streams</span>
              </span>
            </button>
          </nav>
        </div>
        <div className="settings-navigation-quick-actions file-detail-navigation-actions">
          <button type="button" className="secondary small settings-panel-header-action file-detail-navigation-back-button" aria-label="Back" title="Back">
            <ArrowLeft className="nav-icon" aria-hidden="true" />
            <span>Back</span>
          </button>
        </div>
        <div className="settings-navigation-header">
          <span>File details</span>
          <button type="button" className="secondary icon-only-button settings-navigation-collapse-button" aria-label="Collapse file detail navigation" aria-expanded="true">
            <PanelLeftToggleIcon aria-hidden="true" collapsed={false} className="settings-navigation-toggle-icon" size={24} />
          </button>
        </div>
        <nav className="settings-navigation-list">
          <button type="button" className="settings-navigation-item active" aria-current="page" aria-label="Overview" data-file-detail-panel-id="overview" data-toggle-key="overview">
            <span className="nav-active-pill" />
            <span className="settings-navigation-item-content">
              <FileVideo className="nav-icon" aria-hidden="true" />
              <span>Overview</span>
            </span>
          </button>
          <button type="button" className="settings-navigation-item" aria-label="Streams" data-file-detail-panel-id="streams" data-toggle-key="streams">
            <span className="settings-navigation-item-content">
              <Database className="nav-icon" aria-hidden="true" />
              <span>Streams</span>
            </span>
          </button>
        </nav>
      </aside>
      <section className="panel file-detail-active-panel">
        <div className="file-detail-title-row">
          <h2 className="file-detail-title">Arrival.2016.UHD.mkv</h2>
          <TooltipTrigger ariaLabel="Show path" content="/media/Movies/Arrival.2016.UHD.mkv">
            <Info aria-hidden="true" className="nav-icon" />
          </TooltipTrigger>
        </div>
        <div className="file-detail-overview">
          <div className="meta-tags">
            <button type="button" className="file-detail-badge-tooltip-trigger tooltip-trigger">
              <span className="badge">HEVC</span>
            </button>
            <span className="badge">3840x2160</span>
            <span className="badge">HDR10</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function PreviewFixture() {
  return (
    <div className="file-detail-preview-panel">
      <div className="file-detail-preview-player-shell">
        <video className="file-detail-preview-player" controls aria-label="Preview player" />
      </div>
      <div className="file-detail-preview-report">
        <p>Browser playback is a best-effort preview and may not support every codec.</p>
        <button type="button" className="file-detail-preview-report-button file-detail-cover-button secondary small">
          <Download className="nav-icon" aria-hidden="true" />
          Download file
        </button>
      </div>
    </div>
  );
}

function DuplicateGroupFixture({ suppressed = false }: { suppressed?: boolean }) {
  return (
    <div className={`duplicate-group-card${suppressed ? " is-suppressed" : ""}`}>
      <div className="duplicate-group-summary">
        <div className="duplicate-group-summary-main">
          <button type="button" className="duplicate-group-badge-tooltip-trigger tooltip-trigger">
            <span className="badge">{suppressed ? "Suppressed" : "Filename"}</span>
          </button>
          <strong>arrival 2016</strong>
        </div>
        <button type="button" className="secondary icon-only-button duplicate-group-action duplicate-group-compare-action" aria-label="Compare files">
          <GitCompareArrowsIcon className="duplicate-group-action-icon" size={17} />
        </button>
        <button type="button" className="secondary icon-only-button duplicate-group-action" aria-label="Hide group">
          {suppressed ? <Eye className="duplicate-group-action-icon is-suppressed" /> : <EyeOff className="duplicate-group-action-icon" />}
        </button>
      </div>
      <div className="duplicate-group-items-scroll">
        <div className="duplicate-group-item-card">
          <span className="duplicate-group-item-name">Arrival.2016.mkv</span>
          <span className="duplicate-group-item-size">18.4 GB</span>
          <button type="button" className="secondary icon-only-button duplicate-group-open-button" aria-label="Open file">
            <ArrowUpRight className="duplicate-group-open-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PathBrowserFixture() {
  const [value, setValue] = useState(".");
  const [selectedPaths, setSelectedPaths] = useState(["Movies"]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalBrowse = api.browse;
    api.browse = async (path = ".") => mockBrowseResponses[path] ?? mockBrowseResponses["."];
    setReady(true);
    return () => {
      api.browse = originalBrowse;
    };
  }, []);

  if (!ready) {
    return <div className="notice">Loading path browser...</div>;
  }

  return (
    <PathBrowser
      value={value}
      selectedPaths={selectedPaths}
      onChange={setValue}
      onAddPath={(path) => setSelectedPaths((current) => (current.includes(path) ? current : [...current, path]))}
      onRemovePath={(path) => setSelectedPaths((current) => current.filter((item) => item !== path))}
    />
  );
}

function ComparisonChartFixture() {
  const [selection, setSelection] = useState<ComparisonSelection>({
    xField: "duration",
    yField: "size",
    renderer: "heatmap",
  });

  return (
    <ComparisonChartPanel
      comparison={comparisonResponse}
      selection={selection}
      onChangeXField={(xField) => setSelection((current) => ({ ...current, xField }))}
      onChangeYField={(yField) => setSelection((current) => ({ ...current, yField }))}
      onSwapAxes={() => setSelection((current) => ({ ...current, xField: current.yField, yField: current.xField }))}
      onChangeRenderer={(renderer) => setSelection((current) => ({ ...current, renderer }))}
    />
  );
}

function ReleaseDialogFixture() {
  return (
    <div className="release-notes-dialog ui-elements-dialog-surface" role="presentation">
      <div className="release-notes-header release-notes-header-menu-open">
        <div className="release-notes-title-block">
          <h2>Release history</h2>
        </div>
        <div className="release-notes-actions">
          <button type="button" className="release-notes-download release-notes-download-success">
            <Download className="nav-icon" aria-hidden="true" />
            <span>Downloaded</span>
          </button>
          <TelemetryModeToggle compact mode="minimal" onChange={() => undefined} />
          <a href="/releases" className="release-notes-icon-link" aria-label="Open GitHub repository" onClick={preventCatalogNavigation}>
            <GithubIcon className="release-notes-github-icon" size={18} aria-hidden="true" />
          </a>
          <button type="button" className="release-notes-close" aria-label="Close">
            <X aria-hidden="true" className="nav-icon" />
          </button>
        </div>
      </div>
      <div className="release-notes-content">
        <section className="release-notes-version release-notes-version-current">
          <button type="button" className="release-notes-version-toggle">
            <span className="release-notes-version-title">
              vdev
              <span className="release-notes-current-badge">Currently installed</span>
            </span>
            <span className="release-notes-version-meta">
              <ChevronDown aria-hidden="true" className="nav-icon" />
            </span>
          </button>
          <div className="release-notes-version-body">
            <section className="release-notes-section">
              <h3>New</h3>
              <ul>
                <li>
                  Example release note with <a href="https://github.com/frederikemmer/MediaLyze/issues/153" onClick={preventCatalogNavigation}>#153</a>.
                </li>
              </ul>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}

export function UiElementsPage() {
  const { t } = useTranslation();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [audioPrimaryMode, setAudioPrimaryMode] = useState<AudioStreamPrimaryMode>("quality");
  const source = t("uiElements.source");
  const settings = t("uiElements.sources.settings");
  const dashboard = t("uiElements.sources.dashboard");
  const libraryDetail = t("uiElements.sources.libraryDetail");
  const fileDetail = t("uiElements.sources.fileDetail");
  const scanLogs = t("uiElements.sources.scanLogs");
  const releaseNotes = t("uiElements.sources.releaseNotes");
  const header = t("uiElements.sources.header");

  const sectionLinks = useMemo(
    () => catalogSections.map((section) => ({ ...section, title: t(section.titleKey) })),
    [t],
  );

  function updateThemePreview(nextTheme: ThemePreference) {
    setThemePreference(nextTheme);
  }

  return (
    <main className="ui-elements-page">
      <section className="panel ui-elements-hero">
        <div>
          <p className="eyebrow">{t("uiElements.eyebrow")}</p>
          <h2>{t("uiElements.title")}</h2>
          <p className="subtitle">{t("uiElements.subtitle")}</p>
        </div>
        <div className="ui-elements-hero-actions">
          <span className="badge scan-badge">{t("uiElements.devOnly")}</span>
          <label className="field ui-elements-theme-field">
            <span>{t("uiElements.themePreview")}</span>
            <select value={themePreference} onChange={(event) => updateThemePreview(event.target.value as ThemePreference)}>
              <option value="system">{t("theme.system")}</option>
              <option value="light">{t("theme.light")}</option>
              <option value="dark">{t("theme.dark")}</option>
            </select>
          </label>
          <button type="button" className="secondary small">
            <Download aria-hidden="true" className="nav-icon" />
            {t("uiElements.sampleAction")}
          </button>
        </div>
      </section>

      <div className="ui-elements-layout">
        <nav className="panel ui-elements-index" aria-label={t("uiElements.indexAria")}>
          <strong>{t("uiElements.indexTitle")}</strong>
          {sectionLinks.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <div className="ui-elements-content">
          <CatalogSection definition={catalogSections[0]}>
            <VariantGroup title="Tokens and type">
              <VariantCard title="Theme tokens" source={`${source}: globals.css`} classes={["--bg", "--panel", "--accent", "--accent-2"]} wide>
                <div className="ui-elements-token-grid">
                  {colorTokens.map((token) => (
                    <article key={token.name} className="ui-elements-token">
                      <span className="ui-elements-token-swatch" style={{ background: token.value }} />
                      <strong>{token.name}</strong>
                      <span>{token.value}</span>
                    </article>
                  ))}
                </div>
              </VariantCard>
              <VariantCard title="Typography stack" source={`${source}: global app shell`} classes={["eyebrow", "subtitle", "panel-title-row"]}>
                <div className="stack">
                  <p className="eyebrow">Eyebrow</p>
                  <h1>MediaLyze</h1>
                  <h2>Panel heading</h2>
                  <h3>Compact heading</h3>
                  <p className="subtitle">Muted helper copy used in panels and settings.</p>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[1]}>
            <VariantGroup title="Header variants">
              <VariantCard title="Primary and library nav" source={header} classes={["media-nav-panel", "media-nav-icons", "media-nav-libraries", "library-nav-link", "icon-nav-button", "nav-active-pill"]}>
                <div className="media-nav-panel">
                  <div className="media-nav-icons">
                    <a href="/" className="icon-nav-button active" aria-label="Dashboard" onClick={preventCatalogNavigation}>
                      <span className="nav-active-pill" />
                      <span className="nav-link-content">
                        <House aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                    <a href="/files/compare" className="icon-nav-button" aria-label="Compare files" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">
                        <GitCompare aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                    <a href="/settings" className="icon-nav-button is-first-library-attention" aria-label="Settings" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">
                        <Settings aria-hidden="true" className="nav-icon" />
                      </span>
                    </a>
                  </div>
                  <div className="media-nav-libraries ui-elements-library-nav">
                    <a href="/libraries/1" className="library-nav-link active" onClick={preventCatalogNavigation}>
                      <span className="nav-active-pill" />
                      <span className="nav-link-content">Movies</span>
                    </a>
                    <a href="/libraries/2" className="library-nav-link" onClick={preventCatalogNavigation}>
                      <span className="nav-link-content">Music</span>
                    </a>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Version and update labels" source={header} classes={["app-version", "app-version-update"]}>
                <div className="app-title-block">
                  <button type="button" className="app-version">dev</button>
                  <span className="app-version-update">Update available: v0.15.0</span>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[2]}>
            <VariantGroup title="Navigation and settings controls">
              <VariantCard title="Settings sidebar" source={`${settings} > Navigation`} classes={["settings-navigation-panel", "settings-navigation-item", "settings-navigation-quick-action"]} wide>
                <SettingsNavigationFixture />
              </VariantCard>
              <VariantCard title="Compatibility profile list" source={`${settings} > Hard/Software Profiles`} classes={["compatibility-profile-list", "compatibility-profile-list-row", "compatibility-profile-quick-actions"]} wide>
                <div className="compatibility-profile-list">
                  <div className="compatibility-profile-search">
                    <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
                    <input type="search" placeholder="Search profiles" aria-label="Search hardware profiles" />
                  </div>
                  <article className="compatibility-profile-list-item">
                    <div className="compatibility-profile-list-row">
                      <button type="button" className="compatibility-profile-list-trigger">
                        <span>Apple TV 4K 3rd Gen</span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <div className="compatibility-profile-quick-actions">
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action is-favorite" aria-label="Remove Apple TV profile from favorites" aria-pressed="true">
                          <AnimatedSparklesIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Edit Apple TV profile">
                          <SquarePenIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Clone Apple TV profile">
                          <CopyIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Delete Apple TV profile" disabled>
                          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                  </article>
                  <article className="compatibility-profile-list-item is-expanded">
                    <div className="compatibility-profile-list-row">
                      <button type="button" className="compatibility-profile-list-trigger" aria-expanded="true">
                        <span>VLC 3 Desktop</span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <div className="compatibility-profile-quick-actions">
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Add VLC profile to favorites" aria-pressed="false">
                          <AnimatedSparklesIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Edit VLC profile">
                          <SquarePenIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Clone VLC profile">
                          <CopyIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                        <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label="Delete VLC profile">
                          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                    <div className="compatibility-profile-details">
                      <div className="compatibility-profile-form-grid">
                        <label>Name<input readOnly value="VLC 3 Desktop" /></label>
                        <label>
                          Category
                          <select disabled defaultValue="player">
                            <option value="player">Media player</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label>Developer<input readOnly value="VideoLAN" /></label>
                        <label>Verified by<select disabled defaultValue="project-documentation"><option value="project-documentation">Project documentation</option></select></label>
                      </div>
                    </div>
                  </article>
                </div>
              </VariantCard>
              <VariantCard title="Structured compatibility capability editor" source={`${settings} > Hard/Software Profiles > Profile details`} classes={["compatibility-capability-section", "compatibility-capability-row", "compatibility-capability-limits"]} wide>
                <details className="compatibility-capability-section" open>
                  <summary>Sources</summary>
                  <div className="compatibility-capability-section-body">
                    <div className="compatibility-capability-editor">
                      <div className="compatibility-capability-row compatibility-source-row">
                        <label>Label<input defaultValue="Technical specifications" /></label>
                        <label>
                          URL
                          <span className="compatibility-source-url-control is-readonly">
                            <input type="url" readOnly value="https://example.com/specifications" />
                            <button type="button" className="secondary icon-only-button compatibility-source-open-button" aria-label="Open source in a new tab">
                              <SquareArrowOutUpRight size={17} aria-hidden="true" />
                            </button>
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                </details>
                <details className="compatibility-capability-section" open>
                  <summary>Audio capabilities</summary>
                  <div className="compatibility-capability-section-body">
                    <div className="compatibility-capability-editor">
                      <div className="compatibility-capability-row">
                        <label>
                          Format
                          <select defaultValue="truehd">
                            <option value="aac">AAC (aac)</option>
                            <option value="eac3">Dolby Digital Plus / E-AC-3 (eac3)</option>
                            <option value="truehd">Dolby TrueHD (truehd)</option>
                            <option value="dts_hd">DTS-HD (dts_hd)</option>
                            <option value="flac">FLAC (flac)</option>
                          </select>
                        </label>
                        <label>
                          Support
                          <select defaultValue="passthrough_only">
                            <option value="true">Supported</option>
                            <option value="limited">Limited</option>
                            <option value="passthrough_only">Passthrough only</option>
                            <option value="false">Unsupported</option>
                          </select>
                        </label>
                        <button type="button" className="secondary icon-only-button compatibility-capability-remove" aria-label="Remove TrueHD">
                          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                        </button>
                      </div>
                    </div>
                  </div>
                </details>
                <div className="compatibility-video-capability">
                  <div className="compatibility-capability-row">
                    <label>
                      Codec
                      <select defaultValue="hevc">
                        <option value="h264">H.264 / AVC (h264)</option>
                        <option value="hevc">H.265 / HEVC (hevc)</option>
                        <option value="vvc">H.266 / VVC (vvc)</option>
                        <option value="av1">AV1 (av1)</option>
                        <option value="prores">Apple ProRes (prores)</option>
                      </select>
                    </label>
                    <label className="compatibility-hardware-decode-toggle">
                      <span>Hardware decode</span>
                      <span className="compatibility-checkbox-field">
                        <input type="checkbox" defaultChecked />
                      </span>
                    </label>
                  </div>
                  <div className="compatibility-capability-limits">
                    <label>Max. resolution<input placeholder="e.g. 4K" /></label>
                    <label>Max. FPS<input placeholder="e.g. 60" /></label>
                    <label>Bit depth<input placeholder="e.g. 8, 10" /></label>
                    <label>HDR formats<input placeholder="e.g. HDR10, Dolby Vision" /></label>
                  </div>
                </div>
                <div className="compatibility-capability-row compatibility-container-row">
                  <label>
                    Container
                    <select defaultValue="mkv">
                      <option value="mp4">MP4 / ISO Base Media (mp4)</option>
                      <option value="mkv">Matroska Video (mkv)</option>
                      <option value="webm">WebM (webm)</option>
                      <option value="m2ts">Blu-ray MPEG-2 Transport Stream (m2ts)</option>
                      <option value="mxf">Material Exchange Format (mxf)</option>
                    </select>
                  </label>
                </div>
                <div className="compatibility-capability-row">
                  <label>
                    Subtitle format
                    <select defaultValue="subrip">
                      <option value="subrip">SubRip / SRT (subrip)</option>
                      <option value="ass">Advanced SubStation Alpha (ass)</option>
                      <option value="webvtt">WebVTT (webvtt)</option>
                      <option value="hdmv_pgs_subtitle">Blu-ray PGS (hdmv_pgs_subtitle)</option>
                      <option value="dvd_subtitle">DVD VobSub (dvd_subtitle)</option>
                    </select>
                  </label>
                </div>
                <div className="compatibility-video-capability">
                  <div className="compatibility-capability-row">
                    <label>Codec<select defaultValue="hevc"><option value="hevc">H.265 / HEVC (hevc)</option></select></label>
                    <label>
                      Playback mode
                      <select defaultValue="conditional">
                        <option value="direct">Direct</option>
                        <option value="direct_stream">Direct stream / remux</option>
                        <option value="video_transcode">Video transcode</option>
                        <option value="conditional">Conditional</option>
                      </select>
                    </label>
                  </div>
                  <label className="compatibility-profile-reason">
                    Conditions (JSON)
                    <textarea readOnly rows={3} value={'[{"kind":"device_capability","value":"HEVC decoder"}]'} />
                  </label>
                </div>
                <details className="compatibility-capability-section" open>
                  <summary>Combined compatibility rules</summary>
                  <div className="compatibility-capability-section-body">
                    <textarea className="compatibility-profile-json-editor" readOnly rows={4} value={'[{"id":"hevc-mkv-remux","match":{"containers":["mkv"],"video_codecs":["hevc"]},"mode":"direct_stream"}]'} />
                  </div>
                </details>
              </VariantCard>
              <VariantCard title="Combination profile tabs" source={`${settings} > Hard/Software Profiles`} classes={["quality-profile-segments", "quality-profile-segment", "quality-profile-segment-pill"]} wide>
                <div className="quality-profile-segments" role="tablist" aria-label="Hardware & software profiles">
                  <SlidingTogglePill activeKey="hardware" className="nav-active-pill quality-profile-segment-pill" />
                  {(["hardware", "software", "compatibility"] as const).map((profileTab) => (
                    <button
                      key={profileTab}
                      type="button"
                      data-toggle-key={profileTab}
                      className={`quality-profile-segment${profileTab === "hardware" ? " is-active" : ""}`}
                      aria-pressed={profileTab === "hardware"}
                    >
                      <span>
                        {profileTab === "hardware"
                          ? "Hardware"
                          : profileTab === "software"
                            ? "Software / Player"
                            : "Combination"}
                      </span>
                    </button>
                  ))}
                </div>
              </VariantCard>
              <VariantCard title="Compact profile header action" source={`${settings} > Libraries / Quality / Hard/Software Profiles`} classes={["panel-title-row", "settings-panel-header-action", "compatibility-profile-header-action"]} wide>
                <div className="panel-title-row">
                  <h2>Hardware &amp; software profiles</h2>
                  <div className="async-panel-toggle-actions">
                    <button type="button" className="secondary small settings-panel-header-action compatibility-profile-header-action">
                      <Plus aria-hidden="true" size={16} />
                      <span>Add local profile</span>
                    </button>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Library title actions" source={`${settings} > Libraries`} classes={["library-title-actions", "library-action-tooltip-trigger"]}>
                <div className="library-title-actions">
                  <button type="button" className="secondary icon-only-button library-action-tooltip-trigger" aria-label="Show library on dashboard">
                    <DashboardVisibilityIcon visible />
                  </button>
                  <button type="button" className="secondary icon-only-button library-action-tooltip-trigger" aria-label="Rename library">
                    <SquarePenIcon aria-hidden="true" className="nav-icon" />
                  </button>
                  <button type="button" className="secondary icon-only-button library-action-tooltip-trigger" aria-label="Delete library">
                    <DeleteIcon size={20} aria-hidden="true" className="nav-icon" />
                  </button>
                </div>
              </VariantCard>
              <VariantCard title="History reconstruction action" source={`${settings} > History retention`} classes={["settings-panel-header-action", "history-retention-reconstruct-button"]}>
                <button type="button" className="secondary small settings-panel-header-action history-retention-reconstruct-button">
                  Reconstruct history
                </button>
              </VariantCard>
              <VariantCard title="Pattern recognition actions" source={`${settings} > Pattern recognition`} classes={["pattern-recognition-doc-button", "pattern-recognition-action-button", "ignore-pattern-action-button"]} wide>
                <div className="pattern-recognition-doc-row">
                  <div className="pattern-recognition-doc-copy">
                    <p>Configure scan-time series and bonus folder patterns plus ignored paths.</p>
                    <p>Pattern examples and matching rules are documented separately.</p>
                  </div>
                  <a href="#pattern-docs" className="secondary small settings-panel-header-action pattern-recognition-doc-button">
                    Open pattern docs
                  </a>
                </div>
              </VariantCard>
              <VariantCard title="Pattern recognition mode spacing" source={`${settings} > Pattern recognition`} classes={["distribution-copy", "pattern-recognition-mode-field"]}>
                <div>
                  <div className="distribution-copy">
                    <strong>Show &amp; Seasons</strong>
                  </div>
                  <div className="field pattern-recognition-mode-field">
                    <label>Recognition mode<select defaultValue="folder-depth"><option value="folder-depth">Folder depth</option></select></label>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Compatibility profile actions" source={`${settings} > Hard/Software Profiles`} classes={["compatibility-profile-action-button"]}>
                <div className="compatibility-profile-card-actions">
                  <button type="button" className="secondary compatibility-profile-action-button">
                    <Copy aria-hidden="true" size={16} />
                    Edit local copy
                  </button>
                  <button type="button" className="compatibility-profile-action-button is-primary">
                    <Save aria-hidden="true" size={16} />
                    Save
                  </button>
                </div>
              </VariantCard>
              <VariantCard title="Collapsed settings sidebar" source={`${settings} > Navigation`} classes={["is-settings-nav-collapsed", "settings-navigation-item-content"]}>
                <SettingsNavigationFixture collapsed />
              </VariantCard>
              <VariantCard title="Settings choice picker" source={`${settings} > App settings`} classes={["settings-choice-picker-field", "settings-choice-picker-popover"]}>
                <div className="settings-choice-picker-shell quality-picker-field-shell search-filter-picker">
                  <button type="button" className="settings-choice-picker-field is-open">
                    <span className="settings-choice-picker-value">System</span>
                    <ChevronDown aria-hidden="true" className="nav-icon settings-choice-picker-chevron" />
                  </button>
                  <div className="search-filter-picker-popover quality-picker-popover settings-choice-picker-popover">
                    <button type="button" className="search-filter-picker-item is-selected">System</button>
                    <button type="button" className="search-filter-picker-item">Light</button>
                    <button type="button" className="search-filter-picker-item">Dark</button>
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Table view editor" source={`${settings} > Table View`} classes={["settings-data-table", "statistics-drag-handle", "settings-checkbox-cell"]} wide>
                <TableViewSettingsFixture />
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[3]}>
            <VariantGroup title="Form families">
              <VariantCard title="Basic form grid" source={`${settings} > Create library`} classes={["form-grid", "field", "field-hint"]}>
                <div className="form-grid ui-elements-form-grid">
                  <div className="field">
                    <label htmlFor="ui-library-name">Name</label>
                    <input id="ui-library-name" defaultValue="Movies archive" />
                    <p className="field-hint">Default input surface.</p>
                  </div>
                  <div className="field">
                    <label htmlFor="ui-library-type">Media type</label>
                    <select id="ui-library-type" defaultValue="movies">
                      <option value="movies">Movies</option>
                      <option value="series">Series</option>
                    </select>
                  </div>
                  <label className="app-settings-flag-row">
                    <input type="checkbox" defaultChecked />
                    <span>Show on dashboard</span>
                  </label>
                </div>
              </VariantCard>
              <VariantCard title="Structured search" source={`${libraryDetail} > Analyzed files`} classes={["metadata-search-control", "metadata-search-icon-button", "metadata-search-remove", "data-table-search-layout"]}>
                <div className="stack">
                  <div className="library-layout-panel-analyzed-files">
                    <div className="panel-header">
                      <div className="data-table-search-layout">
                        <div className="metadata-search-control metadata-search-control-base search-filter-picker">
                          <button type="button" className="search-filter-picker-button" aria-label="Add metadata search field">
                            <Plus size={18} aria-hidden="true" />
                          </button>
                          <span className="metadata-search-icon-button metadata-search-icon-button-middle" aria-hidden="true">
                            <Search size={16} />
                          </span>
                          <input type="search" placeholder="Search file and path" aria-label="Search files and metadata" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <SearchFilterFixture />
                  <SearchFilterFixture invalid />
                </div>
              </VariantCard>
              <VariantCard title="Ignore pattern rows" source={`${settings} > Ignore patterns`} classes={["ignore-pattern-section", "ignore-pattern-row", "ignore-pattern-action-button"]} wide>
                <IgnorePatternFixture />
              </VariantCard>
              <VariantCard title="Quality picker and profile editor" source={`${settings} > Quality profiles`} classes={["quality-picker-field", "quality-profile-metric-item", "quality-profile-weight-input"]} wide>
                <QualityProfileFixture />
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[4]}>
            <VariantGroup title="Button and action variants">
              <VariantCard title="Global button variants" source={`${source}: globals.css`} classes={["button", "secondary", "ghost", "small"]}>
                <div className="ui-elements-control-grid">
                  <button type="button">Primary</button>
                  <button type="button" className="secondary">Secondary</button>
                  <button type="button" className="ghost">Ghost</button>
                  <button type="button" className="secondary small">Small</button>
                  <button type="button" disabled>Disabled</button>
                </div>
              </VariantCard>
              <VariantCard title="Statistic layout actions" source={`${dashboard} / ${libraryDetail}`} classes={["statistic-layout-controls", "statistic-layout-action-button", "statistic-layout-menu"]}>
                <StatisticPanelLayoutControls
                  availableDefinitions={availablePanelDefinitions}
                  isEditing
                  onStartEditing={() => undefined}
                  onCancelEditing={() => undefined}
                  onRestoreDefault={() => undefined}
                  onSaveEditing={() => undefined}
                  onAddPanel={() => undefined}
                />
              </VariantCard>
              <VariantCard title="Page-specific icon buttons" source={`${scanLogs} / ${fileDetail} / ${libraryDetail}`} classes={["scan-log-copy-button", "file-detail-cover-button", "duplicate-group-open-button", "library-quickscan-button", "file-detail-navigation-actions"]}>
                <div className="ui-elements-control-grid">
                  <button type="button" className="scan-log-copy-button" aria-label="Copy"><Copy className="nav-icon" /></button>
                  <button type="button" className="file-detail-cover-button secondary small"><Download className="nav-icon" /> Download cover</button>
                  <button type="button" className="secondary icon-only-button duplicate-group-open-button" aria-label="Open"><ArrowUpRight className="duplicate-group-open-icon" /></button>
                  <button type="button" className="secondary icon-only-button duplicate-group-action duplicate-group-compare-action" aria-label="Compare">
                    <GitCompareArrowsIcon className="duplicate-group-action-icon" size={17} />
                  </button>
                  <button type="button" className="statistic-layout-action-button library-quickscan-button" aria-label="Quick scan" title="Quick scan">
                    <AnimatedSearchIcon className="statistic-layout-action-icon" size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className="secondary small settings-panel-header-action file-detail-navigation-back-button" aria-label="Back" title="Back">
                    <ArrowLeft className="nav-icon" aria-hidden="true" />
                    <span>Back</span>
                  </button>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[5]}>
            <VariantGroup title="Panel shells and layout editing">
              <VariantCard title="AsyncPanel states" source={`${dashboard} / ${libraryDetail} / ${fileDetail}`} classes={["async-panel", "panel-loader", "alert"]} wide>
                <div className="ui-elements-panel-grid">
                  <AsyncPanel title="Normal panel" subtitle="Shared panel shell">
                    <DistributionList items={distributionItems} />
                  </AsyncPanel>
                  <AsyncPanel title="Loading panel" loading><span /></AsyncPanel>
                  <AsyncPanel title="Error panel" error="Example error"><span /></AsyncPanel>
                  <AsyncPanel
                    title="Collapsed panel"
                    collapseState={{ collapsed, onToggle: () => setCollapsed((value) => !value) }}
                    collapseActions={<button type="button" className="secondary icon-only-button"><SlidersHorizontal className="nav-icon" /></button>}
                  >
                    <PanelEmptyState />
                  </AsyncPanel>
                </div>
              </VariantCard>
              <VariantCard title="Statistic layout edit overlay" source={`${dashboard} > Layout editor`} classes={["statistic-layout-grid", "statistic-layout-overlay", "statistic-layout-size-button"]} wide>
                <StatisticLayoutFixture />
              </VariantCard>
              <VariantCard title="Migration notice" source={`${dashboard} / ${libraryDetail} > Saved layouts`} classes={["statistic-layout-migration-notice", "notice"]}>
                <StatisticPanelLayoutMigrationNotice
                  scope="dashboard"
                  issues={[{ kind: "resized_panel", statisticId: "comparison", instanceId: "comparison-1", axis: "height", requested: 9, applied: 4 }]}
                />
              </VariantCard>
              <VariantCard title="Empty states" source={`${libraryDetail} > Duplicates / Panels`} classes={["panel-empty-state", "duplicate-panel-empty-state"]}>
                <div className="ui-elements-empty-grid">
                  <PanelEmptyState message="No data yet" />
                  <DuplicatePanelEmptyState message="No duplicates found" />
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[6]}>
            <VariantGroup title="Table surfaces">
              <VariantCard title="Analyzed files virtual table" source={`${libraryDetail} > Analyzed files`} classes={["data-table-shell", "media-data-table", "score-meter"]} wide>
                <div className="data-table-tools">
                  <div className="column-picker">
                    <button type="button" className="column-toggle is-active"><Columns3 className="nav-icon" /> Container</button>
                    <button type="button" className="column-toggle is-active">Codec</button>
                    <button type="button" className="column-toggle">Bitrate</button>
                    <button type="button" className="column-toggle" disabled>Path</button>
                  </div>
                </div>
                <AnalyzedFilesTable />
              </VariantCard>
              <VariantCard title="Settings table" source={`${settings} > Resolution categories`} classes={["settings-table-shell", "settings-data-table"]}>
                <div className="settings-table-shell">
                  <table className="settings-data-table">
                    <thead><tr><th>Name</th><th>Minimum</th><th>Actions</th></tr></thead>
                    <tbody>
                      <tr><td>4K</td><td>3840x2160</td><td><button type="button" className="secondary small">Edit</button></td></tr>
                      <tr><td>1080p</td><td>1920x1080</td><td><button type="button" className="secondary small">Edit</button></td></tr>
                    </tbody>
                  </table>
                </div>
              </VariantCard>
              <VariantCard title="Scan summary table" source={`${scanLogs} > Scan detail`} classes={["scan-log-summary-table-shell", "scan-log-summary-table"]}>
                <div className="scan-log-summary-table-shell">
                  <table className="scan-log-summary-table">
                    <tbody>
                      <tr><th>New</th><td>42</td></tr>
                      <tr><th>Modified</th><td>18</td></tr>
                      <tr><th>Errors</th><td>3</td></tr>
                    </tbody>
                  </table>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[7]}>
            <VariantGroup title="Statistics and charts">
              <VariantCard title="Stat cards" source={dashboard} classes={["media-card", "metric-card", "stat-card"]}>
                <div className="card-grid grid ui-elements-stat-grid">
                  <StatCard label="Libraries" value="4" />
                  <StatCard label="Files" value="12,482" tone="teal" />
                  <StatCard label="Storage" value="18.7 TB" tone="blue" />
                </div>
              </VariantCard>
              <VariantCard title="Distribution list" source={`${dashboard} / ${libraryDetail}`} classes={["distribution-list", "distribution-item", "distribution-bar"]}>
                <DistributionList items={distributionItems} />
              </VariantCard>
              <VariantCard title="Distribution chart panel" source={`${libraryDetail} > Numeric panel`} classes={["async-panel", "distribution-chart-mode-toggle", "distribution-chart-canvas"]} wide>
                <DistributionChartPanel title="Quality score" distribution={numericDistribution} metricId="quality_score" />
              </VariantCard>
              <VariantCard title="Comparison chart panel" source={`${dashboard} / ${libraryDetail} > Metric comparison`} classes={["async-panel", "comparison-chart-toolbar", "comparison-chart-select", "comparison-chart-content"]} wide>
                <ComparisonChartFixture />
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[8]}>
            <VariantGroup title="Runtime and scan logs">
              <VariantCard title="Active scan cards" source={`${source}: Header scan banner`} classes={["scan-job-card", "is-indeterminate", "is-determinate"]} wide>
                <div className="scan-banner-list">
                  <ScanJobFixture />
                  <ScanJobFixture determinate />
                </div>
              </VariantCard>
              <VariantCard title="Recent scan log card" source={`${settings} > Scan logs`} classes={["scan-log-card", "scan-log-summary", "scan-log-detail-section"]} wide>
                <ScanLogFixture />
              </VariantCard>
              <VariantCard title="Scan badges and outcomes" source={`${scanLogs} > Recent scans`} classes={["scan-badge", "scan-log-outcome", "badge-successful"]}>
                <div className="ui-elements-badge-row">
                  <Badge className="badge scan-log-outcome badge-successful">Successful</Badge>
                  <Badge className="badge scan-log-outcome badge-completed_with_issues">Completed with issues</Badge>
                  <Badge className="badge scan-log-outcome badge-failed">Failed</Badge>
                  <Badge className="badge scan-log-outcome badge-canceled">Canceled</Badge>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[9]}>
            <VariantGroup title="Library and file detail variants">
              <VariantCard title="File detail navigation and badges" source={`${fileDetail} > Overview`} classes={["file-detail-layout", "file-detail-navigation-panel", "file-detail-badge-tooltip-trigger"]} wide>
                <FileDetailNavigationFixture />
              </VariantCard>
              <VariantCard title="Path segment trail" source={`${fileDetail} > Overview / Analyzed files`} classes={["path-segment-trail", "path-segment", "path-segment-leaf"]}>
                <PathSegmentTrail value="/media/Movies/Arrival/Arrival.2016.UHD.mkv" />
              </VariantCard>
              <VariantCard title="Preview and download warning" source={`${fileDetail} > Preview`} classes={["file-detail-preview-panel", "file-detail-preview-player", "file-detail-preview-report"]}>
                <PreviewFixture />
              </VariantCard>
              <VariantCard title="Stream details list" source={`${fileDetail} > Streams / Table tooltips`} classes={["stream-details-list", "stream-detail-entry"]}>
                <div className="stack">
                  <AudioStreamPrimaryToggle mode={audioPrimaryMode} onChange={setAudioPrimaryMode} />
                  <StreamDetailsList kind="video" detail={streamDetails} t={t} surface="panel" showSummary inDepthDolbyVisionProfiles />
                </div>
              </VariantCard>
              <VariantCard title="Quality breakdown rows" source={`${fileDetail} > Quality score`} classes={["quality-detail-list", "quality-detail-item", "score-meter"]}>
                <div className="quality-detail-list">
                  <div className="quality-detail-item">
                    <strong>Resolution</strong>
                    <ScoreMeter value={92} />
                    <span className="subtitle">Actual 3840x2160, ideal 4K.</span>
                  </div>
                  <div className="quality-detail-item">
                    <strong>Audio codec</strong>
                    <ScoreMeter value={76} />
                  </div>
                </div>
              </VariantCard>
              <VariantCard title="Favorite compatibility groups" source={`${fileDetail} > Compatibility`} classes={["compatibility-favorite-sections", "compatibility-favorite-section", "compatibility-profile-report"]} wide>
                <div className="stack">
                  <div className="panel-title-row">
                    <h2>Compatibility</h2>
                    <TooltipTrigger
                      ariaLabel="Show compatibility favorites help"
                      content={(
                        <div className="file-detail-compatibility-help-content">
                          <span>Click a section&apos;s search field to show all profiles. Favorites stay at the top and are evaluated here.</span>
                          <a href="/settings">Open Hard/Software Profiles</a>
                        </div>
                      )}
                    >
                      <Info size={14} aria-hidden="true" />
                    </TooltipTrigger>
                  </div>
                  <div className="compatibility-favorite-sections">
                  <details className="compatibility-favorite-section" open>
                    <summary>
                      <span>Hardware</span>
                      <span className="compatibility-favorite-count">1</span>
                    </summary>
                    <div className="compatibility-favorite-section-body">
                      <div className="compatibility-profile-search">
                        <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
                        <input aria-label="Search Hardware profiles" placeholder="Search profiles" type="search" />
                      </div>
                      <details className="compatibility-favorite-profile" open>
                        <summary className="compatibility-favorite-profile-summary">
                          <span>Apple TV 4K 3rd Gen</span>
                          <span className="compatibility-favorite-profile-actions">
                            <span className="compatibility-status-badge status-direct_play">Direct play</span>
                            <span className="compatibility-profile-quick-actions">
                              <ProfileFavoriteButton
                                favorite
                                label="Remove Apple TV 4K 3rd Gen from favorites"
                                onClick={() => undefined}
                              />
                            </span>
                          </span>
                        </summary>
                        <div className="compatibility-favorite-profile-report">
                          <div className="compatibility-profile-report status-direct_play">
                            <div className="stream-tooltip-meta">
                              <span className="stream-tooltip-pill compatibility-scope-pill status-direct_play">Container: Direct play</span>
                              <span className="stream-tooltip-pill compatibility-scope-pill status-direct_play">Audio: Direct play</span>
                            </div>
                            <div className="notice">No compatibility issues detected.</div>
                          </div>
                        </div>
                      </details>
                    </div>
                  </details>
                  <details className="compatibility-favorite-section" open>
                    <summary>
                      <span>Software / Player</span>
                      <span className="compatibility-favorite-count">1</span>
                    </summary>
                  </details>
                  <details className="compatibility-favorite-section" open>
                    <summary>
                      <span>Combination</span>
                      <span className="compatibility-favorite-count">1</span>
                    </summary>
                  </details>
                  </div>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[10]}>
            <VariantGroup title="Duplicates, paths, telemetry">
              <VariantCard title="Duplicate group cards" source={`${libraryDetail} > Duplicates`} classes={["duplicate-group-card", "duplicate-group-item-card", "duplicate-group-action"]} wide>
                <div className="duplicate-group-list">
                  <DuplicateGroupFixture />
                  <DuplicateGroupFixture suppressed />
                </div>
              </VariantCard>
              <VariantCard title="File comparison rows" source="FileComparePage" classes={["file-compare-search-card", "file-compare-row", "has-difference", "is-identical"]} wide>
                <div className="file-compare-page">
                  <div className="panel-title-row panel-title-row-with-actions">
                    <div className="file-compare-title-block">
                      <h2>Compare files</h2>
                      <p className="subtitle">Place two analyzed media files side by side and highlight metadata differences.</p>
                    </div>
                    <div className="file-compare-title-actions">
                      <div className="search-filter-picker file-compare-column-count-picker">
                        <button type="button" className="file-compare-column-count-button is-open" aria-label="Select comparison columns" aria-expanded="true" title="Select comparison columns">
                          <Columns3Cog size={20} aria-hidden="true" />
                        </button>
                        <div className="search-filter-picker-popover file-compare-column-count-popover" role="menu">
                          <button type="button" className="search-filter-picker-item is-selected" role="menuitemradio" aria-checked="true">
                            <Columns3 size={16} aria-hidden="true" />
                            <span>3 columns</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="file-compare-toolbar file-compare-toolbar-3-columns has-file-labels">
                    <div className="file-compare-toolbar-controls">
                      <div className="distribution-chart-mode-toggle duplicate-panel-view-toggle file-compare-display-toggle" role="group" aria-label="Select compare display">
                        <SlidingTogglePill activeKey="all" className="nav-active-pill distribution-chart-mode-pill" />
                        <button type="button" data-toggle-key="all" className="distribution-chart-mode-button duplicate-panel-view-button file-compare-display-button active" aria-label="Show all categories, metadata, and metrics" title="Show all categories, metadata, and metrics">
                          <span className="distribution-chart-mode-button-content">
                            <Layers aria-hidden="true" className="distribution-chart-mode-icon" />
                          </span>
                        </button>
                        <button type="button" data-toggle-key="differences" className="distribution-chart-mode-button duplicate-panel-view-button file-compare-display-button" aria-label="Show differences only" title="Show differences only">
                          <span className="distribution-chart-mode-button-content">
                            <Diff aria-hidden="true" className="distribution-chart-mode-icon" />
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="file-compare-search-card">
                      <div className="file-compare-search-label">
                        <strong title="Movies / Sci-Fi/Arrival.2016.UHD.mkv">Arrival.2016.UHD.mkv</strong>
                        <button type="button" className="file-compare-clear-file-button" aria-label="Remove Arrival.2016.UHD.mkv from comparison" title="Remove Arrival.2016.UHD.mkv from comparison">
                          <DeleteIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
                        <button type="button" className="search-filter-picker-button" aria-label="Filter library"><ListFilter size={18} /></button>
                        <input type="search" placeholder="Search filename or path" aria-label="Search left file" />
                      </div>
                      <div className="file-compare-search-results">
                        <button type="button" className="file-compare-search-result is-disabled" disabled title="Already selected on the other side.">
                          <span className="file-compare-search-result-main" title="Movies / Sci-Fi/Arrival.2016.Remux.mkv">Arrival.2016.Remux.mkv</span>
                          <span className="file-compare-search-result-meta">21.1 GB - Video - Movies</span>
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="file-compare-swap-button"
                      aria-label="Swap compared files"
                      title="Swap compared files"
                    >
                      <ChevronsRightLeftIcon size={22} aria-hidden="true" />
                    </button>
                    <div className="file-compare-search-card">
                      <div className="file-compare-search-label">
                        <strong title="Movies / Sci-Fi/Arrival.2016.Remux.mkv">Arrival.2016.Remux.mkv</strong>
                        <button type="button" className="file-compare-clear-file-button" aria-label="Remove Arrival.2016.Remux.mkv from comparison" title="Remove Arrival.2016.Remux.mkv from comparison">
                          <DeleteIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
                        <button type="button" className="search-filter-picker-button is-open" aria-label="Filter library"><ListFilter size={18} /></button>
                        <input type="search" placeholder="Search filename or path" aria-label="Search right file" />
                      </div>
                    </div>
                    <div className="file-compare-search-card">
                      <div className="file-compare-search-label">
                        <strong title="Movies / Sci-Fi/Arrival.2016.HD.mkv">Arrival.2016.HD.mkv</strong>
                        <button type="button" className="file-compare-clear-file-button" aria-label="Remove Arrival.2016.HD.mkv from comparison" title="Remove Arrival.2016.HD.mkv from comparison">
                          <DeleteIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
                        <button type="button" className="search-filter-picker-button" aria-label="Filter library"><ListFilter size={18} /></button>
                        <input type="search" placeholder="Search filename or path" aria-label="Search third file" />
                      </div>
                    </div>
                  </div>
                  <section className="panel file-compare-section">
                    <button type="button" className="file-compare-section-toggle" aria-expanded="true">
                      <span className="file-compare-section-title">
                        <FileDiff size={18} />
                        Overview
                        <span className="badge file-compare-section-diff-badge" aria-label="2 changed" title="2 changed">
                          <Diff size={14} aria-hidden="true" />
                          <span>2</span>
                        </span>
                      </span>
                      <ChevronDown size={18} />
                    </button>
                    <div className="file-compare-row-list">
                      <div className="file-compare-row has-difference" style={{ "--file-compare-value-columns": 3 } as React.CSSProperties}>
                        <div className="file-compare-row-label">Size</div>
                        <div className="file-compare-cell">18.4 GB</div>
                        <div className="file-compare-cell">21.1 GB</div>
                        <div className="file-compare-cell">8.6 GB</div>
                      </div>
                      <div className="file-compare-row is-identical" style={{ "--file-compare-value-columns": 3 } as React.CSSProperties}>
                        <div className="file-compare-row-label">Resolution</div>
                        <div className="file-compare-cell">3840x2160</div>
                        <div className="file-compare-cell">3840x2160</div>
                        <div className="file-compare-cell">3840x2160</div>
                      </div>
                    </div>
                  </section>
                  <section className="panel file-compare-section">
                    <button type="button" className="file-compare-section-toggle" aria-expanded="false">
                      <span className="file-compare-section-title">
                        <AudioLines size={18} />
                        Audio streams
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Path browser fixture" source={`${settings} > Create library`} classes={["path-browser", "path-entry", "path-browser-selected-item"]}>
                <PathBrowserFixture />
              </VariantCard>
              <VariantCard title="Telemetry controls" source={`${settings} > Telemetry / Release notes`} classes={["telemetry-mode-toggle", "telemetry-mode-card", "telemetry-preview-actions"]}>
                <div className="stack">
                  <TelemetryModeToggle mode="enabled" highlightEnabledOption onChange={() => undefined} />
                  <div className="telemetry-mode-card-grid">
                    <div className="telemetry-mode-card telemetry-mode-card-off"><strong>Off</strong><span>No payloads.</span></div>
                    <div className="telemetry-mode-card telemetry-mode-card-minimal"><strong>Minimal</strong><span>Runtime/system only.</span></div>
                    <div className="telemetry-mode-card telemetry-mode-card-enabled"><strong>Enabled</strong><span>Rounded usage counts.</span></div>
                  </div>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>

          <CatalogSection definition={catalogSections[11]}>
            <VariantGroup title="Dialogs, popovers, tooltips">
              <VariantCard title="Release notes dialog" source={releaseNotes} classes={["release-notes-dialog", "release-notes-header", "release-notes-version"]} wide>
                <div className="ui-elements-dialog-demo">
                  <ReleaseDialogFixture />
                </div>
              </VariantCard>
              <VariantCard title="Create library dialog shell" source={`${settings} > Add library`} classes={["settings-create-library-backdrop", "settings-create-library-dialog", "settings-create-library-dialog-header"]}>
                <div className="settings-create-library-backdrop ui-elements-static-backdrop">
                  <section className="settings-create-library-dialog">
                    <div className="settings-create-library-dialog-header">
                      <h2>Create library</h2>
                      <button type="button" className="secondary icon-only-button settings-create-library-dialog-close" aria-label="Close">
                        <X className="nav-icon" />
                      </button>
                    </div>
                    <div className="form-grid">
                      <div className="field"><label>Name</label><input defaultValue="Movies" /></div>
                    </div>
                  </section>
                </div>
              </VariantCard>
              <VariantCard title="Search and quality popovers" source={`${libraryDetail} / ${settings}`} classes={["search-filter-picker-popover", "quality-picker-popover", "search-filter-picker-item"]}>
                <div className="ui-elements-popover-row">
                  <div className="search-filter-picker-popover ui-elements-static-popover">
                    <button type="button" className="search-filter-picker-item is-selected">Container</button>
                    <button type="button" className="search-filter-picker-item">Video codec</button>
                  </div>
                  <QualityPickerFixture open />
                </div>
              </VariantCard>
              <VariantCard title="Tooltip trigger variants" source={`${fileDetail} / ${libraryDetail} / ${scanLogs}`} classes={["tooltip-trigger", "file-detail-badge-tooltip-trigger", "duplicate-group-badge-tooltip-trigger"]}>
                <div className="ui-elements-control-grid">
                  <TooltipTrigger ariaLabel="Open generic tooltip" content="Generic tooltip content.">
                    <Info className="nav-icon" />
                  </TooltipTrigger>
                  <button type="button" className="file-detail-badge-tooltip-trigger tooltip-trigger"><span className="badge">HEVC</span></button>
                  <button type="button" className="duplicate-group-badge-tooltip-trigger tooltip-trigger"><span className="badge">Hash</span></button>
                </div>
              </VariantCard>
            </VariantGroup>
          </CatalogSection>
        </div>
      </div>
    </main>
  );
}
